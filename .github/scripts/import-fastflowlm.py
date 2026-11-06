#!/usr/bin/env python3
"""Import the shipped FLM revision's XDNA2 chat catalog, never its recommendation flags.

Usage: python3 .github/scripts/import-fastflowlm.py FLM_CHECKOUT CORE_CHECKOUT
Weights are not downloaded: Hugging Face LFS metadata supplies their size/SHA-256.
Only immutable small files are downloaded to hash them; Git kernels come from the
exact engine source commit. A failed model aborts publication of the whole catalog.
"""
import concurrent.futures
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = pathlib.Path('/tmp/atomic-flm-catalog-import-cache')
MAX_SMALL = 32 * 1024 * 1024


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def fetch(url):
    key = hashlib.sha256(url.encode()).hexdigest()
    path = CACHE / key
    if path.exists():
        return path.read_bytes()
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                data = response.read(MAX_SMALL + 1)
            if len(data) > MAX_SMALL:
                raise ValueError('Refusing large non-LFS file: ' + url)
            path.write_bytes(data)
            return data
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


def chat_models(catalog):
    excluded = {'embeddings', 'decision', 'transcription', 'realtime-transcription'}
    return {f'{family}:{tag}': model
            for family, variants in catalog['models'].items()
            for tag, model in variants.items()
            if 'aie2p' in model['supported_platforms']
            and not excluded.intersection(model.get('label', []))}


