"""Exercise backup verification/replication/retention in disposable directories.

Never stops the service or restores business data. Create-mode checks only run
when a live backend is present, and assert that its offline guard rejects them.
"""
import ctypes
import hashlib
import json
import pathlib
import shutil
import subprocess
import uuid

repo = pathlib.Path(__file__).resolve().parents[1]
work = repo / 'tmp' / ('backup-job-test-' + uuid.uuid4().hex)
source, local, remote = [work / name for name in ['source', 'local', 'replica']]
source.mkdir(parents=True)
shell = shutil.which('pwsh') or shutil.which('powershell')
checks = []

def snapshot(day, valid=True, owner=source):
    folder = local / f'runtime-202610{day:02d}-010000-{day:08x}'
    (folder / 'data').mkdir(parents=True)
    content = f'payload-{day}'.encode()
    (folder / 'data' / 'sample.json').write_bytes(content)
    manifest = dict(schema_version=1, created_at=f'2026-10-{day:02d}T01:00:00+00:00',
                    source=str(owner), file_count=1, files=[dict(path='sample.json', length=len(content),
                    sha256=hashlib.sha256(content).hexdigest() if valid else '0'*64)])
    (folder / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    return folder

def run(*args, success=True):
    default_root = [] if '-BackupRoot' in args else ['-BackupRoot', str(local)]
    result = subprocess.run([shell, '-NoProfile', '-File', str(repo / 'tools/run_backup_job.ps1'),
                            '-DataRoot', str(source), *default_root, *map(str, args)],
                            capture_output=True, text=True, encoding='utf-8', errors='replace')
    assert (result.returncode == 0) == success, result.stdout + result.stderr
    return result

def status():
    return json.loads((local / 'job-status/latest.json').read_text('utf-8-sig'))

valid = [snapshot(day) for day in range(1, 6)]
invalid, foreign = snapshot(6, valid=False), snapshot(7, owner=work/'different-source')
partial = local / '.runtime-20261008-010000-00000008.partial'
partial.mkdir()
arbitrary = local / 'manual-copy'
arbitrary.mkdir()
run('-BackupPath', valid[-1], '-KeepCount', '2')
s = status()
assert s['state'] == 'succeeded' and len(s['retention_plan']) == 3 and not s['removed']
assert s['last_successful_backup_created_at'].startswith('2026-10-05T01:00:00')
assert all(p.exists() for p in valid)
checks.append('retention defaults to plan only; invalid/foreign/incomplete directories preserved')

run('-BackupPath', valid[-1], '-OffsiteRoot', remote, '-KeepCount', '2')
replica = remote / valid[-1].name
assert (replica/'data/sample.json').read_bytes() == (valid[-1]/'data/sample.json').read_bytes()
run('-BackupPath', valid[-1], '-OffsiteRoot', remote, '-KeepCount', '2')
assert len(list(remote.iterdir())) == 1
checks.append('verified replica is atomic and repeatable')

last_success = status()['last_successful_at']
(replica/'data/sample.json').write_text('corrupted')
run('-BackupPath', valid[-1], '-OffsiteRoot', remote, '-KeepCount', '2', '-ApplyRetention', success=False)
assert status()['state'] == 'failed' and status()['last_successful_at'] == last_success
assert all(p.exists() for p in valid)
checks.append('corrupt replica blocks retention; failure preserves previous success and all local backups')
shutil.copy2(valid[-1]/'data/sample.json', replica/'data/sample.json')

run('-BackupPath', valid[-1], '-KeepCount', '2', '-ApplyRetention')
assert all(not p.exists() for p in valid[:3]) and all(p.exists() for p in valid[3:])
assert all(p.exists() for p in [invalid, foreign, partial, arbitrary])
checks.append('explicit retention removes only verified old snapshots of the selected source')

run('-BackupPath', valid[3], '-KeepCount', '1', '-ApplyRetention')
assert valid[3].exists() and valid[4].exists() and not status()['removed']
checks.append('verification of an older archive cannot evict the newest recovery point')

run('-BackupPath', invalid, success=False)
assert status()['state'] == 'failed' and status()['phase'] == 'verifying-local'
checks.append('corrupt local payload rejected before replication or retention')

# Windows exclusive handle reproduces a second scheduled invocation.
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
                              ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
kernel.CreateFileW.restype = ctypes.c_void_p
kernel.CloseHandle.argtypes = [ctypes.c_void_p]
previous = (local/'job-status/latest.json').read_bytes()
handle = kernel.CreateFileW(str(local/'job-status/run.lock'), 0xC0000000, 0, None, 3, 0x80, None)
assert handle not in (None, ctypes.c_void_p(-1).value)
try:
    result = run('-BackupPath', valid[-1], success=False)
    assert 'Another backup job is running' in result.stderr
    assert (local/'job-status/latest.json').read_bytes() == previous
finally:
    kernel.CloseHandle(handle)
checks.append('overlapping job refused without replacing existing run status')

assert 'must not overlap' in run('-BackupRoot', source/'nested', success=False).stderr
assert 'must not overlap' in run('-OffsiteRoot', local/'nested', success=False).stderr
checks.append('overlapping data, local and replica roots rejected')

alias = work / 'linked-replica'
created = subprocess.run([shell, '-NoProfile', '-Command',
    "New-Item -ItemType Junction -Path '" + str(alias) + "' -Target '" + str(remote) + "' | Out-Null"], capture_output=True)
assert created.returncode == 0
assert 'Links and junctions are not allowed' in run('-OffsiteRoot', alias, success=False).stderr
checks.append('linked replica root rejected before reading or copying snapshots')

processes = subprocess.run([shell, '-NoProfile', '-Command', '@(Get-Process exam_online_cpp -ErrorAction SilentlyContinue).Count'],
                           capture_output=True, text=True)
if int(processes.stdout.strip() or 0):
    run('-Mode', 'Create', success=False)
    assert status()['state'] == 'failed' and status()['phase'] == 'creating'
    checks.append('live-service offline guard retained; no service stopped')

report = dict(passed=True, checks=checks, work=str(work), live_data_modified=False,
              external_replica_configured=False, scheduled_job_enabled=False)
(work/'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
