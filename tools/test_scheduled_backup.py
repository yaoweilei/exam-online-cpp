"""Isolated maintenance drill using the real backend on 8083, never live data.

The fixture's process inventory ignores the unrelated live server. Only the
fixture copy of the offline script narrows its process guard to the test exe;
the installed scripts keep their conservative all-backends guard.
"""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import time
import urllib.request
import uuid
import datetime

repo=pathlib.Path(__file__).resolve().parents[1]
work=repo/'tmp'/('scheduled-drill-'+uuid.uuid4().hex)
fixture=work/'repo'
data=fixture/'data'
runtime=work/'runtime'
backups=work/'backups'
runtime.mkdir(parents=True)
(fixture/'tools').mkdir(parents=True)
(fixture/'static').mkdir()
(fixture/'static/index.html').write_text('<main>Isolated maintenance drill</main>')
for area in ['paper/jlpt/n3','user','system']:
    (data/area).mkdir(parents=True)
shutil.copy2(repo/'data/paper/jlpt/n3/N3_2024_12.json',data/'paper/jlpt/n3/N3_2024_12.json')
for file in (repo/'backend/build/MinSizeRel').glob('*.dll'):
    shutil.copy2(file,runtime/file.name)
exe=runtime/'exam_online_cpp.exe'
shutil.copy2(repo/'backend/build/MinSizeRel/exam_online_cpp.exe',exe)
for name in ['backup_runtime_data.ps1','restore_runtime_data.ps1','run_backup_job.ps1','start_backup_backend.ps1']:
    shutil.copy2(repo/'tools'/name,fixture/'tools'/name)
core=fixture/'tools/backup_runtime_data.ps1'
original=core.read_text('utf-8-sig')
old="if (Get-Process exam_online_cpp -ErrorAction SilentlyContinue) {"
assert old in original
core.write_text(original.replace(old,"if (@(Get-Process exam_online_cpp -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:TEST_MANAGED_EXE }).Count) {"),encoding='utf-8')
config=dict(schema_version=1,repo_root=str(fixture),exe_path=str(exe),data_root=str(data),backup_root=str(backups),
            offsite_root='',keep_count=2,port=8083,environment=dict(APP_ENV='development',HOST='127.0.0.1',THREADS='1',EMAIL_PROVIDER='stub',SMS_PROVIDER='stub',LOG_DIR=str(work/'logs')))
configfile=work/'config.json';configfile.write_text(json.dumps(config),encoding='utf-8')
shell=shutil.which('pwsh')
harness=work/'harness.ps1'
harness.write_text('''param([string]$Config,[string]$Runner,[string]$ManagedExe)
$env:TEST_MANAGED_EXE=$ManagedExe
function Get-Process {
    [CmdletBinding()]param([string[]]$Name,[int[]]$Id)
    $query=@{};if ($Name) {$query.Name=$Name};if ($Id) {$query.Id=$Id}
    Microsoft.PowerShell.Management\\Get-Process @query -ErrorAction SilentlyContinue | Where-Object { $Id -or $_.ProcessName -ne 'exam_online_cpp' -or $_.Path -eq $ManagedExe }
}
& $Runner -ConfigPath $Config
'''.replace('\n+','\n'),encoding='utf-8')
env=dict(os.environ,BASE_DIR=str(fixture),DATA_ROOT=str(data),PORT='8083',**config['environment'])
env.pop('BACKUP_STATUS_FILE',None)
stdout=(work/'initial.out.log').open('w');stderr=(work/'initial.err.log').open('w')
process=subprocess.Popen([str(exe)],cwd=fixture,env=env,stdout=stdout,stderr=stderr,creationflags=subprocess.CREATE_NO_WINDOW)
initial_pid=process.pid
def healthy():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8083/readyz',timeout=2) as r:return json.load(r)['data']['status']=='ready'
    except OSError:return False
def wait_healthy():
    for _ in range(90):
        if healthy():return
        time.sleep(.5)
    raise AssertionError('Isolated backend did not become ready')
def run(success=True):
    result=subprocess.run([shell,'-NoProfile','-ExecutionPolicy','Bypass','-File',str(harness),'-Config',str(configfile),
        '-Runner',str(repo/'tools/invoke_scheduled_backup.ps1'),'-ManagedExe',str(exe)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
    assert (result.returncode==0)==success,result.stdout+result.stderr
    wait_healthy()
    return result
def state():return json.loads((backups/'job-status/latest.json').read_text('utf-8-sig'))
checks=[]
try:
    wait_healthy()
    run()
    s=state();assert s['state']=='succeeded'
    snapshot=pathlib.Path(s['backup_path'])
    manifest=json.loads((snapshot/'manifest.json').read_text('utf-8-sig'))
    assert abs((datetime.datetime.fromisoformat(s['last_successful_backup_created_at'])-datetime.datetime.fromisoformat(manifest['created_at'])).total_seconds()) < 1
    for item in manifest['files']:
        payload=(snapshot/'data'/item['path']).read_bytes()
        assert hashlib.sha256(payload).hexdigest()==item['sha256']
    checks.append('real isolated backend stopped, physical snapshot created, restarted and ready before verification')
    core.write_text("throw 'Injected snapshot failure after backend stop'",encoding='utf-8')
    run(success=False)
    assert state()['state']=='failed' and state()['last_successful_at']==s['last_successful_at']
    checks.append('snapshot failure still restarts service, preserves prior success and records failure')
    # Confirm a different process identity cannot accidentally stop the live exe.
    config['exe_path']=str(repo/'backend/build/MinSizeRel/exam_online_cpp.exe')
    configfile.write_text(json.dumps(config),encoding='utf-8')
    run(success=False)
    assert healthy()
    checks.append('unexpected executable identity rejected before stopping any service')
    report=dict(passed=True,checks=checks,scope='isolated 8083 with fixture-only process-inventory adapter',work=str(work),live_data_modified=False)
    (work/'verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))
finally:
    # Exact path only. The normal live backend has a different absolute path.
    escaped=str(exe).replace("'","''")
    subprocess.run([shell,'-NoProfile','-Command',"Get-Process exam_online_cpp -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '"+escaped+"' } | Stop-Process"],capture_output=True)
    stdout.close();stderr.close()
