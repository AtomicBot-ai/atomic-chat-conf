"""Prepare one pinned Strata bundle locally. Never publish, pip-install, or fetch models."""
import argparse
import gzip
import hashlib
import io
import json
import os
import posixpath
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
import atomic_owner_patch
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
LOCK = HERE / 'dependencies.json'
CANDIDATE = REPO / 'backends/strata-manifest.candidate.json'


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()


def safe_path(name):
    if not name or '\\' in name or ':' in name or '\x00' in name or name.startswith('/'):
        raise ValueError(f'Unsafe archive path: {name}')
    if any(p in ('', '.', '..') for p in name.split('/')):
        raise ValueError(f'Unsafe archive path: {name}')
    return name


def fetch(pin, cache):
    """Content-addressed cache; verify cached bytes as well as fresh downloads."""
    target = cache / pin['sha256']
    if target.exists():
        if target.stat().st_size != pin['size'] or digest(target) != pin['sha256']:
            raise ValueError(f'Cached hash/size mismatch: {pin["url"]}')
        return target
    if not pin['url'].startswith('https://'):
        raise ValueError('Build sources must use HTTPS')
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as tmp:
        name = Path(tmp.name)
        try:
            with urllib.request.urlopen(pin['url'], timeout=120) as src:
                shutil.copyfileobj(src, tmp)
            tmp.close()
            if name.stat().st_size != pin['size'] or digest(name) != pin['sha256']:
                raise ValueError(f'Download hash/size mismatch: {pin["url"]}')
            name.replace(target)
        finally:
            name.unlink(missing_ok=True)
    return target


def extract(archive, destination, *, omit_terminfo=False, gguf_only=False):
    """Extract into a new directory. Validate the whole namespace before writing."""
    destination.mkdir(parents=True, exist_ok=False)
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as z:
            records = []
            for m in z.infolist():
                name = safe_path(m.filename.rstrip('/'))
                relative = PurePosixPath(name).parts[1:]
                if gguf_only and (not relative or relative[0] not in ('LICENSE', 'gguf-py')):
                    continue
                mode = m.external_attr >> 16
                if mode & 0o170000 == 0o120000:
                    raise ValueError('ZIP symlinks are not supported')
                records.append((name, m, mode))
            if len({n.casefold() for n, _, _ in records}) != len(records):
                raise ValueError('Duplicate archive path')
            for name, m, mode in records:
                p = destination / name
                if m.is_dir():
                    p.mkdir(parents=True, exist_ok=True)
                else:
                    p.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(m) as src, p.open('wb') as dst:
                        shutil.copyfileobj(src, dst)
                    p.chmod(0o755 if mode & 0o111 else 0o644)
        return
    with tarfile.open(archive) as t:
        members = t.getmembers()
        if omit_terminfo:
            # Standalone Linux Python ships a case-sensitive ncurses database. Control is noninteractive.
            terminfo = PurePosixPath('python/share/terminfo')
            members = [m for m in members if not PurePosixPath(m.name).is_relative_to(terminfo)]
        names = [safe_path(m.name.rstrip('/')) for m in members]
        if len({n.casefold() for n in names}) != len(names):
            raise ValueError('Duplicate archive path')
        links = {m.name for m in members if m.issym() or m.islnk()}
        for m in members:
            if any(str(p) in links for p in PurePosixPath(m.name).parents):
                raise ValueError('Archive member is inside a link')
            if m.issym() or m.islnk():
                target = posixpath.normpath(posixpath.join(posixpath.dirname(m.name), m.linkname) if m.issym() else m.linkname)
                safe_path(target)
                if m.linkname.startswith('/') or target not in names:
                    raise ValueError('Unsafe or missing link target')
            elif not (m.isfile() or m.isdir()):
                raise ValueError('Special archive member')
        for m in members:
            p = destination / m.name
            if m.isdir():
                p.mkdir(parents=True, exist_ok=True)
            elif m.isfile():
                p.parent.mkdir(parents=True, exist_ok=True)
                with t.extractfile(m) as src, p.open('wb') as dst:
                    shutil.copyfileobj(src, dst)
                p.chmod(0o755 if m.mode & 0o111 else 0o644)
        for m in members:
            if m.issym() or m.islnk():
                p = destination / m.name
                p.parent.mkdir(parents=True, exist_ok=True)
                if m.issym(): p.symlink_to(m.linkname)
                else: os.link(destination / m.linkname, p)


