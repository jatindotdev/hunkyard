#!/usr/bin/env bun
// Cross-compiles hunk for every platform we ship, into dist/release.
//
// Run `bun run build:client` first: the client is embedded with --asset, so each
// binary carries the same already-built client rather than rebuilding it per
// target.
import { rm, mkdir } from 'node:fs/promises';
import { version } from '../package.json';

interface Target {
  // The value bun build --target expects.
  target: string;
  // What the file is called, in the shape people expect from a release page.
  name: string;
}

const TARGETS: readonly Target[] = [
  { target: 'bun-darwin-arm64', name: 'hunk-darwin-arm64' },
  { target: 'bun-darwin-x64', name: 'hunk-darwin-x64' },
  { target: 'bun-linux-x64', name: 'hunk-linux-x64' },
  { target: 'bun-linux-arm64', name: 'hunk-linux-arm64' },
  // musl is a separate libc, not a variant of the glibc build, so Alpine and
  // friends need their own binary rather than the linux-x64 one.
  { target: 'bun-linux-x64-musl', name: 'hunk-linux-x64-musl' },
  { target: 'bun-linux-arm64-musl', name: 'hunk-linux-arm64-musl' },
  { target: 'bun-windows-x64', name: 'hunk-windows-x64.exe' },
];

const OUT_DIR = 'dist/release';

if (!(await Bun.file('dist/client/index.html').exists())) {
  console.error('dist/client is missing. Run `bun run build:client` first.');
  process.exit(1);
}

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const results: { name: string; mb: string; ms: number }[] = [];
for (const { target, name } of TARGETS) {
  const started = Bun.nanoseconds();
  const outfile = `${OUT_DIR}/${name}`;
  const build = Bun.spawnSync([
    'bun',
    'build',
    '--compile',
    '--minify',
    '--sourcemap',
    // Moves JavaScript parsing from startup to build time.
    '--bytecode',
    `--target=${target}`,
    '--asset=dist/client',
    'bin/hunk.ts',
    '--outfile',
    outfile,
  ]);

  if (build.exitCode !== 0) {
    console.error(`\n${name} failed:\n${build.stderr.toString()}`);
    process.exit(1);
  }

  const size = Bun.file(outfile).size;
  results.push({
    name,
    mb: (size / 1024 / 1024).toFixed(1),
    ms: Math.round((Bun.nanoseconds() - started) / 1e6),
  });
  console.log(`  ${name.padEnd(28)} ${results.at(-1)?.mb} MB`);
}

console.log(
  `\nhunkyard ${version}: ${results.length} binaries in ${OUT_DIR}, ` +
    `${Math.round(results.reduce((total, r) => total + r.ms, 0) / 1000)}s total`
);
