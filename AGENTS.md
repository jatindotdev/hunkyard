# AGENTS.md

Notes for agents working in this repo. The architecture section explains
decisions that look strange without their reasoning; everything after it was
learned by getting it wrong, and none of it is guessable from the code.

## What this is

Code review that runs on your machine. It reviews GitHub pull requests, and it
reviews things GitHub cannot: a local branch, a range, the index, the working
tree. One compiled Bun binary carries the server and the whole client, and
serves both at `http://hunkyard.localhost`.

It began as a fork of DiffsHub (Pierre, Apache-2.0) and has since diverged
deliberately -- its own name throughout the code, its own mark, its own opener.
NOTICE and README credit the origin, which the licence requires and which is
true; the identifiers no longer do, because the licence does not cover marks and
a codebase reading as somebody else's is harder to reason about.

## Nothing runs until someone asks for something

The single most surprising thing about this app, and the thing to understand
before changing anything near the server.

`hunk service install` registers one launchd job (a systemd socket unit on
Linux) that binds port 80 and holds it, with `RunAtLoad` off and `UserName` set
to you. The **first request** is what starts hunkyard, running as you, with the
already-bound socket handed over. Nothing of ours is ever privileged and there
is no process at all between reviews.

Consequences that will otherwise look like bugs:

- **`hunk` starts nothing.** Opening the URL does. A CLI that also spawned a
  server would race the one the request is about to create.
- **`hunk service status` reporting nothing running is the healthy state.**
- **Never ask port 80 whether the server is running** -- connecting is what
  starts it. Read the pid file (see below).
- The server **stops a minute after anything last spoke to it**, and the next
  request starts it again. Idle is measured in *traffic*, not open connections:
  browsers pool keep-alive sockets for minutes after a tab closes, so counting
  connections meant a closed tab kept it alive. An open review heartbeats its
  event stream every 10s, which is what tells a reader apart from a parked
  socket. `HUNKYARD_IDLE_TIMEOUT` in seconds, floor 20, `0` disables.
- launchd's `ThrottleInterval` is set to 1. The default is ten seconds, which
  for a start-on-demand job is a ten second stall on the next request after any
  quick stop.

`launch_activate_socket` is a C function, so this is the one place the app uses
FFI (`lib/service/activation.ts`). systemd passes descriptors from fd 3 and
needs none.

## The opener is one field

`/` is a single search field, not a page with sections. What you type decides
what it means: a path lists folders under it, a pull request is parsed with no
network, anything else matches the repositories you have opened. Choosing a
repository turns it into a chip and everything after that searches inside it.
⌘K opens the same field over a review, already scoped.

Descending into a folder **rewrites the field rather than navigating**, which is
why there is no back button -- the field is the whole state. Matching is a
scored subsequence in `lib/openerSearch.ts`, deliberately not a library.

## Conventions

- **Commits**: Conventional Commits, no ticket key in the subject. Signed --
  never pass `--no-gpg-sign`; if signing fails run `ssh-add --apple-load-keychain`.
- **Comments** say what the code does or why it is shaped that way, never the
  history of how it got there. A durable constraint is worth keeping; a
  narrated bug fix is not.
- **Motion** goes through the tokens in `app/globals.css` (`--ease-out`,
  `--duration-press|popover|panel|drawer`). Do not write a bare duration or
  curve; reduced motion works by collapsing those tokens, so anything bypassing
  them bypasses that too. A surface that arrives over another one uses the
  entrance classes there (`.hunkyard-scrim`, `.hunkyard-modal-enter`,
  `.hunkyard-palette-enter`, `.hunkyard-reveal`) -- see below for why they are
  entry-only.
- **Verification**: `bun test` (unit + real-Chrome integration), `bun run
  typecheck`, `bun run smoke` (drives the compiled binary end to end). All three
  before claiming something works.

## Always stop the server after building

```bash
bun run build && ./dist/hunk service stop
```

A running server keeps the executable image it started with, so replacing
`dist/hunk` changes nothing about what is answering requests. Testing a change
against a server started before the build is testing the old code, and it looks
exactly like the change not working. This has cost real time more than once.

