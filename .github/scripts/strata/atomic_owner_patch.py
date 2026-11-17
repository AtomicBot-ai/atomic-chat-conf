"""Fail-closed, hash-recorded Control overlay for Atomic-owned model residency."""
import hashlib
from pathlib import Path

HELPER = Path(__file__).with_name('atomic_owner_runtime.py').read_text(encoding='utf-8')
ANCHOR = '''        if self.loaded() and not self._vision_down():
            return
        hook_failed = None
'''
REPLACEMENT = '''        if self.loaded() and not self._vision_down():
            return
        from strata_control.atomic_owner import enabled as atomic_owner_enabled
        if atomic_owner_enabled():
            raise EngineDied("Atomic owns model residency; reload the model through Atomic after the engine or vision process stops")
        hook_failed = None
'''

def apply(control):
    root = Path(control)
    target = root / 'strata_control/atomic_owner.py'
    if target.exists():
        raise ValueError('Atomic owner overlay is already present')
    import_anchor = 'import subprocess\n'
    import_replacement = import_anchor + 'from strata_control.atomic_owner import popen as atomic_popen\n'
    replacements = {
        'serve/server.py': [(ANCHOR, REPLACEMENT, 1)],
        'strata_control/runtime.py': [
            (import_anchor, import_replacement, 1),
            ('proc = subprocess.Popen(command,', 'proc = atomic_popen("owner", name, command,', 1),
            ('self.child = subprocess.Popen([sys.executable, "-m", "serve.server", *server_args],',
             'self.child = atomic_popen("server", self.name, [sys.executable, "-m", "serve.server", *server_args],', 2),
        ],
        'serve/lifeline.py': [
            ('    except OSError:\n        return\n    with _watchers_lock:\n',
             '    except OSError:\n        from strata_control.atomic_owner import enabled\n        if enabled():\n            child.kill()\n            child.wait(timeout=30)\n            raise\n        return\n    with _watchers_lock:\n', 1),
            (import_anchor, import_replacement, 1),
            ('watcher = subprocess.Popen([sys.executable, "-S", "-c", _WATCHER, str(child.pid), _start_token(child.pid)],',
             'watcher = atomic_popen("guardian", os.environ.get("STRATA_RUNTIME_PROFILE"), [sys.executable, "-S", "-c", _WATCHER, str(child.pid), _start_token(child.pid)],', 1),
            ('child = _the_anchor().call(lambda: subprocess.Popen(args, **kw))',
             'child = _the_anchor().call(lambda: atomic_popen(role, os.environ.get("STRATA_RUNTIME_PROFILE"), args, **kw))', 1),
            ('child = subprocess.Popen(args, **kw)',
             'child = atomic_popen(role, os.environ.get("STRATA_RUNTIME_PROFILE"), args, **kw)', 1),
        ],
    }
    staged = []
    sha = lambda value: hashlib.sha256(value).hexdigest()
    for relative, edits in replacements.items():
        path = root / relative
        before = path.read_bytes()
        source = before.decode('utf-8')
        for anchor, replacement, count in edits:
            if source.count(anchor) != count:
                raise ValueError(f'Pinned Control anchor changed in {relative}; review the Atomic overlay')
            source = source.replace(anchor, replacement)
        after = source.encode('utf-8')
        staged.append((path, after, {'path': 'control/' + relative,
                                   'upstream_sha256': sha(before), 'patched_sha256': sha(after)}))
    for path, after, _ in staged:
        path.write_bytes(after)
    target.write_text(HELPER, encoding='utf-8', newline='\n')
    return {'id': 'atomic-external-owner-v3', **staged[0][2],
            'files': [record for _, _, record in staged],
            'helper': 'control/strata_control/atomic_owner.py', 'helper_sha256': sha(HELPER.encode())}
