import net from 'node:net';

// Forwarding from a socket the service manager already bound, rather than one we
// bind ourselves.
//
// Bun.listen takes a port, not a descriptor, so the inbound side is node:net --
// which can adopt one. The outbound side is a plain loopback connection to the
// server running in this same process.
//
// Counting connections here rather than counting requests upstream is what makes
// "nothing is using this" answerable: a held-open server-sent-events stream is a
// connection, so a tab watching a diff keeps this above zero without anything
// having to report that it is still interested.

export interface AdoptedForwarder {
  stop(): void;
  openConnections(): number;
}

export function forwardAdoptedSockets(options: {
  fds: readonly number[];
  to: number;
  // Called when the last connection closes, and again whenever the first one
  // opens, so a caller can run an idle timer without polling.
  onIdle?(): void;
  onBusy?(): void;
}): AdoptedForwarder {
  let open = 0;
  const servers: net.Server[] = [];

  const handle = (inbound: net.Socket) => {
    open += 1;
    if (open === 1) options.onBusy?.();

    const outbound = net.connect(options.to, '127.0.0.1');
    // Half-open would leave one side waiting on a peer that is never coming
    // back, so each side's end tears down the pair.
    const shutdown = () => {
      inbound.destroy();
      outbound.destroy();
    };

    inbound.pipe(outbound);
    outbound.pipe(inbound);
    inbound.on('error', shutdown);
    outbound.on('error', shutdown);
    outbound.on('close', () => inbound.destroy());

    inbound.on('close', () => {
      open -= 1;
      if (open === 0) options.onIdle?.();
      outbound.destroy();
    });
  };

  for (const fd of options.fds) {
    const server = net.createServer(handle);
    server.listen({ fd });
    servers.push(server);
  }

  return {
    stop: () => {
      for (const server of servers) server.close();
    },
    openConnections: () => open,
  };
}
