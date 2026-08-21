<h1 align="center">Hunkyard</h1>

<p align="center">
  Code review that works on a pull request, a local branch,<br>
  or whatever you have not committed yet.
</p>

<p align="center">
  <a href="https://github.com/jatindotdev/hunkyard/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/jatindotdev/hunkyard/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/jatindotdev/hunkyard/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/jatindotdev/hunkyard?label=release"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/jatindotdev/hunkyard?color=blue"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey">
</p>

![hunkyard reviewing a working tree](docs/screenshot.png)

GitHub's review UI is slow on large diffs and can only review something that is
already a pull request. Hunkyard reviews any of them, runs entirely on your
machine, and renders diffs of a size the GitHub UI gives up on.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/jatindotdev/hunkyard/main/scripts/install.sh | sh
```

One executable with the Bun runtime, the server and the whole client compiled
into it. Nothing to install alongside it: no Node, no Bun, no `node_modules`.
`HUNK_VERSION` pins a release, `HUNK_INSTALL_DIR` chooses where it lands.

## Use

```bash
hunk                    # review what you have not committed
hunk --staged           # review what you are about to commit
hunk main...my-branch   # review a branch as a PR would show it
hunk HEAD~3             # review the last three commits
hunk owner/repo#123     # review a pull request

hunk status             # what is running, and which repositories it serves
hunk stop               # stop it
```

`hunk` opens a browser and returns. It serves at
`http://hunkyard.localhost:4865`, in the background, and keeps running until you
stop it, so the second review of the day costs 44ms rather than a restart. It
serves every repository you have opened, so running `hunk` in another one just
works. Use `--foreground` to hold the terminal instead.

<details>
<summary><b>git hunk</b> works too</summary>

The installer puts a `git-hunk` symlink next to the binary, with a man page, so
`git hunk` and `git hunk --help` both work. Git resolves the second as
`git help hunk`, which reads a man page rather than running the binary, so
without one it would fail.
</details>

<details>
<summary>The binaries are large, about 75MB</summary>

Each one embeds the Bun runtime and the whole client. They are uncompressed, so
one downloaded from the releases page runs after a `chmod`. GitHub does not
compress release assets in transit either, so that is the size on the wire.
</details>

<details>
<summary>Serving <code>hunkyard.localhost</code> with no port</summary>

Port 80 needs root and the server does not, so the bare URL is opt-in:

```bash
hunk install     # one sudo, once
hunk uninstall   # undoes it
```

That installs a forwarder from `127.0.0.1:80` to the server's port, as a
LaunchDaemon on macOS or a systemd unit on Linux. Only the listener runs
privileged; the server does not know it exists, and connections simply fail when
no server is running, exactly as they would without it. Windows has no
privileged-port concept, so there is nothing to install.
</details>

<details>
<summary>An unrelated tool is also called <code>hunk</code></summary>

If you already have one on your PATH, whichever directory comes first decides
which runs. The installer names the one that wins rather than leaving you to
find out.
</details>

## What it does

**Reviews local work, not just pull requests.** A three-dot range is diffed
against the merge base, the same anchor GitHub uses, so a local review and the
pull request it becomes show identical line numbers. Untracked files are
synthesized into the diff without touching the index. Editing a file with the
viewer open reloads it and holds your scroll position.

**Real review threads.** Multi-line anchors, replies, resolve, and as many
drafts open at once as you like. On a pull request they are queued locally and
submitted as one review with a verdict, the way a batched GitHub review works.
On a local target they are written to `.hunkyard/review.md` in the repository,
which is readable prose with the anchors in HTML comments, so a coding agent can
read your review back.

**Remembers where you were.** Files you have marked viewed collapse and stay
collapsed across restarts, per file and per blob, so one file changing does not
discard the rest of your progress. Display preferences persist too.

**Keyboard.**

| | |
| --- | --- |
| `j` `k` | between files |
| `n` `p` | between comment threads |
| `v` | mark the current file viewed |
| `c` | comment on the selected lines |
| `⌘↵` | submit the review |
| `?` | this list |
| `F2` `F3` | diff stats, system monitor |

## Not yet

- Image and binary files render a placeholder row rather than a real diff, since
  `@pierre/diffs` has no binary handling of its own.
- No command palette.
- No way to share a review. It is yours, on your machine.

## Everything stays on your machine

There is no hosted service and no account. `hunk` binds loopback and serves both
the app and the data, so it is all one origin: no CORS, no pairing, no permission
prompt for reaching localhost from a public page.

A GitHub token is only needed for pull requests, and only private ones at that.
It is read from `gh auth token` or `GH_TOKEN`, stays in the server process, and
is proxied rather than handed to the browser.

