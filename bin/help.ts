import { bold, cyan, dim } from './style';

// The top-level help.
//
// citty renders one from the command definition, but it can only list
// subcommands it was given as `subCommands`, and this CLI cannot use those: the
// first argument is usually a revspec, and citty treats an unrecognised one as
// an error rather than a positional. So the commands ended up crammed into the
// description line, which is not where anyone looks for them.
//
// Each command's own `--help` is still citty's.

interface Entry {
  name: string;
  description: string;
}

const COMMANDS: readonly Entry[] = [
  { name: 'serve', description: 'run a server in this terminal, on a port' },
  { name: 'status', description: 'what is running, and what it serves' },
  { name: 'stop', description: 'stop it now, rather than when it goes idle' },
  { name: 'forget', description: 'drop a repository from that list' },
  {
    name: 'install',
    description: 'register http://hunkyard.localhost, once, with sudo',
  },
  { name: 'uninstall', description: 'undo install' },
  { name: 'update', description: 'download the latest release and swap it in' },
];

const OPTIONS: readonly Entry[] = [
  { name: '--staged, --cached', description: 'staged changes only' },
  { name: '--all', description: 'staged and unstaged together' },
  { name: '--worktree', description: 'unstaged changes, which is the default' },
  { name: '--no-open', description: 'print the URL instead of opening a browser' },
  { name: '-p, --port <port>', description: 'port to serve on (default 4865)' },
  { name: '-v, --version', description: 'print the version' },
];

const EXAMPLES: readonly Entry[] = [
  { name: 'hunk', description: 'review what you have not committed' },
  { name: 'hunk --staged', description: 'review what you are about to commit' },
  { name: 'hunk main...my-branch', description: 'review a branch as a PR would' },
  { name: 'hunk owner/repo#123', description: 'review a pull request' },
];

function widest(entries: readonly Entry[]): number {
  return entries.reduce((width, entry) => Math.max(width, entry.name.length), 0);
}

function section(title: string, entries: readonly Entry[]): string {
  const width = widest(entries);
  const rows = entries
    .map((entry) => `  ${cyan(entry.name.padEnd(width))}  ${dim(entry.description)}`)
    .join('\n');
  return `${bold(title)}\n${rows}\n`;
}

export function topLevelHelp(version: string): string {
  return [
    `${bold('hunkyard')} ${dim(`v${version}`)}`,
    dim('Review code changes from a local repository or a pull request.'),
    '',
    `${bold('USAGE')}`,
    `  ${cyan('hunk')} ${dim('[target] [options]')}`,
    `  ${cyan('hunk <command>')} ${dim('[options]')}`,
    '',
    `${bold('TARGET')}`,
    `  ${dim('main...feature, HEAD~3, a1b2c3d, owner/repo#123, or a github.com URL.')}`,
    `  ${dim('Omit it for your working tree, or to open the picker outside a repository.')}`,
    '',
    section('COMMANDS', COMMANDS),
    section('OPTIONS', OPTIONS),
    section('EXAMPLES', EXAMPLES),
    dim(`  hunk <command> --help for a command's own options.`),
    '',
  ].join('\n');
}

// Whether these arguments are asking for the top-level help. A command's own
// help stays citty's, so this only applies when no command was named.
export function wantsTopLevelHelp(rawArgs: readonly string[]): boolean {
  for (const raw of rawArgs) {
    // Everything after a bare `--` is a value.
    if (raw === '--') return false;
    if (raw === '--help' || raw === '-h') return true;
  }
  return false;
}

// `hunk help` as well as `hunk --help`, because both are things people type and
// only one of them being right is a small, avoidable annoyance.
export function isHelpCommand(name: string): name is 'help' {
  return name === 'help';
}
