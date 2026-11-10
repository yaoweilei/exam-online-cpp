from pathlib import Path
import shutil
import sqlite3

repo = Path(__file__).resolve().parents[2]
runtime = repo / 'tmp' / 'mobile-ui-audit-20261101'
target = runtime / 'data'
target.mkdir(parents=True, exist_ok=True)
for area in ('user', 'paper', 'system'):
    source = repo / 'data' / area
    destination = target / area
    if destination.exists():
        raise SystemExit(f'Refusing to overwrite audit snapshot: {destination}')
    shutil.copytree(source, destination, ignore=shutil.ignore_patterns('*.sqlite3', '*.sqlite3-wal', '*.sqlite3-shm'))
    for database in source.rglob('*.sqlite3'):
        copied = destination / database.relative_to(source)
        with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as original:
            with sqlite3.connect(copied) as snapshot:
                original.backup(snapshot)
print(str(runtime))
