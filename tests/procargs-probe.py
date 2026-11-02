# Run by an agent's command inside its sandbox (tests/open-models.test.js, and by hand against a real
# provider): reads every same-user process's arguments and initial environment with sysctl
# KERN_PROCARGS2, which macOS's sandbox doesn't stop, and looks for a secret without being given it:
# argv holds only sha256 hex digests and lengths, so the secret is in no command line.
#
#   python3 -I procargs-probe.py <sha256 of the key> <key length> [<sha256 of a canary> <canary length>
#                                [<sha256 of the user's message> <its length>]]
#
# Prints "procargs scanned=<processes read> key=<processes holding it> canary=<processes holding it>
# [prompt=<processes holding it>]", and when the key is found, "key in: <pid>:<executable>…".
# The canary is a value known to be in some process's environment (the helper's): finding it shows the
# scan works.
import ctypes
import ctypes.util
import hashlib
import re
import sys

libc = ctypes.CDLL(ctypes.util.find_library('c'), use_errno=True)
CTL_KERN, KERN_ARGMAX, KERN_PROCARGS2 = 1, 8, 49

argmax = ctypes.c_int(0)
size = ctypes.c_size_t(ctypes.sizeof(argmax))
mib = (ctypes.c_int * 2)(CTL_KERN, KERN_ARGMAX)
libc.sysctl(mib, 2, ctypes.byref(argmax), ctypes.byref(size), None, 0)
buf = ctypes.create_string_buffer(argmax.value or 1 << 20)

wanted = []  # (name, digest, length)
args = sys.argv[1:]
for name, i in (('key', 0), ('canary', 2), ('prompt', 4)):
    if len(args) > i + 1:
        wanted.append((name, args[i], int(args[i + 1])))

# Where a secret can start: the buffer's start, or after a character that can't be part of one.
starts = re.compile(rb'(?:^|(?<=[^A-Za-z0-9_\-]))[A-Za-z0-9_\-]')
found = {name: 0 for name, _, _ in wanted}
where = []  # the executables of the processes holding the key (paths only, never what was found)
scanned = 0
for pid in range(1, 100000):
    mib3 = (ctypes.c_int * 3)(CTL_KERN, KERN_PROCARGS2, pid)
    n = ctypes.c_size_t(len(buf))
    if libc.sysctl(mib3, 3, buf, ctypes.byref(n), None, 0) != 0:
        continue
    scanned += 1
    data = buf.raw[:n.value]
    for name, digest, length in wanted:
        for m in starts.finditer(data):
            s = m.start()
            if hashlib.sha256(data[s:s + length]).hexdigest() == digest:
                found[name] += 1
                if name == 'key':
                    where.append('%d:%s' % (pid, data[4:data.find(b'\0', 4)].decode('utf-8', 'replace')))
                break

print('procargs scanned=%d %s' % (scanned, ' '.join('%s=%d' % (k, v) for k, v in found.items())))
if where:
    print('key in: ' + ' '.join(where))
