import { defineCommand } from 'citty';

import { DEFAULT_PORT } from '../server/index';

// Shared by every command that talks to a server.
const portArg = {
  port: {
    type: 'string' as const,
    alias: 'p',
    default: String(DEFAULT_PORT),
    description: `port to serve on (default ${DEFAULT_PORT})`,
  },
};

export interface Handlers {
  // citty's built-in --version flag reads meta.version and errors with "No
  // version specified" without it, which is how `hunk --version` broke when the
  // hand-rolled flag handling went.
  version: string;
  // Reporting rather than throwing: citty does not export its own error type,
  // and a plain Error reaches `console.error(error)`, which prints the object
  // and a source excerpt instead of a message.
  fail(message: string, hint?: string): never;
  review(options: {
    target?: string;
    port: number;
    open: boolean;
    foreground: boolean;
  }): Promise<void>;
  status(port: number): Promise<void>;
  stop(port: number): Promise<void>;
  install(port: number): Promise<void>;
  uninstall(): Promise<void>;
  forward(options: { from: number; to: number }): Promise<void>;
}

function makePort(handlers: Handlers) {
  return (value: string): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      handlers.fail(`--port needs a number between 1 and 65535, got ${value}`);
    }
    return parsed;
  };
}

// `--staged`, `--cached` and `--all` are targets rather than options, because
// that is how git spells them. Declared here so the parser accepts them, then
// folded back into a single target below.
export function buildCommands(handlers: Handlers) {
  const port = makePort(handlers);

  const review = defineCommand({
    meta: {
      name: 'hunk',
      version: handlers.version,
      description:
        'Review code changes from a local repository or a pull request.\n\n' +
        'Commands: status, stop, install, uninstall',
    },
    args: {
      target: {
        type: 'positional',
        required: false,
        description:
          'main...feature, HEAD~3, a1b2c3d, owner/repo#123, or a github.com URL',
      },
      staged: { type: 'boolean', description: 'staged changes only' },
      cached: { type: 'boolean', description: 'alias of --staged' },
      all: { type: 'boolean', description: 'staged and unstaged together' },
      open: {
        type: 'boolean',
        default: true,
        description: 'open a browser (--no-open to print the URL instead)',
      },
      foreground: {
        type: 'boolean',
        description: 'hold the terminal instead of running in the background',
      },
      ...portArg,
    },
    async run({ args }) {
      const flagTarget = args.all
        ? '--all'
        : args.staged || args.cached
          ? '--staged'
          : undefined;
      if (flagTarget != null && args.target != null) {
        handlers.fail(
          `expected one target, got ${flagTarget} and ${args.target}`,
          'A revspec containing spaces needs quoting.'
        );
      }
      await handlers.review({
        target: flagTarget ?? args.target,
        port: port(args.port),
        open: args.open,
        foreground: args.foreground === true,
      });
    },
  });

  const status = defineCommand({
    meta: {
      name: 'status',
      description: 'show the running server and the repositories it serves',
    },
    args: { ...portArg },
    run: ({ args }) => handlers.status(port(args.port)),
  });

  const stop = defineCommand({
    meta: { name: 'stop', description: 'stop the running server' },
    args: { ...portArg },
    run: ({ args }) => handlers.stop(port(args.port)),
  });

  const install = defineCommand({
    meta: {
      name: 'install',
      description:
        'serve on http://hunkyard.localhost with no port, which needs one sudo',
    },
    args: { ...portArg },
    run: ({ args }) => handlers.install(port(args.port)),
  });

  const uninstall = defineCommand({
    meta: { name: 'uninstall', description: 'undo install' },
    run: () => handlers.uninstall(),
  });

  // Run by the installed service, not by hand.
  const forward = defineCommand({
    meta: { name: 'forward', description: 'forward one local port to another' },
    args: {
      from: { type: 'string', required: true, description: 'port to listen on' },
      to: { type: 'string', required: true, description: 'port to forward to' },
    },
    run: ({ args }) =>
      handlers.forward({ from: port(args.from), to: port(args.to) }),
  });

  return { review, status, stop, install, uninstall, forward };
}

// citty throws on a first argument that is not a known subcommand, and ours is
// usually a revspec, so the choice is made here rather than through
// `subCommands`. See citty's runCommand: with subCommands set, an explicit name
// must resolve or it is an error.
export type NamedCommand =
  | 'status'
  | 'stop'
  | 'install'
  | 'uninstall'
  | 'forward';

const NAMED: readonly NamedCommand[] = [
  'status',
  'stop',
  'install',
  'uninstall',
  'forward',
];

// Returns which command to run and the arguments left for it. The name rather
// than the command itself, because citty's CommandDef is generic over its own
// arguments and a collection of differently-shaped commands has no common type
// to hand back.
export function selectCommand(argv: readonly string[]): {
  name: NamedCommand | 'review';
  rawArgs: string[];
} {
  const first = argv[0];
  const named = NAMED.find((name) => name === first);
  return named == null
    ? { name: 'review', rawArgs: [...argv] }
    : { name: named, rawArgs: argv.slice(1) };
}
