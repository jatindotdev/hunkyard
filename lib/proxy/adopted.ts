import net from 'node:net';

// Forwarding from a socket the service manager already bound, rather than one we
// bind ourselves.
//
// Bun.listen takes a port, not a descriptor, so the inbound side is node:net --
// which can adopt one. The outbound side is a plain loopback connection to the
// server running in this same process.
//
// Traffic through here is what "something is using this" means. Counting open
// connections instead is the obvious idea and the wrong one: browsers keep idle
// keep-alive sockets in a pool long after the page that opened them is gone, so
// a closed tab would still read as in use. Bytes tell them apart -- an event
// stream heartbeats, a parked socket says nothing.

export interface AdoptedForwarder {
  stop(): void;
  openConnections(): number;
}

export function forwardAdoptedSockets(options: {
  fds: readonly number[];
  to: number;
  // Called whenever bytes move in either direction, so a caller can run an idle
  // timer from the last time anything was actually said.
  onActivity?(): void;
}): AdoptedForwarder {
  let open = 0;
  const servers: net.Server[] = [];

  // A background server with no terminal is hard to ask what it is doing, and
  // "why is it still running" is the question it gets. This answers it.
  const trace = (what: string) => {
    if (process.env.HUNKYARD_TRACE_IDLE == null) return;
    process.stderr.write(`[idle] ${what} open=${open}\n`);
  };

  const handle = (inbound: net.Socket) => {
    open += 1;
    trace('open');
    options.onActivity?.();

    const outbound = net.connect(options.to, '127.0.0.1');
    inbound.on('data', () => options.onActivity?.());
    outbound.on('data', () => options.onActivity?.());
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
      trace('close');
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
