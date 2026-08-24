# Changelog

A release's notes are its section here, and nothing else: install and usage live
in the README rather than being repeated on every release page. A section is
required before a tag can be published.

Headings inside a release's section must be `###` or deeper. A `##` is how the
next version is found, so using one for a subsection silently truncates the
notes at that point, which is a thing that has already happened once.

## Unreleased

### Open anything from the browser

The CLI used to decide what you review: you `cd` into a repository, run `hunk`,
and the UI renders whatever that invocation chose. It could not browse for a
repository, list what you had opened, or pick a target without you hand-typing a
revspec into the URL bar.

- **A filesystem browser** at `/`, with a recents list, git badges, a filter and
  keyboard navigation. It says whether the folder you are standing in is a
  repository or sits inside one, so either opens in a click.
- **A target picker** per repository: the working tree, the index, all
  uncommitted changes with counts, this branch against its likely base, any two
  refs, a recent commit, or a revspec you type.
- **`⌘K` in the header** switches target or repository without leaving the
  review. Not a command palette: Radix already gives arrow keys, typeahead and
  focus return.
- `hunk` outside a repository opens the picker rather than failing.

### The server can start at login

`hunk install` now installs a user login agent as well as the port-80
forwarder, so `http://hunkyard.localhost` works cold with no terminal involved.
`hunk install --no-bare-url` installs the agent alone, which is also the half
that needs no sudo. `hunk stop` still stops the server; the agent starts it
again at your next login rather than immediately.

With the bare host in play there were two origins for one app, and browser
storage is per-origin, so viewed state would have depended on which URL you
opened. The bare host is canonical and the ported one redirects to it, gated on
the forwarder actually answering so it fails towards serving rather than
pointing at a dead port.

### Fixed

- **A pasted GitLab URL rendered a github.com repository.** A host with no way
  to fetch a patch from it resolved to a bare path, which the viewer then read
  as github.com. Unsupported hosts are now refused, and `tangled.org` -- which
  the server has always supported and the client could not reach -- works.
- **The header could not say which repository you were viewing**, which is
  invisible with one repository and wrong with two tabs.
- **`hunk install` refused to install from a release binary.** `--bytecode`
  makes `import.meta.path` the original source path, so the compiled-binary
  check never fired on the binary that actually ships.
- **Private pull requests would have broken after `hunk install`**: a login
  agent has neither `GH_TOKEN` nor a terminal that ran `gh`. The server now
  falls back to asking `gh` itself, which also means signing in to `gh` after
  the server started no longer needs a restart.

### Security

`Sec-Fetch-Site` is now checked on `/api/*`. `Origin` is absent on same-origin
GETs so its absence cannot be refused, and missing CORS headers stop a foreign
page *reading* a reply rather than stop the work behind it -- which is not
enough for an endpoint that enumerates directories.

The control token is gone. Registering a repository granted nothing that
`?repo=<path>` did not already, so writes are gated on an `Origin` that is
present and ours instead. That makes the guard the whole boundary for writes:
widening the `Host` allowlist would widen them too.

## v0.1.0

First release.

### What it does

- **Local review as well as pull requests.** Working tree, staged, `--all`, any
  revspec, any commit. Three-dot ranges are diffed against the merge base, the
  anchor GitHub uses, so line numbers agree with the eventual PR. Untracked files
  are synthesised into the diff without touching your index.
- **Real review threads.** Multi-line anchors, replies, resolve, as many drafts
  open at once as you like. On a pull request they submit as one batched review.
  Locally they are written to `.hunkyard/review.md` in the repository, readable
  prose an agent can read back.
- **Per-file viewed state** that survives a restart, stored against the blob it
  was viewed at, so one file changing does not discard progress on the rest.
- **Keyboard.** `j`/`k` files, `v` viewed, `c` comment on the selection, `n`/`p`
  threads, `⌘↵` submit, `?` for the list.
- **Watch mode** that reloads on a real content change and holds your scroll
  position.
- Per-file line counts in the tree, and syntax highlighting through a worker
  pool.

### Everything stays on your machine

No hosted service, no account. `hunk` binds loopback and serves both the app and
the data, so it is all one origin. Cold start is about 90ms, and a second
invocation reuses the running server in about 40ms.

A GitHub token is only needed for private pull requests. It is read from
`gh auth token` or `GH_TOKEN`, stays in the server process, and is proxied rather
than handed to the browser.

The `Host` header is checked so a page cannot point a name it controls at
`127.0.0.1`, writes need a recognised `Origin`, and no route sends CORS headers,
so a foreign page can start a request but cannot read the reply.

### Not yet

- Image and binary files render a placeholder row; `@pierre/diffs` has no image
  support.
- No command palette.
- No way to share a review. It is yours, on your machine.
