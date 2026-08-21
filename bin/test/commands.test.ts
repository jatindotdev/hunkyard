import { describe, expect, test } from 'bun:test';

import { buildCommands, selectCommand } from '../commands';

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
    forward: noop,
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
  test('routes the named commands', () => {
    for (const name of ['status', 'stop', 'install', 'uninstall', 'forward'] as const) {
      expect(selectCommand([name])).toEqual({ name, rawArgs: [] });
    }
  });

  test('passes the rest of the arguments on', () => {
    expect(selectCommand(['status', '--port', '4900'])).toEqual({
      name: 'status',
      rawArgs: ['--port', '4900'],
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
