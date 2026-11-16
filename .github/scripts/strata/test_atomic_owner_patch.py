import tempfile
import unittest
from pathlib import Path
import atomic_owner_patch as overlay

class AtomicOwnerPatchTests(unittest.TestCase):
    def test_patch_records_bytes_and_refuses_unknown_or_repeated_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'serve').mkdir(); (root / 'strata_control').mkdir()
            path = root / 'serve/server.py'
            path.write_text(overlay.ANCHOR)
            (root / 'strata_control/runtime.py').write_text('import subprocess\n' +
                '            proc = subprocess.Popen(command,\n' +
                '                    self.child = subprocess.Popen([sys.executable, "-m", "serve.server", *server_args],\n' * 2)
            (root / 'serve/lifeline.py').write_text('import subprocess\n' + '    except OSError:\n        return\n    with _watchers_lock:\n' +
                '        watcher = subprocess.Popen([sys.executable, "-S", "-c", _WATCHER, str(child.pid), _start_token(child.pid)],\n' +
                '        child = _the_anchor().call(lambda: subprocess.Popen(args, **kw))\n' +
                '        child = subprocess.Popen(args, **kw)\n')
            record = overlay.apply(root)
            self.assertNotEqual(record['upstream_sha256'], record['patched_sha256'])
            self.assertIn('Atomic owns model residency', path.read_text())
            self.assertIn('atomic_popen("owner", name, command,', (root / 'strata_control/runtime.py').read_text())
            self.assertIn('atomic_popen(role,', (root / 'serve/lifeline.py').read_text())
            self.assertEqual(len(record['files']), 3)
            self.assertIn('OWNER_CONTRACT = 3', (root / 'strata_control/atomic_owner.py').read_text())
            with self.assertRaises(ValueError): overlay.apply(root)
            path.write_text('new upstream')
            with self.assertRaises(ValueError): overlay.apply(root)

if __name__ == '__main__': unittest.main()
