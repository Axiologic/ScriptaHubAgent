#!/usr/bin/python3
"""Enter the fixed Linux sandbox with a parent-death signal and file limit."""
import ctypes
import os
import resource
import signal
import sys


def main():
    if len(sys.argv) < 3 or not sys.argv[1].isdigit():
        raise SystemExit('Invalid processing launcher request')
    parent = int(sys.argv[1])
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'Cannot set parent-death signal')
    if os.getppid() != parent:
        raise SystemExit('Processing supervisor is no longer alive')
    limit = 512 * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_FSIZE, (limit, limit))
    os.execve('/usr/bin/bwrap', ['/usr/bin/bwrap', *sys.argv[2:]], {'PATH': '/usr/local/bin:/usr/bin:/bin'})


if __name__ == '__main__':
    main()
