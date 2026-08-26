# AGENTS.md

Notes for agents working in this repo. Everything here was learned the hard way
during development; none of it is guessable from the code.

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
