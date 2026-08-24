// Colour for the terminal, and nothing when it is not one.
//
// Small enough not to be worth a dependency: the CLI prints URLs, paths, ids and
// a handful of statuses, so what it needs is emphasis and de-emphasis rather
// than a palette.

// Piped output is read by scripts and by our own smoke test, so it stays plain.
// NO_COLOR is the standard opt-out; FORCE_COLOR is how CI asks for it anyway.
function enabled(): boolean {
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR != null && process.env.FORCE_COLOR !== '') {
    return true;
  }
  if (process.env.TERM === 'dumb') return false;
  return process.stdout.isTTY === true;
}

const ON = enabled();

function wrap(open: string, close = '39'): (text: string) => string {
  return (text) => (ON ? `\u001b[${open}m${text}\u001b[${close}m` : text);
}

// What a URL, a path or an id is: the thing you came to the output to read.
export const bold = wrap('1', '22');
export const dim = wrap('2', '22');
export const cyan = wrap('36');
export const green = wrap('32');
export const yellow = wrap('33');
export const red = wrap('31');

// `hunk: ` before an error, so the failure is attributable when it is one line
// among many in a script's output.
export const errorPrefix = (): string => (ON ? red('hunk:') : 'hunk:');

// A label and its value, aligned, which is the shape most of this CLI's output
// takes: `  hunkyard   http://...`.
export function row(label: string, value: string, width = 10): string {
  return `  ${dim(label.padEnd(width))} ${value}\n`;
}
