# Maintaining the personal Mac build

Use `personal/desktop` for the personal app. It carries these features and a build
helper on top of upstream `main`:

1. Configurable generated worktree branch prefixes, now provided by upstream's
   branch-naming settings. Saved personal prefixes migrate automatically.
2. Mermaid diagrams in chat (ported from PR #9621).
3. Diagram styling with beautiful-mermaid and the app palette, with original
   Mermaid as a fallback for unsupported syntax.
4. Chat math with lazy-loaded KaTeX, Codex-compatible delimiters, and TeX copying
   (adapted from PR #12118 and the public Codex terminal's single-dollar rules).
5. Named chat folders with session moves and saved collapse state on web and desktop.
6. Claude workflow agent names and live status in thread details, including background progress.

`upstream` points to `https://github.com/pingdotgg/t3code.git`. `origin` points to
the personal fork at `https://github.com/luohao/t3code.git`. Keep personal changes
on `personal/desktop`; `main` does not need the patches.

## Sync with upstream

Start with a clean working tree. Commit any new personal changes before rebasing.

```sh
git switch personal/desktop
git status --short
git fetch upstream main
git branch "backup/desktop-$(date -u +%Y%m%d%H%M%S)"
git rebase upstream/main
```

Rebase replays the personal commits after the latest upstream code. If it stops
on a conflict, resolve that commit, `git add` the resolved files, then run
`git rebase --continue`. `git rebase --abort` restores the branch to its state
before the rebase. If upstream adopts a feature, compare the behavior and tests
before dropping the corresponding personal commit. A successful rebase alone
does not prove that all personal features still work.

`upstream/main` is development code. Its package version can stay the same across
many commits; the personal suffix distinguishes successive local builds.

## Check and build

This Mac has Vite+ installed in a dedicated directory. In a new terminal, use:

```sh
export VP_HOME="$HOME/.local/share/t3code-vite"
export PATH="$VP_HOME/bin:$PATH"
vp install --frozen-lockfile
```

After syncing, run the focused feature checks:

```sh
(cd apps/server && vp test run src/serverSettings.test.ts)
(cd packages/shared && vp test run src/git.test.ts)
(cd apps/web && vp test run src/chatFoldersStore.test.ts src/components/sidebar/ChatFolders.test.tsx src/components/Sidebar.folders.test.tsx src/components/Sidebar.logic.test.ts src/components/threadActionMenu.logic.test.ts src/mermaidRenderer.test.ts src/components/MermaidDiagram.test.tsx src/components/ChatMarkdown.test.tsx src/markdown-clipboard.test.ts src/markdown-math.test.ts src/markdown-math-clipboard.test.ts src/markdown-incremental.test.ts)
vp run --filter @t3tools/web --filter t3 typecheck
```

Review and commit any compatibility fixes, then build:

```sh
./scripts/build-personal-desktop.sh
```

The helper installs the locked dependencies and produces an unsigned Apple
Silicon DMG and ZIP in `release/`. It requires a clean working tree, uses the
version in `apps/desktop/package.json`, and adds `-personal.<UTC timestamp>`.
For an upstream prerelease, it appends `.personal.<UTC timestamp>` instead.
It refuses to overwrite an existing DMG or ZIP with the same version.

To choose a revision explicitly, use `./scripts/build-personal-desktop.sh 3`.
With package version `0.0.42`, that produces `0.0.42-personal.3`. The script changes
only build metadata; it does not bump source package versions. The app embeds the
committed source hash. Keep the DMG and ZIP for any build you may want to reinstall.

The helper disables signing discovery and the automatic update feed so an
upstream release cannot replace the personal patches. It neither publishes nor
installs the app. Wait until active agent turns and terminal work finish before
quitting T3 Code and replacing the installed app.

## Existing builds

The `personal.1` and `personal.2` suffixes were chosen manually using the existing
packager's `--build-version` option:

| Version             | Source tag                   | Contents                        |
| ------------------- | ---------------------------- | ------------------------------- |
| `0.0.42-personal.1` | `personal/0.0.42-personal.1` | Both PR ports                   |
| `0.0.42-personal.2` | `personal/0.0.42-personal.2` | Both ports plus diagram styling |

Those artifacts were built before the patches were committed. Their embedded
hash therefore reports the original base, `8dd02470b1e7`. The source tags were
created afterward from the saved build snapshots and preserve the source of those
artifacts. Rebasing `personal/desktop` does not move these tags or update old DMGs.

## Back up the branch to the fork

The initial setup is local. To publish this branch to the personal fork:

```sh
git push -u origin personal/desktop
git push origin personal/0.0.42-personal.1 personal/0.0.42-personal.2
```

Later rebases change commit IDs. For this personal branch, inspect any remote
changes before using `git push --force-with-lease origin personal/desktop`.
Never force-push upstream `main`.
