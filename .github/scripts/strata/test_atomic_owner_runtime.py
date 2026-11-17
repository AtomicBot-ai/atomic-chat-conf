import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import atomic_owner_runtime as owner


class AtomicOwnerLedgerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.profile = 'atomic-' + 'a' * 32
        self.private = SimpleNamespace(private_mkdir=lambda p, **kw: p.mkdir(parents=True, exist_ok=True),
                                       restrict_to_current_user=lambda p, **kw: None)
        self.procs = SimpleNamespace(start_token=lambda pid: 'token-' + str(pid), command_line=lambda pid: ['child'])
        self.modules = {'strata_control': SimpleNamespace(paths=SimpleNamespace(state_base=lambda: self.root),
                                                         procs=self.procs, private_files=self.private)}
        self.env = patch.dict(os.environ, {'STRATA_ATOMIC_OWNER': '1'})
        self.env.start(); self.addCleanup(self.env.stop)
        modules = patch.dict('sys.modules', self.modules)
        modules.start(); self.addCleanup(modules.stop)

    def rows(self):
        return [json.loads(path.read_text()) for path in self.root.rglob('*.json')]

    def test_spawn_is_bracketed_by_durable_intent_and_retained_identity(self):
        child = SimpleNamespace(pid=101)
        def spawn(*args, **kwargs):
            self.assertEqual(self.rows()[0]['phase'], 'launching')
            return child
        with patch.object(owner.subprocess, 'Popen', side_effect=spawn):
            self.assertIs(owner.popen('engine', self.profile, ['child']), child)
        row = self.rows()[0]
        self.assertEqual((row['phase'], row['pid'], row['token']), ('owned', 101, 'token-101'))
        self.assertEqual(row['profile'], self.profile)
        self.assertEqual(row['cmd'], ['child'])

    def test_record_failure_before_spawn_never_launches(self):
        with patch.object(owner, '_write', side_effect=OSError('disk full')), patch.object(owner.subprocess, 'Popen') as spawn:
            with self.assertRaises(OSError): owner.popen('engine', self.profile, ['child'])
            spawn.assert_not_called()

    def test_record_failure_after_spawn_kills_and_waits_before_returning_error(self):
        child = Mock(pid=101)
        original = owner._write
        calls = []
        def write(path, row):
            calls.append(row['phase'])
            if len(calls) == 2: raise OSError('disk full')
            original(path, row)
        with patch.object(owner, '_write', side_effect=write), patch.object(owner.subprocess, 'Popen', return_value=child):
            with self.assertRaises(OSError): owner.popen('engine', self.profile, ['child'])
        child.kill.assert_called_once(); child.wait.assert_called_once()
        self.assertEqual(self.rows()[0]['phase'], 'exited')

    def test_failed_spawn_is_distinct_from_a_crash_during_spawn(self):
        with patch.object(owner.subprocess, 'Popen', side_effect=FileNotFoundError()):
            with self.assertRaises(FileNotFoundError): owner.popen('engine', self.profile, ['child'])
        self.assertEqual(self.rows()[0]['phase'], 'not-started')

    def test_standalone_is_unchanged_and_atomic_cannot_write_another_profile(self):
        with patch.object(owner.subprocess, 'Popen', return_value='standalone') as spawn:
            os.environ.pop('STRATA_ATOMIC_OWNER')
            self.assertEqual(owner.popen('engine', 'user-profile', ['child']), 'standalone')
            self.assertEqual(self.rows(), [])
            os.environ['STRATA_ATOMIC_OWNER'] = '1'
            with self.assertRaises(ValueError): owner.popen('engine', '../foreign', ['child'])
            self.assertEqual(spawn.call_count, 1)


if __name__ == '__main__': unittest.main()
