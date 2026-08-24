import { describe, expect, test } from 'bun:test';

import { topLevelHelp, wantsTopLevelHelp } from '../help';

// Test output is not a TTY, so style.ts leaves the text uncoloured and these
// can match on it directly.
const help = topLevelHelp('9.9.9');

// The command column, rather than the whole line: a description is prose and
// "what it serves" would match a search for `serve`.
function listedCommands(text: string): string[] {
  return text
    .slice(text.indexOf('COMMANDS'), text.indexOf('OPTIONS'))
    .split('\n')
    .map((line) => line.trim().split(/\s{2,}/)[0] ?? '')
    .filter((name) => name !== '' && name !== 'COMMANDS');
}

describe('topLevelHelp', () => {
  // The commands used to be a comma-separated run-on in the description line,
  // because citty can only render a COMMANDS section from `subCommands` and
  // this CLI cannot use those: a first argument is usually a revspec.
  test('lists the commands under a heading of their own', () => {
    expect(listedCommands(help)).toEqual([
      'status',
      'stop',
      'restart',
      'forget',
      'install',
      'uninstall',
    ]);
  });

  // `serve` and `forward` are run by the login agent and the forwarder, not by
  // hand, so listing them would be offering something nobody should type.
  test('leaves the internal commands out', () => {
    expect(listedCommands(help)).not.toContain('serve');
    expect(listedCommands(help)).not.toContain('forward');
  });

  test('says what a target can be', () => {
    expect(help).toContain('owner/repo#123');
    expect(help).toContain('HEAD~3');
  });

  test('carries the version', () => {
    expect(help).toContain('9.9.9');
  });
});

describe('wantsTopLevelHelp', () => {
  test('recognises both spellings', () => {
    expect(wantsTopLevelHelp(['--help'])).toBe(true);
    expect(wantsTopLevelHelp(['-h'])).toBe(true);
  });

  test('is false for an ordinary invocation', () => {
    expect(wantsTopLevelHelp([])).toBe(false);
    expect(wantsTopLevelHelp(['--staged'])).toBe(false);
  });

  // A branch really can be called --help, and after a bare `--` it is a value.
  test('stops at a bare double dash', () => {
    expect(wantsTopLevelHelp(['--', '--help'])).toBe(false);
  });
});
