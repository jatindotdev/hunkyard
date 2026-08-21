import type { Socket } from 'bun';

// A TCP forwarder, so `http://hunkyard.localhost` with no port works.
//
// Port 80 needs root and the server does not: an unprivileged bind to 80 fails
// with EACCES. So the privileged part is this and only this, a static forward to
// the port the server already listens on. It needs no Host-header routing and no
// route registry, because there is exactly one target.
//
// It is deliberately unaware of the server. Nothing listening on the target port
// means connections fail, which is exactly what would happen without it.

interface Side {
  peer?: Socket<Side>;
  // Bytes read from this socket that still have to reach its peer. They queue
  // here rather than on the peer, because the peer does not exist yet while the
  // outbound connection is still being made, and a request's first bytes arrive
  // in that window.
  outbox: Uint8Array[];
}

// Moves as much of `from`'s outbox into its peer as the peer will take. A short
// write means backpressure, and the remainder waits for the peer to drain.
function pump(from: Socket<Side> | undefined): void {
  if (from == null) return;
  const { peer, outbox } = from.data;
  if (peer == null) return;

  while (outbox.length > 0) {
    const chunk = outbox[0] as Uint8Array;
    const written = peer.write(chunk);
    if (written < chunk.length) {
      outbox[0] = chunk.subarray(written);
      return;
    }
    outbox.shift();
  }
}

export interface Forwarder {
  port: number;
  stop(): void;
}

export function startForwarder(options: {
  from: number;
  to: number;
  hostname?: string;
}): Forwarder {
  const hostname = options.hostname ?? '127.0.0.1';

  const server = Bun.listen<Side>({
    hostname,
    port: options.from,
    socket: {
      open(inbound) {
        inbound.data = { outbox: [] };
        void Bun.connect<Side>({
          hostname,
          port: options.to,
          socket: {
            open(outbound) {
              outbound.data.peer = inbound;
              inbound.data.peer = outbound;
              // Whatever the client sent while this was connecting.
              pump(inbound);
            },
            data(outbound, chunk) {
              outbound.data.outbox.push(chunk);
              pump(outbound);
            },
            // This socket can accept more, so its peer's queue can move.
            drain(outbound) {
              pump(outbound.data.peer);
            },
            close(outbound) {
              outbound.data.peer?.end();
            },
            error(outbound) {
              outbound.data.peer?.end();
            },
          },
          data: { outbox: [] },
        }).catch(() => {
          // Nothing is serving the target port. Closing is the honest answer,
          // and the same thing the client would see without this forwarder.
          inbound.end();
        });
      },
      data(inbound, chunk) {
        inbound.data.outbox.push(chunk);
        pump(inbound);
      },
      drain(inbound) {
        pump(inbound.data.peer);
      },
      close(inbound) {
        inbound.data.peer?.end();
      },
      error(inbound) {
        inbound.data.peer?.end();
      },
    },
  });

  return { port: server.port ?? options.from, stop: () => server.stop(true) };
}
