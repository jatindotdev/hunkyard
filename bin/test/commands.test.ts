import { describe, expect, test } from 'bun:test';

import {
  assertKnownFlags,
  buildCommands,
  selectCommand,
  SERVICE_SUBCOMMANDS,
} from '../commands';

function stub() {
  const noop = async () => {};
  return buildCommands({
    version: '9.9.9',
    fail: (message: string) => {
      throw new Error(message);
    },
    review: noop,
    status: noop,
    stop: noop,
    install: noop,
    uninstall: noop,
    update: noop,
    serve: noop,
  });
}

describe('command metadata', () => {
  // citty's built-in --version reads meta.version and errors with "No version
  // specified" without it. That shipped once and only CI's smoke test caught it.
  test('the review command carries a version, so --version works', async () => {
    const { meta } = stub().review;
    const resolved = typeof meta === 'function' ? await meta() : await meta;
    expect(resolved?.version).toBe('9.9.9');
  });
});

describe('selectCommand', () => {
  test('routes the top-level commands', () => {
    expect(selectCommand(['update'])).toEqual({ name: 'update', rawArgs: [] });
    expect(selectCommand(['help'])).toEqual({ name: 'help', rawArgs: [] });
  });

  // Resolved all the way to the leaf, so the unknown-flag check sees the
  // arguments the command actually declares rather than the group's, which are
  // none.
  test('resolves a service subcommand to its leaf', () => {
    for (const sub of SERVICE_SUBCOMMANDS) {
      expect(selectCommand(['service', sub])).toEqual({
        name: `service:${sub}`,
        rawArgs: [],
      });
    }
  });

  test('passes the rest of the arguments on', () => {
    expect(selectCommand(['service', 'stop', '--port', '4900'])).toEqual({
      name: 'service:stop',
      rawArgs: ['--port', '4900'],
    });
  });

  // Nothing to run, so it is a request to be told what the subcommands are.
  test('a bare service, or an unknown one, is the group itself', () => {
    expect(selectCommand(['service'])).toEqual({
      name: 'service',
      rawArgs: [],
    });
    expect(selectCommand(['service', 'nonsense'])).toEqual({
      name: 'service',
      rawArgs: ['nonsense'],
    });
  });

  // A revspec is the usual first argument, and citty throws on one it does not
  // recognise as a subcommand, which is why this dispatch exists at all.
  test('treats anything else as a review target', () => {
    expect(selectCommand(['main...feature'])).toEqual({
      name: 'review',
      rawArgs: ['main...feature'],
    });
    expect(selectCommand(['--staged'])).toEqual({
      name: 'review',
      rawArgs: ['--staged'],
    });
    expect(selectCommand([])).toEqual({ name: 'review', rawArgs: [] });
  });

  // A branch really can be called `stop`, so only the first argument is a
  // command name.
  test('only reads the first argument as a command', () => {
    expect(selectCommand(['main...stop']).name).toBe('review');
    expect(selectCommand(['--no-open', 'stop']).name).toBe('review');
  });
});

describe('assertKnownFlags', () => {
  const args = {
    target: { type: 'positional' },
    staged: { type: 'boolean' },
    open: { type: 'boolean' },
    port: { type: 'string', alias: 'p' },
  };
  const reject = (raw: string[]) => () =>
    assertKnownFlags(raw, args, (message) => {
      throw new Error(message);
    });

  test('accepts what is declared, in every spelling', () => {
    expect(reject(['--staged'])).not.toThrow();
    expect(reject(['--no-open'])).not.toThrow();
    expect(reject(['-p', '4900'])).not.toThrow();
    expect(reject(['--port=4900'])).not.toThrow();
    expect(reject(['--help'])).not.toThrow();
    expect(reject(['--version'])).not.toThrow();
  });

  test('accepts positionals and values', () => {
    expect(reject(['main...feature'])).not.toThrow();
    expect(reject(['--port', '4900', 'HEAD~3'])).not.toThrow();
  });

  // citty ignores flags it was never told about, so `--stagedd` reviewed the
  // working tree and `--prot 4900` left 4900 to be read as a revspec. Both were
  // quiet successes doing the wrong thing.
  test('refuses a typo rather than ignoring it', () => {
    expect(reject(['--stagedd'])).toThrow('unknown option --stagedd');
    expect(reject(['--prot', '4900'])).toThrow('unknown option --prot');
    expect(reject(['-x'])).toThrow('unknown option -x');
  });

  test('stops treating things as flags after a bare --', () => {
    expect(reject(['--', '--whatever'])).not.toThrow();
  });

  // A lone dash is a conventional stand-in for stdin, not a flag to reject.
  test('leaves a bare dash alone', () => {
    expect(reject(['-'])).not.toThrow();
  });
});
