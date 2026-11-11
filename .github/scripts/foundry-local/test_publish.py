import tempfile
import unittest
from pathlib import Path

from pack import LEGACY_WINDOWS_ARCHIVE, payload, write_archive
from publish import verify_existing_asset
from test_pack import runtime


class ExistingAssets(unittest.TestCase):
    def test_keeps_the_original_archive_and_checks_its_native_bytes(self):
        with tempfile.TemporaryDirectory() as tmp, runtime('win-x64') as source:
            path = Path(tmp) / LEGACY_WINDOWS_ARCHIVE
            packages = [('Microsoft.AI.Foundry.Local.Runtime', source)]
            files, links = payload('win-x64', packages)
            write_archive(path, files, links)
            verify_existing_asset(path.name, path, Path(tmp) / 'new-assets', packages)
            files['lib/foundry_local.dll'] = (b'tampered', 0o644)
            write_archive(path, files, links)
            with self.assertRaisesRegex(ValueError, 'differs'):
                verify_existing_asset(path.name, path, Path(tmp) / 'new-assets', packages)

    def test_refuses_a_changed_archive_under_the_new_published_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'local').mkdir()
            (root / 'local' / 'new.zip').write_bytes(b'expected')
            remote = root / 'new.zip'
            remote.write_bytes(b'modified')
            with self.assertRaisesRegex(ValueError, 'Published asset differs'):
                verify_existing_asset(remote.name, remote, root / 'local', [])


if __name__ == '__main__':
    unittest.main()
