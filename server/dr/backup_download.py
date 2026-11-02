"""Bounded authenticated R2 reads shared by backup verification and clean restores."""
import http.client
import time
import urllib.request
import urllib.error

def download_object(control, key, name, expected_size=None, *, deadline_seconds=120, socket_timeout=15, retry_delay=0.5):
    if expected_size is not None and (type(expected_size) is not int or not 0 <= expected_size <= 48*1024*1024):
        raise ValueError('invalid_backup_part_size')
    for attempt in range(3):
        request = urllib.request.Request(control+'/__dr/backup/'+name,
            headers={'User-Agent':'Qiaomu-RSS-DR/1.0','Authorization':'Bearer '+key})
        deadline = time.monotonic() + deadline_seconds
        try:
            with urllib.request.urlopen(request, timeout=socket_timeout) as response:
                data = bytearray()
                while expected_size is None or len(data) < expected_size:
                    if time.monotonic() >= deadline: raise TimeoutError('backup_download_deadline')
                    size = min(256*1024, expected_size-len(data)) if expected_size is not None else 256*1024
                    chunk = response.read1(size)
                    if not chunk: break
                    data.extend(chunk)
                    if expected_size is None and len(data) > 4*1024*1024: raise ValueError('backup_manifest_too_large')
                if expected_size is not None and len(data) != expected_size: raise OSError('backup_download_truncated')
                return bytes(data)
        except (OSError, http.client.HTTPException) as error:
            if isinstance(error, urllib.error.HTTPError) and 400 <= error.code < 500 and error.code != 429: raise
            if attempt == 2: raise
            time.sleep(retry_delay * (attempt+1))
