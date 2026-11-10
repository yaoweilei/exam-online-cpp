"""Offline recovery drill. Accepts only a disposable data root beneath repo/tmp."""
import json
import pathlib
import re
import shutil
import sqlite3
import subprocess
import sys
import uuid

repo = pathlib.Path(__file__).resolve().parents[1]
source = pathlib.Path(sys.argv[1]).resolve()
assert source.is_relative_to(repo / 'tmp') and source.is_dir(), 'Use isolated test data only'
work = repo / 'tmp' / ('runtime-recovery-' + uuid.uuid4().hex)
work.mkdir()
input_source = source
physical = work / 'physical-source'
def ignore_links(folder, names):
    return [name for name in names if (pathlib.Path(folder) / name).is_symlink() or (pathlib.Path(folder) / name).is_junction()]
shutil.copytree(source, physical, ignore=ignore_links)
# Test fixtures link shared media; materialize two samples per media tree instead
# of making a backup follow junctions outside its chosen data root.
for name in ['audio', 'image']:
    media_root = source / name
    if media_root.exists() and (media_root.is_symlink() or media_root.is_junction()):
        for item in [p for p in media_root.rglob('*') if p.is_file()][:2]:
            destination = physical / name / item.relative_to(media_root)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, destination)
source = physical
shell = shutil.which('pwsh') or shutil.which('powershell')

def run(script, *args, success=True):
    result = subprocess.run([shell, '-NoProfile', '-File', str(repo / 'tools' / script), *map(str, args)], capture_output=True, text=True, encoding='utf-8', errors='replace')
    assert (result.returncode == 0) == success, result.stdout + result.stderr
    return result.stdout

output = run('backup_runtime_data.ps1', '-DataRoot', source, '-BackupRoot', work / 'backups')
backup = pathlib.Path(re.search(r'BACKUP_PATH=([^\r\n]+)', output).group(1))
restored = work / 'restored-data'
run('restore_runtime_data.ps1', '-BackupPath', backup, '-DestinationDataRoot', restored, '-Confirmation', 'RESTORE_RUNTIME_DATA')
manifest_file = backup / 'manifest.json'
manifest_text = manifest_file.read_text('utf-8-sig')
manifest = json.loads(manifest_text)
databases = []
for dbfile in restored.rglob('*.sqlite3'):
    relative = dbfile.relative_to(restored)
    with sqlite3.connect(dbfile) as db, sqlite3.connect(source / relative) as original:
        assert db.execute('pragma integrity_check').fetchone()[0] == 'ok'
        actual = db.execute('select namespace,entity_key,payload from json_entities order by namespace,entity_key').fetchall()
        expected = original.execute('select namespace,entity_key,payload from json_entities order by namespace,entity_key').fetchall()
        assert actual == expected, relative
        organizations = [json.loads(row[2]) for row in actual if row[0] == 'organizations']
        databases.append({'path': str(relative), 'records': len(actual), 'organizations': len(organizations), 'lesson_ledger_entries': sum(len(row.get('lesson_ledger', [])) for row in organizations)})
assert databases, 'The drill must include real SQLite data'
media = [entry for entry in manifest['files'] if pathlib.Path(entry['path']).suffix.lower() in {'.mp3', '.png', '.jpg'}]
assert media, 'The drill must include media'
extra = backup / 'data' / 'unlisted-test.json'
extra.write_text('{}')
run('restore_runtime_data.ps1', '-BackupPath', backup, '-VerifyOnly', success=False)
extra.unlink()
entry = manifest['files'][0]
target = backup / 'data' / entry['path']
original_bytes = target.read_bytes()
target.write_bytes(original_bytes + b'changed')
run('restore_runtime_data.ps1', '-BackupPath', backup, '-VerifyOnly', success=False)
target.write_bytes(original_bytes)
duplicate = json.loads(manifest_text)
duplicate['files'][1] = duplicate['files'][0]
manifest_file.write_text(json.dumps(duplicate), encoding='utf-8')
run('restore_runtime_data.ps1', '-BackupPath', backup, '-VerifyOnly', success=False)
unsafe = json.loads(manifest_text)
unsafe['files'][0]['path'] = '../outside'
manifest_file.write_text(json.dumps(unsafe), encoding='utf-8')
run('restore_runtime_data.ps1', '-BackupPath', backup, '-VerifyOnly', success=False)
manifest_file.write_text(manifest_text, encoding='utf-8')
run('restore_runtime_data.ps1', '-BackupPath', backup, '-VerifyOnly')
report = {'passed': True, 'input_source': str(input_source), 'source': str(source), 'scope': 'isolated runtime data with sampled shared media', 'restored': str(restored), 'files': manifest['file_count'], 'media': len(media), 'databases': databases, 'rejected': ['unlisted file', 'changed payload', 'duplicate manifest path', 'unsafe manifest path'], 'live_data_modified': False}
(work / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