def main():
    source, core = map(pathlib.Path, sys.argv[1:])
    CACHE.mkdir(exist_ok=True)
    manifest = read(ROOT / 'backends/fastflowlm-manifest.json')['releases'][0]
    commit, version = manifest['upstream_commit'], manifest['version']

    def git(*args):
        return subprocess.check_output(['git', '-C', str(source), *args])

    def blob(path):
        return git('show', f'{commit}:{path}')

    upstream = json.loads(blob('src/model_list.json'))
    selected = chat_models(upstream)
    catalog = read(ROOT / 'models/catalog.json')
    existing = {m['definition']['checkpoint']: m for m in catalog['models'].values()
                if m['kind'] == 'fastflowlm'}
    native_before = read(core / 'src/client/fastflowlm-native-profiles.json')
    evidence = f'https://github.com/ROCm/FastFlowLM/blob/{commit}/src/model_list.json'

    def import_model(item):
        checkpoint, model = item
        if existing.get(checkpoint, {}).get('definition', {}).get('qualification', {}).get('status') == 'qualified':
            entry = existing[checkpoint]
            entry['definition']['name'] = entry['definition']['name'].replace(' candidate', '')
            return checkpoint, entry, native_before[checkpoint]
        url = urllib.parse.urlparse(model['url'])
        if url.netloc != 'huggingface.co':
            raise ValueError('Unsupported model host: ' + model['url'])
        parts = url.path.strip('/').split('/')
        repo = '/'.join(parts[:2])
        ref = '/'.join(parts[3:]) if len(parts) > 2 else 'main'
        # Resolve the branch once, then request file metadata by immutable revision.
        metadata = json.loads(fetch(f'https://huggingface.co/api/models/{repo}/revision/{urllib.parse.quote(ref, safe="")}'))
        revision = metadata['sha']
        metadata = json.loads(fetch(f'https://huggingface.co/api/models/{repo}/revision/{revision}?blobs=true'))
        siblings = {f['rfilename']: f for f in metadata['siblings']}
        required = set(model['files'])
        if required - siblings.keys():
            raise ValueError(f'{checkpoint}: missing files {required - siblings.keys()}')
        sources = [{'id': 'flm', 'repo': repo, 'revision': revision},
                   {'id': 'flm-kernels', 'host': 'github', 'repo': 'ROCm/FastFlowLM', 'revision': commit}]
        files = {}
        text_files = {}

        def add(source_id, path, source_path, data=None, size=None, sha=None):
            if data is not None:
                size, sha = len(data), hashlib.sha256(data).hexdigest()
            files[path] = {'source': source_id, 'source_path': source_path, 'path': path, 'size': size, 'sha256': sha}

        for path, file in sorted(siblings.items()):
            if path.startswith('.'):
                continue
            # Include required payloads and ancillary config/license/kernel files.
            if path not in required and not re.search(r'(\.xclbin$|\.json$|\.jinja$|\.md$|LICENSE|NOTICE)', path, re.I):
                continue
            if file.get('lfs'):
                add('flm', path, path, size=file['size'], sha=file['lfs']['sha256'])
            else:
                data = fetch(f'https://huggingface.co/{repo}/resolve/{revision}/{urllib.parse.quote(path)}')
                if len(data) != file['size']:
                    raise ValueError('File size mismatch: ' + path)
                text_files[path] = data
                add('flm', path, path, data=data)
        kernel_dir = 'src/xclbins/' + model['name']
        for path in git('ls-tree', '-r', '--name-only', commit, kernel_dir).decode().splitlines():
            if not path.endswith('.xclbin'):
                continue
            add('flm-kernels', path[len(kernel_dir) + 1:], path, data=blob(path))
        if not any(p.endswith('.xclbin') for p in files):
            raise ValueError('No kernels for ' + checkpoint)
        add('flm-kernels', 'LICENSE_BINARY.txt', 'LICENSE_BINARY.txt', data=blob('LICENSE_BINARY.txt'))
        template = [p for p in files if p.endswith('.jinja')]
        if not template:
            tokenizer = json.loads(text_files.get('tokenizer_config.json') or fetch(
                f'https://huggingface.co/{repo}/resolve/{revision}/tokenizer_config.json'))
            if not tokenizer.get('chat_template'):
                raise ValueError('Missing chat template: ' + checkpoint)
            template = ['tokenizer_config.json']
        components = {
            'weights': [p for p in files if p.endswith(('.q4nx', '.bin', '.safetensors'))],
            'tokenizer': [p for p in files if p.startswith('tokenizer')],
            'config': [p for p in files if p.endswith('config.json') and not p.startswith('tokenizer')],
            'chat_template': template,
            'kernels': [p for p in files if p.endswith('.xclbin')],
        }
        covered = {p for paths in components.values() for p in paths}
        components['metadata'] = [p for p in files if p not in covered]
        card = metadata.get('cardData') or {}
        license_id = card.get('license_name') or card.get('license') or 'See model repository license'
        labels = model.get('label', [])
        model_id = checkpoint.replace(':', '-')
        variant = model_id + '-npu2'
        definition = {
            'model_id': model_id, 'variant_id': variant,
            'name': checkpoint + ' (FastFlowLM NPU2)', 'checkpoint': checkpoint,
            'minimum_flm_version': version, 'local_only_protocol': 1, 'npu_generation': 'xdna2',
            'context_length': model['default_context_length'],
            'recommended': existing.get(checkpoint, {}).get('definition', {}).get('recommended', False),
            'license': license_id + ' AND LicenseRef-FastFlowLM-NPU-Binary',
            'gated': bool(metadata.get('gated')),
            'capabilities': {'chat': True, 'tools': 'tool-calling' in labels,
                             'reasoning': 'reasoning' in labels or bool(model['details'].get('think')),
                             'structured_output': False},
            'sources': sources, 'files': sorted(files.values(), key=lambda f: f['path']),
            'components': components, 'qualification': {'status': 'upstream', 'evidence': [evidence]},
        }
        profile_keys = ['size', 'flm_min_version', 'max_prefill_len', 'max_bench_length',
                        'default_context_length', 'details', 'label', 'scratch', 'vlm', 'asr']
        profile = {k: model[k] for k in profile_keys if k in model}
        profile['files'] = sorted(required | set(components['kernels']))
        print(checkpoint + ': pinned ' + str(len(files)) + ' files', flush=True)
        return checkpoint, {'kind': 'fastflowlm', 'format': 'fastflowlm', 'definition': definition,
                            'variants': {variant: {'selection': 'all-required-files'}}}, profile

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        imported = list(pool.map(import_model, selected.items()))
    catalog['models'] = {k: m for k, m in catalog['models'].items() if m['kind'] != 'fastflowlm'}
    refs, profiles = [], {}
    for checkpoint, entry, profile in imported:
        key = 'fastflowlm:' + entry['definition']['model_id']
        catalog['models'][key] = entry
        refs.append({'model': key, 'variant': entry['definition']['variant_id']})
        profiles[checkpoint] = profile
    catalog['collections']['fastflowlm-models'] = {'header': {'schema_version': 1}, 'entries': refs}
    write(ROOT / 'models/catalog.json', catalog)
    write(ROOT / '.github/fixtures/fastflowlm/upstream-catalog.json', upstream)
    write(core / 'src/client/fastflowlm-native-profiles.json', profiles)
    print(f'Imported {len(imported)} XDNA2 chat checkpoints; recommendation collections unchanged.')


if __name__ == '__main__':
    main()