Nothing needs starting afterwards: launchd holds the socket, so the next request
starts a server on the new binary. `hunk service status` says `stale` when the
binary on disk is newer than the server answering.

## Do not ask port 80 whether the server is running

Connecting is what starts it. A check written as `curl http://hunkyard.localhost`
starts a server in order to report that none was running, and — because idleness
is measured in traffic — also resets the idle clock of one that was already
there. Read the pid file instead:

```bash
cat "$HOME/Library/Application Support/hunkyard/daemon-80.pid"
```

It records both the pid and the ephemeral port the server actually listens on.
Ask that port for health; it bypasses the socket that counts as use.

## `pgrep -f "service run --activated"` matches the developer's own server

Any test agent you bootstrap looks identical to the real registered one, so a
`pgrep` that takes the first or last match will silently watch the wrong
process. This has produced a false "still running" result. Pin the pid by the
port the job listens on:

```bash
lsof -nP -iTCP:<port> -sTCP:LISTEN | awk 'NR>1 {print $2}'
```

## Testing socket activation needs no sudo

Bootstrap a throwaway **user** LaunchAgent on a high port with the same
`ProgramArguments` the real job uses (`service run --activated`), `RunAtLoad`
false, and `Sockets` naming `Listeners`. That exercises the whole path — launchd
starting the job on a connection, `launch_activate_socket` handing over the
descriptor, the idle timer — without touching port 80 or asking for a password.
Remember to `launchctl bootout` and delete the plist afterwards.

Note it writes `daemon-80.pid` into the shared state directory regardless of
which port it is behind, so it will stand on the real server's record.

## Entrances are entry-only, and `@starting-style` is why

The opener, the shortcuts modal and the regions that appear inside them animate
in and vanish out. That asymmetry is deliberate and load-bearing:

- Each of these is **unmounted when it closes**. Holding one mounted long enough
  to animate out means a palette that lingers after you have decided to leave,
  plus timing state in JS that the duration tokens cannot reach.
- `@starting-style` applies only to the **first style change after an element is
  inserted**, which is exactly the property that makes it safe on a region whose
  contents keep changing. `.hunkyard-reveal` bridges the results list growing
  from nothing to full height once; it does not re-animate that height on every
  keystroke as the list is re-filtered, which would rubber-band under typing.

Two things to know before using them:

- **`.hunkyard-reveal` takes exactly one element child.** It animates
  `grid-template-rows` from `0fr`, which only reaches the first row -- a second
  child lands in an implicit row and does not collapse. Wrap the contents.
- A browser without `@starting-style` shows the surface immediately, which is
  what every browser did before it existed. Nothing needs a fallback.

## A `:root` custom property resolves its `var()` at `:root`

A custom property is substituted **where it is declared**, not where it is used.
So this does not do what it reads as:

```css
:root {
  /* the theme sets --trees-theme-git-added-fg on the tree host, further down */
  --hunkyard-status-added: var(--trees-theme-git-added-fg, #00cab1);
}
```

The fallback is baked in once, at `:root`, and every element inherits that dead
value -- including the ones where the theme variable is genuinely in scope. This
cost a full cycle of "the token is right, the colour is wrong".

The fix is to resolve the indirection in TS and apply the result to the surface
that needs it (`lib/theme/gitStatusTokens.ts` does this for Git status colours),
leaving `:root` holding only the literal fallback.

## The diff surface's theme is not the app's theme

`useChromeThemeProps(diffshubChromeMapping)` maps Shiki syntax colours onto app
CSS variables, and its `--color-foreground` is the muted colour code is written
in. Applying it to app chrome turns every label mid-grey. It belongs on diff
surfaces; anything else uses the app's own tokens.

## Verifying the UI

`lib/test/browser.ts` drives real Chrome over CDP. Two things about it:

- `browser.press` cannot type characters needing a modifier, `#` included. Set
  the value through the input's native setter and dispatch an `input` event.
- A test that opens the ⌘K overlay must close it in a `finally`. Failing before
  the close leaves the panel over every test that follows, which then fail for
  reasons that have nothing to do with them.
