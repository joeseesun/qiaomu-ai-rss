#!/usr/bin/env python3
"""Install additive services/vhosts. Deployment secrets are supplied in a 0600 JSON file."""
import json
import os
from pathlib import Path
import subprocess
import sys
import shutil
import time

cfg = json.loads(Path(sys.argv[1]).read_text())
role = cfg['role']; domain = 'rss-origin.qiaomu.ai' if role == 'primary' else 'rss-standby.qiaomu.ai'
def run(*args): subprocess.run(args, check=True)
def write(path, value, mode=0o600):
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(value);p.chmod(mode)
directory='/opt/qiaomu-apps/qiaomu-rss-dr'
write('/etc/rss-dr/origin-key',cfg['origin'])
if role == 'standby':
    for user, shell in [('rss-standby','/usr/sbin/nologin'),('rss-sync','/bin/sh')]:
        if subprocess.run(['id',user],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
            run('useradd','--system','--create-home','--shell',shell,user)
    if subprocess.run(['getent','group','rss-dr'],stdout=subprocess.DEVNULL).returncode:run('groupadd','--system','rss-dr')
    run('usermod','-aG','rss-dr','rss-standby');run('usermod','-aG','rss-dr','rss-sync')
    root=Path('/var/lib/qiaomu-rss-standby')
    for part in ['','staging','generations']:
        p=root/part;p.mkdir(parents=True,exist_ok=True);p.chmod(0o2750)
    run('chown','-R','rss-sync:rss-dr',str(root))
    auth='/home/rss-sync/.ssh/authorized_keys'
    write(auth,'from="76.13.103.27",restrict,command="/usr/bin/python3 '+directory+'/receiver.py" '+cfg['sshPublic'].strip()+'\n')
    run('chown','-R','rss-sync:rss-sync','/home/rss-sync/.ssh');Path('/home/rss-sync/.ssh').chmod(0o700)
    write('/etc/rss-dr/standby.env','RSS_DR_ORIGIN_KEY='+cfg['origin']+'\n')
    write('/etc/systemd/system/qiaomu-rss-standby.service',f'''[Unit]
Description=Qiaomu RSS read-only disaster recovery API
After=network.target
[Service]
User=rss-standby
Group=rss-dr
EnvironmentFile=/etc/rss-dr/standby.env
ExecStart=/usr/bin/python3 {directory}/standby.py
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
MemoryMax=384M
CPUQuota=50%
TasksMax=100
UMask=0027
[Install]
WantedBy=multi-user.target
''',0o644)
else:
    write('/etc/rss-dr/control-key',cfg['control'])
    write('/etc/rss-dr/backup-pass',cfg['password'])
    env='\n'.join(['RSS_DR_CONTROL_URL=https://rss-dr.qiaomu.ai','RSS_DR_CONTROL_KEY='+cfg['control'],'RSS_DR_SSH_TARGET=rss-sync@207.148.115.69','RSS_DR_SSH_KEY=/etc/rss-dr/sync-key','RSS_DR_BACKUP_PASSWORD_FILE=/etc/rss-dr/backup-pass'])+'\n'
    write('/etc/rss-dr/primary.env',env)
    write('/etc/systemd/system/qmreader.service.d/rss-dr.conf','[Service]\nEnvironmentFile=/etc/rss-dr/primary.env\nExecStartPre=/usr/bin/python3 /opt/qiaomu-apps/qiaomu-rss-dr/ensure-gate.py\n',0o644)
    server=Path('/opt/qiaomu-apps/qmreader/server.js');source=server.read_text()
    marker="app.use(require('/opt/qiaomu-apps/qiaomu-rss-dr/primary-gate.cjs').middleware());"
    if marker not in source:
        backup=server.parent/'.deploy-backups'/'rss-dr-20261006';backup.mkdir(parents=True,exist_ok=True)
        shutil.copy2(server,backup/'server.js')
        needle="app.disable('x-powered-by');"
        if source.count(needle)!=1:raise RuntimeError('Production mount point changed')
        server.write_text(source.replace(needle,marker+'\n'+needle))
        run('/usr/bin/node','--check',str(server))
    write('/etc/systemd/system/qiaomu-rss-sync.service',f'''[Unit]
Description=Qiaomu RSS consistent public snapshot and encrypted backup
After=network-online.target
[Service]
Type=oneshot
EnvironmentFile=/etc/rss-dr/primary.env
ExecStart=/usr/bin/python3 {directory}/snapshot.py
TimeoutStartSec=1500
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
UMask=0077
''',0o644)
    write('/etc/systemd/system/qiaomu-rss-sync.timer','''[Unit]
Description=Refresh Qiaomu RSS read-only standby every five minutes
[Timer]
OnBootSec=90
OnUnitInactiveSec=300
AccuracySec=10
[Install]
WantedBy=timers.target
''',0o644)

webroot='/var/www/rss-dr-acme';Path(webroot).mkdir(parents=True,exist_ok=True)
vhost=Path('/www/server/panel/vhost/nginx/'+domain+'.conf')
port=3088 if role=='primary' else 3096
http=f'''server {{
listen 80;
server_name {domain};
location ^~ /.well-known/acme-challenge/ {{ root {webroot}; }}
location / {{ return 403; }}
}}
'''
if not Path('/etc/letsencrypt/live/'+domain+'/fullchain.pem').exists():
    write(vhost,http,0o600);run('nginx','-t');run('nginx','-s','reload');time.sleep(2)
    run('certbot','certonly','--webroot','-w',webroot,'-d',domain,'--non-interactive','--agree-tos','--register-unsafely-without-email')
https=f'''server {{
listen 443 ssl;
server_name {domain};
ssl_certificate /etc/letsencrypt/live/{domain}/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/{domain}/privkey.pem;
access_log /www/wwwlogs/{domain}.log;
error_log /www/wwwlogs/{domain}.error.log;
location / {{
if ($http_x_rss_origin_key != "{cfg['origin']}") {{ return 403; }}
proxy_pass http://127.0.0.1:{port};
proxy_set_header Host rss.qiaomu.ai;
proxy_set_header X-Forwarded-Host rss.qiaomu.ai;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_read_timeout 30s;
}}
}}
'''
write(vhost,http+https,0o600);run('nginx','-t');run('nginx','-s','reload');run('systemctl','daemon-reload')
if role=='standby':run('systemctl','enable','--now','qiaomu-rss-standby')
else:run('systemctl','restart','qmreader')
Path(sys.argv[1]).unlink()
print(json.dumps({'installed':role,'domain':domain}))
