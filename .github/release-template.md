Code review that works on a pull request, a local branch, or whatever you have
not committed yet.

![hunkyard reviewing a working tree](https://raw.githubusercontent.com/jatindotdev/hunkyard/{{COMMIT}}/docs/screenshot.png)

{{NOTES}}

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/jatindotdev/hunkyard/main/scripts/install.sh | sh
```

One executable with the Bun runtime, the server and the whole client compiled
into it. No Node, no Bun, no `node_modules`. You also get `git hunk`, with a man
page. `HUNK_VERSION` pins a release and `HUNK_INSTALL_DIR` chooses where it
lands.

<details>
<summary>An unrelated tool is also called <code>hunk</code></summary>

If you already have one on your PATH, whichever directory comes first decides
which runs. The installer names the one that wins.
</details>

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

It opens a browser and returns. The server runs in the background on
`hunkyard.localhost:4865` and serves every repository, so running `hunk`
elsewhere does not restart it.

<details>
<summary>Verifying a download</summary>

`SHA256SUMS` covers every asset.

```bash
shasum -a 256 -c SHA256SUMS
```

`bun build --compile` is not reproducible, so these are the checksums of these
artifacts rather than of a rebuild.
</details>

---

**{{VERSION}}** · built by [this run]({{RUN_URL}}) from
[`{{COMMIT_SHORT}}`](https://github.com/jatindotdev/hunkyard/commit/{{COMMIT}}) ·
built on [DiffsHub](https://diffshub.com) by
[The Pierre Computer Company](https://pierre.computer), Apache-2.0
