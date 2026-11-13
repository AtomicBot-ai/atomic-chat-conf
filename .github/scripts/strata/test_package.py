import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
import pack


class StrataPackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def payload(self):
        root = self.root / 'bundle'
        for name in ['strata.py', 'python/bin/python3', 'tools/iq_pack.py', 'tools/strata_tokenizer.py', 'tools/dflash2_pack.py', 'tools/dsv41/pack_gguf.py', 'third_party/llama.cpp/gguf-py/gguf/__init__.py']:
            p = root / 'control' / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b'fixture')
        for module in ['numpy', 'jsonschema', 'jsonschema_specifications', 'referencing', 'rpds', 'attrs']:
            p = root / 'control/python/lib/python3.12/site-packages' / module / '__init__.py'
            p.parent.mkdir(parents=True); p.write_bytes(b'')
        p = root / 'licenses/LICENSE'; p.parent.mkdir(); p.write_bytes(b'Synthetic fixture only')
        for role in ['qwen', 'deepseek']:
            path = root / 'components' / role; path.mkdir(parents=True)
            binary = path / 'strata'; binary.write_bytes(b'fixture'); binary.chmod(0o755)
            (path / 'engine-component.json').write_text(json.dumps({'files': [{'path': 'strata', 'bytes': 7, 'sha256': pack.digest(binary)}]}))
        return root

    def test_bundle_requires_offline_dependency_closure_and_both_compute_components(self):
        root = self.payload()
        roles = ['control', 'qwen', 'deepseek']
        self.assertEqual(pack.check_payload(root, roles, 'macos-arm64'), 'control/python/bin/python3')
        p = root / 'control/python/lib/python3.12/site-packages/rpds/__init__.py'; p.unlink()
        with self.assertRaisesRegex(ValueError, 'rpds'): pack.check_payload(root, roles, 'macos-arm64')
        p.write_bytes(b'')
        (root / 'components/deepseek/strata').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'Component file mismatch'): pack.check_payload(root, roles, 'macos-arm64')

    def test_model_weights_are_not_runtime_components(self):
        root = self.payload(); (root / 'control/accidental.gguf').write_bytes(b'GGUF')
        with self.assertRaisesRegex(ValueError, 'Model weights'): pack.check_payload(root, ['control', 'qwen'], 'macos-arm64')

    def test_reproducible_archive_and_metadata_ignore_source_mtime(self):
        root = self.payload()
        before = pack.json_bytes(pack.inventory(root))
        a, b = self.root / 'a.tar.gz', self.root / 'b.tar.gz'
        pack.archive_tree(root, a)
        for p in root.rglob('*'): os.utime(p, (1234, 5678))
        pack.archive_tree(root, b)
        self.assertEqual(a.read_bytes(), b.read_bytes())
        self.assertEqual(before, pack.json_bytes(pack.inventory(root)))
        unpack = self.root / 'unpacked'; pack.extract(a, unpack)
        self.assertEqual(pack.inventory(root), pack.inventory(unpack))

    def test_extraction_rejects_traversal_duplicates_and_link_parent(self):
        for index, names in enumerate([['../escape'], ['/absolute'], ['same', 'same'], ['Case', 'case']]):
            archive = self.root / f'bad-{index}.tar'
            with tarfile.open(archive, 'w') as t:
                for name in names:
                    m = tarfile.TarInfo(name); m.size = 1; t.addfile(m, io.BytesIO(b'x'))
            with self.assertRaises(ValueError): pack.extract(archive, self.root / f'bad-{index}')
        archive = self.root / 'links.tar'
        with tarfile.open(archive, 'w') as t:
            m = tarfile.TarInfo('dir'); m.type = tarfile.SYMTYPE; m.linkname = '../escape'; t.addfile(m)
            m = tarfile.TarInfo('dir/file'); m.size = 1; t.addfile(m, io.BytesIO(b'x'))
        with self.assertRaises(ValueError): pack.extract(archive, self.root / 'bad-link')

    def test_cached_archive_is_verified_before_reuse(self):
        cache = self.root / 'cache'; cache.mkdir()
        pin = {'sha256': 'a' * 64, 'size': 3, 'url': 'https://example.invalid/test'}
        (cache / pin['sha256']).write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError, 'Cached hash'): pack.fetch(pin, cache)

    def test_build_rejects_changed_dependency_lock_before_download(self):
        candidate = self.root / 'candidate.json'
        candidate.write_text(json.dumps({'dependency_lock': {'sha256': '0' * 64}}))
        with self.assertRaisesRegex(ValueError, 'dependency lock digest'):
            pack.build('macos-arm64-metal', self.root / 'cache', self.root / 'out', candidate)


if __name__ == '__main__': unittest.main()
