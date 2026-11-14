## What and why

<!-- What does this change and which problem does it solve? Link the issue: "Closes #123". -->

## Evidence it works

<!-- Commands run, new tests, screenshots of UI changes (light and dark themes), editors checked (VS Code, Cursor, Windsurf). -->

## Checklist

- [ ] Targets `staging`; PR title follows Conventional Commits (`feat(chat): ...`, `fix(search): ...`)
- [ ] `npm run lint`, `npm run typecheck`, `npm run l10n:check` and `npm run test:unit` pass
- [ ] New strings are translated (`l10n/bundle.l10n.pt-br.json`, `package.nls.pt-br.json`)
- [ ] User-visible changes are in `CHANGELOG.md` (Unreleased) and the README
- [ ] Still installs on `engines.vscode` (^1.90.0); newer APIs are feature-detected
- [ ] Written with a coding agent? Its commits carry a `Co-Authored-By:` trailer, and a human read the diff
