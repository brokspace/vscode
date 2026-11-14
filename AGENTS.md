# AGENTS.md

Operating guide for coding agents working in `brokspace/vscode`. Read the README first for what this repository is and how to run it.

## Layout

- `src/extension.ts`: activation, commands, status bar, MCP registration.
- `src/core/`: no `vscode` imports, unit-tested with `node:test`. `brok.ts` runs brok and reads its `--json` output; `protocol.ts` mirrors brok's JSON shapes; `text.ts` must stay free of Node imports because the webviews bundle it.
- `src/model.ts`, `memory.ts`, `views.ts`, `search.ts`, `chat.ts`, `webviews.ts`: the editor side.
- `webview/`: the settings page and the chat panel (React, bundled by `esbuild.mjs`). They talk to the extension only through the messages in `src/webview-protocol.ts`.
- `l10n/` and `package.nls*.json`: translations. User-visible text goes through `vscode.l10n.t` (extension) or `t` (webviews), keyed by the English text.

## Rules

- brok is the only way to an LLM and to the index. Never call a model or read `.brokspace/` directly; add or use a brok `--json` command. Pass values as `--key=value` so a value starting with `-` is never read as an option.
- Keep `engines.vscode` at `^1.90.0` so Cursor, Windsurf and other forks can install the extension. Feature-detect newer APIs (`vscode.chat`, `vscode.lm.registerMcpServerDefinitionProvider`).
- New or changed strings: run `npm run l10n:check -- --write`, then add the Portuguese in `l10n/bundle.l10n.pt-br.json` (and `package.nls.pt-br.json`). CI fails on missing translations.
- Never put API keys or other secrets in files, tests or logs.

## Git workflow

Every change reaches `main` through `staging`, the default branch:

```text
your branch --PR, squash--> staging --release PR, merge commit--> main --> tag
```

1. Branch from staging: `git fetch origin && git switch -c <type>/<topic> origin/staging`.
2. Commit in small steps with Conventional Commits. End every commit message with a `Co-Authored-By:` trailer naming the agent: the PR gets the `ai-agent` label from it.
3. Before pushing, run what CI runs: `npm run lint && npm run typecheck && npm run l10n:check && npm run test:unit`, and `npm run test:integration` when you touched activation, commands or webviews.
4. Push, open the PR against staging, and turn on auto-merge:

   ```sh
   git push -u origin HEAD
   gh pr create --base staging --fill
   gh pr merge --auto --squash
   ```

5. A check failed? Read it (`gh pr checks --watch`, `gh run view --log-failed`), fix it on the same branch and push. Cannot fix it? Say what you tried in a PR comment and stop. Never weaken or skip a check to get green.

Never push to `staging` or `main`, force-push a branch someone else pushed to, open or merge PRs into `main`, or merge with `--admin`. The release PR into `main` is opened by the Promote workflow and merged by a maintainer.

## Releasing (maintainers)

Bump `version` in `package.json` and move the `CHANGELOG.md` entries under it, merge the release PR, then tag `vX.Y.Z` on `main`. The Release workflow publishes to the Visual Studio Marketplace and Open VSX and attaches the `.vsix` to the GitHub release.