Binding a port your browser can reach has two consequences, and each gets its own
answer. A page can point a hostname it controls at `127.0.0.1` and have your
browser treat its origin as ours, so the `Host` header is checked against the
names we actually answer on. A page can also fire a write at the real address
without being able to read the reply, so anything that is not a GET needs a
recognised `Origin`.

A request names a repository either by the id `hunk` puts in the URL or by path,
and any repository on the machine is reachable. What stops that being a way to
read your disk from a web page is the pair of checks above plus the absence of
CORS headers: a foreign page can start a request but cannot read the response,
and the repositories you have opened are a recents list rather than a gate.

## Why `hunkyard.localhost`

RFC 6761 reserves `.localhost`, so the name resolves to `127.0.0.1` with no
`/etc/hosts` entry, and on macOS it goes through the system resolver so Safari
works too. Port **4865** is `HUNK` on a phone keypad.

The point is a stable origin. An ephemeral port would mean a new origin on every
restart, so `localStorage` would reset each time, losing viewed state and
display preferences.

## Develop

```bash
bun install
bun dev                 # http://hunkyard.localhost:4865, API included
bun run build           # client, then a binary at dist/hunk
bun run build:release   # cross-compiled binaries for every platform, plus checksums
bun test
bun run typecheck
```

CI runs the same three commands on every push, then builds the binary and smoke
tests it: health, the embedded client, and a real diff from a scratch repository.
Pushing a `v*` tag builds every target and publishes the release. `bun build
--compile` is not reproducible, so `SHA256SUMS` describes the artifacts that run
produced and nothing else.

`bun test` includes browser tests that drive real Chrome over the DevTools
Protocol (`lib/test/ui.integration.test.ts`). Bun recommends happy-dom for DOM
testing and it is right for a component in isolation, but it has no layout
engine, so `getBoundingClientRect` returns 0x0. The diff surface is virtualized
and measures item heights, and selecting lines means dragging over a gutter at a
coordinate, so those checks need a real browser. Workers do run under happy-dom,
since Bun provides real ones.

Waits are real elapsed time. `--virtual-time-budget` cannot be used here: it
advances the main thread's clock but not a worker's, and the viewer is gated on
the highlight pool booting, so under virtual time the page reaches `ready`
before the pool exists and the diff never appears.

For looking at something rather than asserting it, `scripts/drive.ts` shares the
same client:

```bash
bun scripts/drive.ts http://hunkyard.localhost:4865/local \
  drag:344,159,344,179 key:c shot:/tmp/a.png
```

## What changed from upstream

DiffsHub is a read-only viewer, deliberately a preview of what the libraries can
do: its comment layer persists nothing and assigns you a random Pierre-employee
avatar. Hunkyard keeps the rendering pipeline and replaces that layer.

- Added a local-git source: six targets, merge-base ranges, untracked-file
  synthesis, whole-file reads for hunk expansion, and SSE watch mode.
- Replaced the demo comment layer with real threads over two stores, a GitHub
  one and a local markdown one.
- Plumbed the head commit through, which no response header carried, so a review
  comment has a `commit_id` to anchor to.
- Content-addressed highlight cache keys from the blob ids in each patch's
  `index` line. Keying on the path meant a working tree kept stale highlighting,
  since its content changes while its path does not.
- Trimmed the dependency overrides to the two that are load-bearing.
  `@pierre/theming` pins shiki 4.4.1 while `@pierre/diffs` accepts `^3 || ^4`,
  which installs two copies and so two grammar registries; and `@pierre/trees`
  and `@pierre/diffs` pin different `@pierre/theming` patches while both hold
  resolved-theme state at module scope. Pinning shiki's `@shikijs/*` family
  separately did nothing, because shiki already pins it exactly.
- Ported off Next.js to Vite and Hono, then to a single Bun executable: 187MB of
  runtime dependencies down to none at all.
- Removed Berkeley Mono (commercially licensed, not redistributable) in favour of
  [Ioskeley Mono](https://github.com/ahatem/IoskeleyMono), and the bundled Pierre
  staff photos the demo comment layer used.
- Removed Vercel analytics, the demo CDN patch blobs and the `/gh` redirect stub.
- Extracted from the `pierrecomputer/pierre` monorepo: `catalog:`/`workspace:*`
  specifiers pinned to literals, moonrepo and the TS project references dropped,
  `@pierre/*` consumed from npm.

## Built on

[DiffsHub](https://diffshub.com) by
[The Pierre Computer Company](https://pierre.computer), using their
[`@pierre/diffs`](https://diffs.com) and
[`@pierre/trees`](https://trees.software) libraries for the virtualized diff
surface and file tree.

## License

Apache-2.0, inherited from upstream. See `LICENSE` for the terms and `NOTICE`
for the attribution.