def inventory(root):
    result = []
    for p in sorted(root.rglob('*')):
        name = p.relative_to(root).as_posix()
        if p.is_symlink():
            if not p.resolve().is_relative_to(root.resolve()):
                raise ValueError('Link escapes bundle')
            result.append({'path': name, 'link': os.readlink(p)})
        elif p.is_file():
            result.append({'path': name, 'size': p.stat().st_size, 'sha256': digest(p), 'executable': bool(p.stat().st_mode & 0o111)})
    return result


def archive_tree(root, target):
    with target.open('wb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0, compresslevel=6) as gz:
        with tarfile.open(fileobj=gz, mode='w', format=tarfile.PAX_FORMAT) as t:
            for p in sorted(root.rglob('*')):
                if p.is_dir() and not p.is_symlink(): continue
                info = t.gettarinfo(str(p), p.relative_to(root).as_posix())
                info.uid = info.gid = info.mtime = 0
                info.uname = info.gname = ''
                info.pax_headers = {}
                info.mode = 0o755 if info.mode & 0o111 else 0o644
                if info.isfile():
                    with p.open('rb') as f: t.addfile(info, f)
                else: t.addfile(info)


def check_component(root):
    manifest = json.loads((root / 'engine-component.json').read_text())
    for item in manifest['files']:
        p = root / safe_path(item['path'])
        if p.is_symlink() or not p.is_file() or p.stat().st_size != item['bytes'] or digest(p) != item['sha256']:
            raise ValueError(f'Component file mismatch: {item["path"]}')
    return manifest


def check_payload(root, roles, platform):
    python = 'python/python.exe' if platform == 'windows-x64' else 'python/bin/python3'
    required = ['strata.py', python, 'tools/iq_pack.py', 'tools/strata_tokenizer.py', 'tools/dflash2_pack.py', 'tools/dsv41/pack_gguf.py', 'third_party/llama.cpp/gguf-py/gguf/__init__.py']
    for name in required:
        if not (root / 'control' / name).is_file(): raise ValueError(f'Missing bundle input: {name}')
    site = root / 'control' / ('python/Lib/site-packages' if platform == 'windows-x64' else 'python/lib/python3.12/site-packages')
    for module in ['numpy', 'jsonschema', 'jsonschema_specifications', 'referencing', 'rpds', 'attrs']:
        if not (site / module / '__init__.py').is_file(): raise ValueError(f'Missing Python module: {module}')
    for role in roles:
        if role != 'control': check_component(root / 'components' / role)
    for p in root.rglob('*'):
        if p.is_file() and p.suffix.lower() in ('.gguf', '.safetensors', '.pack'):
            raise ValueError(f'Model weights must not be in a runtime bundle: {p.relative_to(root)}')
    if not list((root / 'licenses').rglob('LICENSE*')): raise ValueError('Missing notices')
    return 'control/' + python


def build(variant_id, cache, out, candidate_path=CANDIDATE, *, release_id=None, codesign_identity=None):
    candidate = json.loads(candidate_path.read_text())
    if candidate['dependency_lock']['sha256'] != digest(LOCK):
        raise ValueError('Candidate dependency lock digest differs')
    lock = json.loads(LOCK.read_text())
    variant = next(v for v in candidate['variants'] if v['id'] == variant_id)
    if release_id is not None:
        candidate['release_id'] = release_id
    assets = {a['name']: a for a in candidate['assets']}
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=out) as tmp:
        root = Path(tmp) / 'bundle'; root.mkdir()
        sources, roles = [], []
        for name in variant['components']:
            pin = assets[name]
            role = 'control' if name.startswith('strata-control-') else 'deepseek' if name.startswith('strata-dsv41-') else 'qwen'
            if role in roles: raise ValueError('Duplicate component role')
            roles.append(role)
            dest = root / 'control' if role == 'control' else root / 'components' / role
            extract(fetch(pin, cache), dest, omit_terminfo=role == 'control' and variant['platform'].startswith('linux-'))
            sources.append({k: pin[k] for k in ('name', 'url', 'size', 'sha256')})
        if 'control' not in roles or 'qwen' not in roles: raise ValueError('Incomplete bundle')
        patches = [atomic_owner_patch.apply(root / 'control')]
        # Upstream includes experimental projection weights. They belong to model acquisition, not the runtime.
        excluded = []
        for p in (root / 'control').rglob('*'):
            if p.is_file() and p.suffix.lower() in ('.gguf', '.safetensors', '.pack'):
                excluded.append({'path': p.relative_to(root).as_posix(), 'sha256': digest(p)})
                p.unlink()
        site = root / 'control' / ('python/Lib/site-packages' if variant['platform'] == 'windows-x64' else 'python/lib/python3.12/site-packages')
        wheels = [p for p in lock['python_dependencies'] if p['platform'] in ('all', variant['platform'])]
        if len(wheels) != 5: raise ValueError('Incomplete validator dependency closure')
        for pin in wheels:
            unpack = Path(tmp) / pin['filename']
            extract(fetch(pin, cache), unpack)
            if any(p.name.endswith('.data') for p in unpack.iterdir()): raise ValueError('Wheel needs unsupported install scheme')
            if not list(unpack.glob('*.dist-info/**/LICENSE*')) and not list(unpack.glob('*.dist-info/**/COPYING*')):
                raise ValueError(f'Wheel has no license: {pin["filename"]}')
            for p in unpack.iterdir():
                if (site / p.name).exists(): raise ValueError(f'Python dependency already exists: {p.name}')
                shutil.move(p, site / p.name)
        gguf = lock['gguf_source']
        unpack = Path(tmp) / 'llama-source'; extract(fetch(gguf, cache), unpack, gguf_only=True)
        source_root = next(unpack.iterdir())
        gguf_dest = root / 'control/third_party/llama.cpp/gguf-py'
        gguf_dest.parent.mkdir(parents=True)
        shutil.copytree(source_root / 'gguf-py', gguf_dest)
        license_dir = root / 'licenses/llama.cpp'; license_dir.mkdir(parents=True)
        shutil.copyfile(source_root / 'LICENSE', license_dir / 'LICENSE')
        for pin in lock['notices']:
            target = root / safe_path(pin['path']); target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(fetch(pin, cache), target)
        # Do not execute upstream setup or alter system Python. Wheels are unpacked at build time only.
        python_path = check_payload(root, roles, variant['platform'])
        signing = 'upstream-preserved'
        if variant['platform'] == 'macos-arm64':
            if sys.platform != 'darwin': raise ValueError('macOS repack requires a native runner for Python signing')
            # Upstream Python's hardened runtime rejects the added rpds wheel's Team ID.
            # This is a local candidate signature, never a distribution/notarization claim.
            binary = (root / python_path).resolve()
            timestamp = '--timestamp' if codesign_identity else '--timestamp=none'
            subprocess.run(['codesign', '--force', '--sign', codesign_identity or '-', '--options', 'runtime', timestamp, '--entitlements', str(REPO / '.github/entitlements.plist'), str(binary)], check=True)
            subprocess.run(['codesign', '--verify', '--strict', str(binary)], check=True)
            signing = 'macos-python-developer-id' if codesign_identity else 'macos-python-ad-hoc-development'
        if variant['platform'] == 'windows-x64' and release_id:
            # The current core archive validator rejects '+' in path segments.
            for path in (root / 'control/python/tcl/tcl8.6/tzdata').rglob('GMT+*'):
                if path.is_file():
                    path.unlink()
        provenance = {'schema_version': 1, 'release_id': candidate['release_id'], 'variant': variant_id, 'platform': variant['platform'], 'adapter_contract_version': 1, 'preparation_abi': candidate['preparation_abi'], 'sources': sources, 'patches': patches, 'dependencies': lock, 'excluded_model_files': excluded, 'python': python_path, 'roles': roles, 'signing': signing, 'qualification': 'candidate', 'files': inventory(root)}
        (root / 'bundle.json').write_bytes(json_bytes(provenance))
        name = f'{candidate["release_id"]}-{variant_id}.tar.gz'
        archive = Path(tmp) / name; archive_tree(root, archive)
        report = {'schema_version': 1, 'release_id': candidate['release_id'], 'variant': variant_id, 'archive': name, 'size': archive.stat().st_size, 'sha256': digest(archive), 'unpacked_bytes': sum(p.stat().st_size for p in root.rglob('*') if p.is_file() and not p.is_symlink()), 'bundle_manifest_sha256': digest(root / 'bundle.json'), 'python': python_path, 'signing': signing, 'qualification': 'candidate'}
        if (out / name).exists() and digest(out / name) != report['sha256']:
            raise ValueError('Refusing to replace an existing bundle with different bytes; bump release id')
        archive.replace(out / name)
        (out / (name + '.json')).write_bytes(json_bytes(report))
        print(json.dumps(report))
        return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--variant', required=True)
    parser.add_argument('--cache', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--release-id', choices=('strata-0.1.59-r6', 'strata-0.1.59-r7'))
    args = parser.parse_args()
    build(args.variant, args.cache, args.out, release_id=args.release_id,
          codesign_identity=os.environ.get('STRATA_CODESIGN_IDENTITY'))
