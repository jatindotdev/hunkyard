# Changelog

Each release's notes are taken from its section here, so a section is required
before a tag can be published. The surrounding boilerplate lives in
`.github/release-template.md`.

## v0.1.0

First release.

### What is in it

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

### Not in it yet

- Image and binary files render a placeholder row; `@pierre/diffs` has no image
  support.
- No command palette.
- No way to share a review. It is yours, on your machine.
