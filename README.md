# Hunkyard

A replacement for GitHub PR review that also works on local branches and your
working tree.

Built on [DiffsHub](https://diffshub.com) by
[The Pierre Computer Company](https://pierre.computer) (Apache-2.0), using their
[`@pierre/diffs`](https://diffs.com) and [`@pierre/trees`](https://trees.software)
libraries for the virtualized diff surface and file tree.

## Status

Phase 0 complete: the upstream app is extracted into a standalone repo, builds
clean, and renders GitHub diffs. The review layer, the local-git source and the
CLI are not built yet — see the plan for the phase breakdown.

## Develop

```bash
pnpm install
pnpm dev          # http://hunkyard.localhost:4865
```

`hunkyard.localhost` resolves to `127.0.0.1` with no `/etc/hosts` entry on
Chrome, Edge and Firefox (RFC 6761 reserves `.localhost`), and on macOS it
resolves through the system resolver so Safari works too. Everything local uses
this one origin on port **4865** — `HUNK` on a phone keypad — so `localStorage`
survives restarts.

```bash
pnpm build        # production build
pnpm test         # bun test
pnpm typecheck    # tsgo --noEmit
```

## What changed from upstream

- Extracted from the `pierrecomputer/pierre` monorepo: `catalog:`/`workspace:*`
  specifiers pinned to literals, moonrepo and the TS project references dropped,
  `@pierre/*` consumed from npm.
- Removed a cross-package import that reached into `packages/trees/dist`.
- Removed Berkeley Mono (commercially licensed, not redistributable) in favour of
  Geist Mono, and the bundled Pierre staff photos used by the demo comment layer.
- Removed Vercel analytics, the demo CDN patch blobs and the `/gh` redirect stub.
- Rebranded to Hunkyard, keeping upstream attribution.

## License

Apache-2.0, inherited from upstream. See `LICENSE.md`.
