"""Repackage verified public binaries on GitHub; never reads the private source repo."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import struct
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED

root = Path.cwd()
out = root / 'release-output'
out.mkdir(exist_ok=True)
repo = os.environ['GITHUB_REPOSITORY']
tag = 'v0.8.4'

def run(*args, **kwargs):
    subprocess.run(args, check=True, **kwargs)

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

parts = {
    'siyuan-voice-notes-0.8.2-full.zip.001': 'dda99d4674dfb7cd6be21eda8f1e8188f1d80d099de2887a87ae039119c23e40',
    'siyuan-voice-notes-0.8.2-full.zip.002': '3dfb8037abfe01510d6ad56de6b8e4b99fb810520af1bfd01263f08f8a75ba1e',
}
for name, expected in parts.items():
    run('gh', 'release', 'download', 'v0.8.2', '--repo', repo, '--pattern', name, '--dir', str(out))
    assert sha(out / name) == expected, name
run('gh', 'release', 'download', tag, '--repo', repo, '--pattern', 'release-overlay.zip', '--dir', str(out))
assert sha(out / 'release-overlay.zip') == os.environ['OVERLAY_SHA256']

full = out / 'full-windows.zip'
with full.open('wb') as dst:
    for name in parts:
        with (out / name).open('rb') as src:
            shutil.copyfileobj(src, dst)
        (out / name).unlink()
assert sha(full) == '740ba133486a482fc906c3f55bec39bd1ff19d57f5ad49dd20268fb960ab358b'
with ZipFile(full) as archive:
    original_manifest = json.loads(archive.read('MANIFEST.json'))
with ZipFile(out / 'release-overlay.zip') as patch:
    expected_core = json.loads(patch.read('EXPECTED-CORE-MANIFEST.json'))
    overlay = {n: patch.read(n) for n in patch.namelist() if n != 'EXPECTED-CORE-MANIFEST.json'}
assert json.loads(overlay['build.json'])['flavor'] == 'full'
assert json.loads(overlay['plugin.json'])['version'] == tag[1:]
assert json.loads(overlay['plugin.json'])['url'] == 'https://github.com/' + repo
manifest = original_manifest
for name, data in overlay.items():
    path = PurePosixPath(name)
    assert not path.is_absolute() and '..' not in path.parts and '\\' not in name
    manifest['files'][name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
overlay['MANIFEST.json'] = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
stage = out / 'overlay'
stage.mkdir()
for name, data in overlay.items():
    file = stage / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(data)
run('zip', '-q', str(full), *sorted(overlay), cwd=stage)

# Info-ZIP on Linux needs explicit UTF-8 flags for the Chinese documentation names.
with ZipFile(full, metadata_encoding='utf-8') as archive:
    entries, central_offset = archive.infolist(), archive.start_dir
with full.open('r+b') as stream:
    for entry in entries:
        stream.seek(central_offset)
        header = stream.read(46)
        assert header[:4] == b'PK\x01\x02'
        name_len, extra_len, comment_len = struct.unpack_from('<HHH', header, 28)
        if not entry.filename.isascii():
            stream.seek(central_offset + 8)
            stream.write(struct.pack('<H', entry.flag_bits | 0x800))
            stream.seek(entry.header_offset + 6)
            flags = struct.unpack('<H', stream.read(2))[0]
            stream.seek(entry.header_offset + 6)
            stream.write(struct.pack('<H', flags | 0x800))
        central_offset += 46 + name_len + extra_len + comment_len

def verify(path, expected=None):
    with ZipFile(path) as archive:
        m = json.loads(archive.read('MANIFEST.json'))
        metadata = json.loads(archive.read('plugin.json'))
        assert metadata['url'] == 'https://github.com/' + repo
        assert metadata['name'] == 'siyuan-voice-notes'
        if expected is not None:
            assert m == expected
        names = archive.namelist()
        assert len(names) == len(set(names))
        assert set(names) == set(m['files']) | {'MANIFEST.json'}
        assert not any(n.startswith(('src/', 'issuer/', 'tests/', '.git/', 'node_modules/')) for n in names)
        for name, record in m['files'].items():
            h = hashlib.sha256()
            size = 0
            with archive.open(name) as src:
                while chunk := src.read(4 * 1024 * 1024):
                    h.update(chunk)
                    size += len(chunk)
            assert h.hexdigest() == record['sha256'] and size == record['bytes'], name
    print('Verified:', path.name, len(names), 'entries', flush=True)

verify(full)
package = out / 'package.zip'
with ZipFile(full) as src, ZipFile(package, 'w', ZIP_DEFLATED, compresslevel=6) as dst:
    for name in sorted(expected_core['files']):
        with src.open(name) as incoming, dst.open(name, 'w', force_zip64=True) as target:
            shutil.copyfileobj(incoming, target, 4 * 1024 * 1024)
    dst.writestr('MANIFEST.json', json.dumps(expected_core, indent=2))
verify(package, expected_core)
# Gate publishing on the official marketplace's complete checks, not only hashes.
check_root = out / 'bazaar-check-package'
with ZipFile(package) as archive:
    archive.extractall(check_root)
run(os.environ['BAZAAR_CHECKER'], str(check_root), str(package), repo)
assert package.stat().st_size < 2_000_000_000
split_parts = []
with full.open('rb') as incoming:
    index = 1
    while True:
        chunk = incoming.read(1500 * 1024 * 1024)
        if not chunk:
            break
        target = out / f'full-windows.zip.{index:03d}'
        target.write_bytes(chunk)
        split_parts.append(target)
        index += 1
assert len(split_parts) == 2
shutil.copy2(root / 'INSTALL.md', out / 'INSTALL.md')
assets = [package, *split_parts, out / 'INSTALL.md']
checks = {p.name: sha(p) for p in [full, *assets]}
(out / 'SHA256SUMS.txt').write_text(''.join(f'{digest}  {name}\n' for name, digest in checks.items()))
assets.append(out / 'SHA256SUMS.txt')
# All local and official rules must pass before replacing any release attachment.
for path in assets:
    run('gh', 'release', 'upload', tag, str(path), '--repo', repo, '--clobber')
release = json.loads(subprocess.check_output(['gh', 'api', f'repos/{repo}/releases', '--jq', f'.[]|select(.tag_name=="{tag}")']))
remote = {a['name']: a for a in release['assets']}
for path in assets:
    assert remote[path.name]['size'] == path.stat().st_size
    assert remote[path.name]['digest'] == 'sha256:' + sha(path)
run('gh', 'release', 'edit', tag, '--repo', repo, '--draft=false', '--latest', '--title', f'思源语音 Full {tag[1:]}', '--notes-file', str(root / 'RELEASE-NOTES.md'))
print('RELEASE_PUBLISHED_AND_VERIFIED', json.dumps(checks), flush=True)
