"""Atomic's external-owner contract. Standalone Strata keeps upstream behavior."""
import json
import os
import re
import subprocess
import uuid

OWNER_CONTRACT = 3


def enabled():
    return os.environ.get('STRATA_ATOMIC_OWNER') == '1'


def _write(path, row):
    from strata_control import private_files
    temporary = path.with_suffix('.' + uuid.uuid4().hex + '.tmp')
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            private_files.restrict_to_current_user(temporary, directory=False)
            json.dump(row, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def popen(role, profile, *args, **kwargs):
    """Record launch intent before Popen, then identity before returning the child to its caller.

    A crash between the two writes leaves 'launching', which is explicitly unproven. Records
    are retained after exit: the core, not a best-effort reaper, decides when this scope is free.
    """
    if not enabled():
        return subprocess.Popen(*args, **kwargs)
    if not isinstance(profile, str) or not re.fullmatch(r'atomic-[a-f0-9]{32}', profile):
        raise ValueError('Atomic-owned processes require an Atomic scope profile')
    if role not in ('owner', 'server', 'engine', 'vision', 'guardian'):
        raise ValueError('Unknown Atomic process role')
    from strata_control import paths, procs, private_files
    parent_pid = os.getpid()
    parent_token = procs.start_token(parent_pid)
    if not parent_token:
        raise OSError('Atomic could not identify the process launching a child')
    directory = paths.state_base() / 'atomic-processes' / profile
    private_files.private_mkdir(directory, parents=True, exist_ok=True)
    if directory.is_symlink():
        raise OSError('Atomic process ledger is redirected')
    path = directory / (uuid.uuid4().hex + '.json')
    row = {'schema': 1, 'profile': profile, 'role': role, 'phase': 'launching',
           'parent': {'pid': parent_pid, 'token': parent_token}}
    _write(path, row)
    try:
        child = subprocess.Popen(*args, **kwargs)
    except BaseException:
        row['phase'] = 'not-started'
        _write(path, row)
        raise
    try:
        token = procs.start_token(child.pid)
        command = procs.command_line(child.pid)
        if not token or not command:
            raise OSError('Atomic could not identify a newly launched child')
        row.update(phase='owned', pid=child.pid, token=token, cmd=command)
        _write(path, row)
    except BaseException:
        # No unrecorded child may escape a failed write. If kill/wait fails, retain the pending
        # receipt and propagate the error: the core keeps its GPU claim until it has proof.
        child.kill()
        child.wait(timeout=30)
        row.update(phase='exited', pid=child.pid)
        _write(path, row)
        raise
    return child
