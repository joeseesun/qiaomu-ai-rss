#!/usr/bin/env python3
"""Independent business-health watchdog; journal transitions, persist alert state."""
import json, os, time, urllib.request, urllib.error, subprocess
from pathlib import Path
state_file = Path(os.environ.get('RSS_HEALTH_STATE', '/var/lib/qiaomu-rss-health/state.json'))
try:
    with urllib.request.urlopen(os.environ.get('RSS_HEALTH_URL', 'http://127.0.0.1:3088/api/health'), timeout=10) as response:
        health = json.load(response)
except urllib.error.HTTPError as error:
    try: health = json.load(error)
    except Exception: health = {'status': 'critical', 'error': 'reader_unavailable'}
except Exception:
    health = {'status': 'critical', 'error': 'reader_unavailable'}
if not isinstance(health, dict) or health.get('status') not in ('ok', 'degraded', 'critical'):
    health = {'status': 'critical', 'error': 'invalid_health_response'}
try: previous = json.loads(state_file.read_text())
except Exception: previous = {}
now = int(time.time() * 1000)
unavailable = health.get('error') in ('reader_unavailable', 'invalid_health_response')
unavailable_checks = previous.get('unavailableChecks', 0) + 1 if unavailable else 0
signature = json.dumps([health.get('status'), health.get('stalled'), health.get('updateStopped'), health.get('error'), health.get('staleSourceIds', [])])
changed = signature != previous.get('signature')
if changed or health['status'] != 'ok' and now - previous.get('notifiedAt', 0) > 3600000:
    print('[rss-alert] ' + json.dumps(health, ensure_ascii=False))
    previous['notifiedAt'] = now
if health['status'] == 'critical' and (not unavailable or unavailable_checks >= 2):
    # A dead web process is already handled by systemd; this also recovers a live but stuck scheduler.
    if now - previous.get('restartedAt', 0) > 1800000:
        subprocess.run(['systemctl', 'restart', 'qmreader'], check=True, timeout=30)
        previous['restartedAt'] = now
health.update(signature=signature, notifiedAt=previous.get('notifiedAt', 0), restartedAt=previous.get('restartedAt', 0), unavailableChecks=unavailable_checks)
state_file.parent.mkdir(parents=True, exist_ok=True)
temporary = state_file.with_suffix('.tmp'); temporary.write_text(json.dumps(health)); temporary.replace(state_file)
print(json.dumps({'status': health['status'], 'changed': changed, 'at': now}))
