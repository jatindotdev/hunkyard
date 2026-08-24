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
  review(options: { target?: string; open: boolean }): Promise<void>;
  status(port: number): Promise<void>;
  stop(port: number): Promise<void>;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  update(options: { check: boolean; port: number }): Promise<void>;
  serve(options: { port: number; activated: boolean }): Promise<void>;
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
      // Only reached through citty's own error paths now; the top-level help
      // is rendered by help.ts, which is where the commands are listed.
      description: 'Review code changes from a local repository or a pull request.',
    },
    args: {
      target: {
        type: 'positional',
        required: false,
        description:
          'main...feature, HEAD~3, a1b2c3d, owner/repo#123, or a github.com URL',
      },
      worktree: {
        type: 'boolean',
        description: 'unstaged changes, which is the default',
      },
      staged: { type: 'boolean', description: 'staged changes only' },
      cached: { type: 'boolean', description: 'alias of --staged' },
      all: { type: 'boolean', description: 'staged and unstaged together' },
      open: {
        type: 'boolean',
        default: true,
        description: 'open a browser (--no-open to print the URL instead)',
      },
    },
    async run({ args }) {
      const flagTarget = args.all
        ? '--all'
        : args.staged || args.cached
          ? '--staged'
          : args.worktree
            ? '--worktree'
            : undefined;
      if (flagTarget != null && args.target != null) {
        handlers.fail(
          `expected one target, got ${flagTarget} and ${args.target}`,
          'A revspec containing spaces needs quoting.'
        );
      }
      await handlers.review({
        target: flagTarget ?? args.target,
        open: args.open,
      });
    },
  });

  const status = defineCommand({
    meta: {
      name: 'service status',
      description: 'show the running server and the repositories it serves',
    },
    args: { ...portArg },
    run: ({ args }) => handlers.status(port(args.port)),
  });

  const stop = defineCommand({
    meta: {
      name: 'service stop',
      description: 'stop the running server, rather than waiting for it to go idle',
    },
    args: { ...portArg },
    run: ({ args }) => handlers.stop(port(args.port)),
  });

  const install = defineCommand({
    meta: {
      name: 'service install',
      description:
        'register http://hunkyard.localhost, so it answers with no port and no server running',
    },
    run: () => handlers.install(),
  });

  const update = defineCommand({
    meta: {
      name: 'update',
      description: 'download the latest release and replace this binary',
    },
    args: {
      check: {
        type: 'boolean',
        description: 'only say whether a newer release exists',
      },
      ...portArg,
    },
    run: ({ args }) =>
      handlers.update({ check: args.check === true, port: port(args.port) }),
  });

  const uninstall = defineCommand({
    meta: {
      name: 'service uninstall',
      description: 'unregister the URL',
    },
    run: () => handlers.uninstall(),
  });

  // Run by the login agent and by the detached child, not by hand. An argv is
  // better than an environment variable for this: a plist that sets a variable
  // to tell the binary what to do hides the intent from anyone reading it.
  const serve = defineCommand({
    meta: { name: 'serve', description: 'run the server in this process' },
    args: {
      ...portArg,
      activated: {
        type: 'boolean',
        description: 'adopt a socket handed over by the service manager',
      },
    },
    run: ({ args }) =>
      handlers.serve({
        port: port(args.port),
        activated: args.activated === true,
      }),
  });

  return {
    review,
    update,
    'service:install': install,
    'service:uninstall': uninstall,
    'service:status': status,
    'service:stop': stop,
    'service:run': serve,
  };
}

// citty accepts flags it was never told about and ignores them, so `--stagedd`
// silently reviews the working tree and `--prot 4900` leaves 4900 to be read as
// a revspec. Neither should be a quiet success, so unknown flags are rejected
// here before citty parses.
export function assertKnownFlags(
  rawArgs: readonly string[],
  args: Record<string, { type: string; alias?: string | string[] }>,
  fail: (message: string, hint?: string) => never
): void {
  const known = new Set(['--help', '-h', '--version', '-v']);
  for (const [name, definition] of Object.entries(args)) {
    if (definition.type === 'positional') continue;
    known.add(`--${name}`);
    // citty spells the negation of a boolean this way.
    if (definition.type === 'boolean') known.add(`--no-${name}`);
    for (const alias of [definition.alias ?? []].flat()) {
      known.add(alias.length === 1 ? `-${alias}` : `--${alias}`);
    }
  }

  for (const raw of rawArgs) {
    // Everything after a bare `--` is a value, not a flag.
    if (raw === '--') break;
    if (!raw.startsWith('-') || raw === '-') continue;
    const flag = raw.split('=')[0] as string;
    if (known.has(flag)) continue;
    fail(
      `unknown option ${flag}`,
      'Run `hunk --help` for the options, or quote it if it is a revspec.'
    );
  }
}

// citty throws on a first argument that is not a known subcommand, and ours is
// usually a revspec, so the choice is made here rather than through
// `subCommands`. See citty's runCommand: with subCommands set, an explicit name
// must resolve or it is an error.
// Everything that is not reviewing is about the service: registering the URL,
// and the server behind it. Grouping them says which is which, and keeps the
// top level to the thing you actually run.
export const SERVICE_SUBCOMMANDS = [
  'install',
  'uninstall',
  'status',
  'stop',
  'run',
] as const;

export type ServiceSubcommand = (typeof SERVICE_SUBCOMMANDS)[number];

export type NamedCommand = 'help' | 'update' | `service:${ServiceSubcommand}`;

// Resolved to the leaf rather than left as a group, so the flag check below
// sees the arguments the command actually declares. A group whose own args are
// empty would reject every flag meant for what it contains.
export function selectCommand(argv: readonly string[]): {
  name: NamedCommand | 'review' | 'service';
  rawArgs: string[];
} {
  const first = argv[0];

  if (first === 'help') return { name: 'help', rawArgs: argv.slice(1) };
  if (first === 'update') return { name: 'update', rawArgs: argv.slice(1) };

  if (first === 'service') {
    const second = argv[1];
    const sub = SERVICE_SUBCOMMANDS.find((name) => name === second);
    // A bare `hunk service`, or one naming something that is not a subcommand,
    // is a request to be told what the subcommands are.
    if (sub == null) return { name: 'service', rawArgs: argv.slice(1) };
    return { name: `service:${sub}`, rawArgs: argv.slice(2) };
  }

  return { name: 'review', rawArgs: [...argv] };
}
