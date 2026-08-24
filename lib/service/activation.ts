// Sockets handed to us by the service manager, already bound and listening.
//
// This is what makes the bare URL work without anything running: launchd (or
// systemd) holds port 80 whether or not hunkyard is up, and starting us is what
// it does when a connection arrives. Nothing is running between reviews, and
// port 80 is bound by root while we are not, because the socket is bound before
// we are started and only the descriptor is passed on.
//
// The two managers pass it differently, and only one of them is free.

// systemd's contract: LISTEN_FDS descriptors starting at 3, and LISTEN_PID
// guarding against a variable inherited by a child that was not the intended
// recipient.
const SYSTEMD_FIRST_FD = 3;

export function systemdSockets(
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid
): number[] {
  const count = Number.parseInt(env.LISTEN_FDS ?? '', 10);
  if (!Number.isInteger(count) || count < 1) return [];
  // The variables survive exec, so a child would otherwise adopt descriptors
  // that belong to its parent.
  const intended = Number.parseInt(env.LISTEN_PID ?? '', 10);
  if (Number.isInteger(intended) && intended !== pid) return [];
  return Array.from({ length: count }, (_, index) => SYSTEMD_FIRST_FD + index);
}

// launchd has no fixed descriptor number. The sockets are fetched by the name
// the plist gave them, through a C function, which is why this needs FFI at all.
function launchdSockets(name: string): number[] {
  try {
    // Imported lazily: bun:ffi and libSystem exist only where this applies, and
    // loading them on Linux would fail for no reason.
    const { dlopen, FFIType, ptr, toArrayBuffer } =
      require('bun:ffi') as typeof import('bun:ffi');

    // int launch_activate_socket(const char *name, int **fds, size_t *count);
    const lib = dlopen('/usr/lib/libSystem.B.dylib', {
      launch_activate_socket: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
        returns: FFIType.int,
      },
    });

    const outFds = new BigUint64Array(1);
    const outCount = new BigUint64Array(1);
    const socketName = Buffer.from(`${name}\0`, 'utf8');
    const code = lib.symbols.launch_activate_socket(
      ptr(socketName),
      ptr(outFds),
      ptr(outCount)
    );
    // ESRCH when this process was not started by launchd for that socket, which
    // is every run from a terminal.
    const count = Number(outCount[0] ?? 0);
    if (code !== 0 || count === 0) return [];

    const bytes = toArrayBuffer(
      Number(outFds[0]) as never,
      0,
      count * Int32Array.BYTES_PER_ELEMENT
    );
    return Array.from(new Int32Array(bytes));
  } catch {
    // No FFI, no libSystem, or a launchd that does not answer. Binding a port
    // ourselves is the fallback, and it is what every non-activated run does.
    return [];
  }
}

// The name the plist gives the socket, and the name asked for here. They have to
// agree or launchd answers with nothing.
export const SOCKET_NAME = 'Listeners';

export function inheritedSockets(): number[] {
  if (process.platform === 'darwin') return launchdSockets(SOCKET_NAME);
  return systemdSockets();
}
