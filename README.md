# Hunkyard

Code review that works on a pull request, a local branch, or whatever you have
not committed yet.

GitHub's review UI is slow on large diffs and can only review something that is
already a pull request. Hunkyard reviews any of them, runs entirely on your
machine, and renders diffs of a size the GitHub UI gives up on.

```bash
hunk                    # review what you have not committed
hunk --staged           # review what you are about to commit
hunk main...my-branch   # review a branch as a PR would show it
hunk HEAD~3             # review the last three commits
hunk owner/repo#123     # review a pull request
```

It serves itself at `http://hunkyard.localhost:4865` and opens a browser.
Ctrl-C stops it.

`hunk` is a single executable with the Bun runtime, the server and the whole
client compiled into it. Nothing to install alongside it, no Node, no Bun, no
`node_modules` — download the binary for your platform and run it.

Built on [DiffsHub](https://diffshub.com) by
[The Pierre Computer Company](https://pierre.computer) (Apache-2.0), using their
[`@pierre/diffs`](https://diffs.com) and [`@pierre/trees`](https://trees.software)
libraries for the virtualized diff surface and file tree.

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

**Keyboard.** `j`/`k` between files, `v` to mark viewed, `c` to comment on the
selected lines, `n`/`p` between threads, `⌘↵` to submit, `?` for the list.

## Everything stays on your machine

There is no hosted service and no account. `hunk` binds loopback and serves both
the app and the data, so it is all one origin — no CORS, no pairing, no
permission prompt for reaching localhost from a public page.

A GitHub token is only needed for pull requests, and only a private one at that.
It is read from `gh auth token` or `GH_TOKEN`, stays in the CLI process, and is
proxied rather than handed to the browser.

The trade is that a review is yours: there is no URL to send anyone.

## Why `hunkyard.localhost`

RFC 6761 reserves `.localhost`, so the name resolves to `127.0.0.1` with no
`/etc/hosts` entry, and on macOS it goes through the system resolver so Safari
works too. Port **4865** is `HUNK` on a phone keypad.

The point is a stable origin. An ephemeral port would mean a new origin on every
restart, and `localStorage` — viewed state, display preferences — would reset
each time.

## Develop

```bash
bun install
bun dev                 # http://hunkyard.localhost:4865, API included
bun run build           # client, then a binary at dist/hunk
bun run build:release   # cross-compiled binaries for every platform
bun test
bun run typecheck
```

`scripts/drive.mjs` drives the app in headless Chrome over the DevTools
Protocol, as a list of steps, which is how the UI gets verified:

```bash
node scripts/drive.mjs settle:9000 nav:http://hunkyard.localhost:4865/local \
  drag:344,159,344,179 key:c probe shot:/tmp/a.png
```

Waits are real elapsed time. `--virtual-time-budget` cannot be used here: it
advances the main thread's clock but not a worker's, and the viewer is gated on
the highlight pool booting, so under virtual time the page reaches `ready`
before the pool exists and the diff never appears.

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
- Ported off Next.js to Vite and Hono, then to a single Bun executable: 187MB of
  runtime dependencies down to none at all.
- Removed Berkeley Mono (commercially licensed, not redistributable) in favour of
  [Ioskeley Mono](https://github.com/ahatem/IoskeleyMono), and the bundled Pierre
  staff photos the demo comment layer used.
- Removed Vercel analytics, the demo CDN patch blobs and the `/gh` redirect stub.
- Extracted from the `pierrecomputer/pierre` monorepo: `catalog:`/`workspace:*`
  specifiers pinned to literals, moonrepo and the TS project references dropped,
  `@pierre/*` consumed from npm.

Binary and image files render a placeholder row rather than a real diff, since
`@pierre/diffs` has no binary handling of its own.

## License

Apache-2.0, inherited from upstream. See `LICENSE.md`.
