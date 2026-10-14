#!/usr/bin/env python3
"""Package only the audited server modules, never runtime data or credentials."""
import argparse, hashlib, tarfile
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
output = Path(args.output).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
allowed = {'.cjs', '.js', '.py', '.md', '.service', '.timer'}
with tarfile.open(output, 'w:gz') as archive:
    for file in sorted(root.iterdir()):
        if file.is_file() and (file.suffix in allowed or file.name == 'VERSION'):
            archive.add(file, arcname='reliability/' + file.name)
checksum = output.with_name(output.name + '.sha256')
checksum.write_text(hashlib.sha256(output.read_bytes()).hexdigest() + '  ' + output.name + '\n')
print(output)
