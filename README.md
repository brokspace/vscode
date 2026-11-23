<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/brokspace-on-dark.png">
    <img src=".github/brokspace.png" alt="Brokspace" height="88">
  </picture>
</p>
<p align="center"><b>Brokspace for VS Code: your workspace, understood.</b></p>

Brokspace in the editor you already use. Search every repository in your
folder by meaning, ask questions answered by your own LLM with the sources it
used, review your changes, write commit messages, and keep a memory of
decisions that lasts across sessions and workspaces. Everything runs locally
through [brok](https://github.com/brokspace/brok).

Works in VS Code 1.90+ and the editors built on it: Cursor, Windsurf, Devin
Desktop, VSCodium. English and Brazilian Portuguese.

## What's inside

|                                  |                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Search** (`Ctrl+Alt+F`)        | Semantic and keyword search across the workspace and its linked workspaces, as you type.                                                                                         |
| **Chat** (`Ctrl+Shift+Alt+B`)    | Questions about the code, answered by your LLM through brok, with the sources. `/review`, `/review staged`, `/skill <name> <task>`. Without an LLM, answers come from the index. |
| **`@brokspace` in Copilot Chat** | The same agent as a chat participant, where the editor has the Chat API.                                                                                                         |
| **Memory** (`Ctrl+Alt+M`)        | Remember a decision, a convention or the selected code; browse, search and forget memories in the sidebar. Chats can be saved as session memories.                               |
| **Linked workspaces**            | Link a local folder or a Git repository (for example the `checkout` service your `user` service calls) and search both.                                                          |
| **Review and commit messages**   | Review the working tree or the staged changes; write the commit message from the Source Control title bar.                                                                       |
| **Skills and shards**            | Run skills, install and remove shards, export skills to your agents.                                                                                                             |
| **MCP**                          | Registers brok's MCP server, so Copilot agent mode and other MCP clients get Brokspace search and memory.                                                                        |
| **Settings** (`Ctrl+Alt+,`)      | Model and providers, memory, linked workspaces, metrics, diagnostics and bug reports, in one page.                                                                               |

## Requirements

- [brok](https://brokspace.org/docs/getting-started) 0.4.0 or newer. The extension finds
  it at `brokspace.brokPath`, in `BROK_PATH`, in the usual install locations, or on the `PATH`.
  If it finds none, it offers to download it (see below).
- For answers, reviews and commit messages: an LLM brok can reach (Ollama or
  any OpenAI-compatible provider) and the `brok-agent` shard. **Brokspace:
  Set Up Workspace** walks you through it.

### Download on first use

If brok is not installed, the extension asks before doing anything. Say **Download** and it:

- downloads the `brok` executable for your platform from the
  [brokspace/brok GitHub releases](https://github.com/brokspace/brok/releases) (about 150 to 220 MB; no other host);
- checks it against the SHA-256 published next to it, and installs nothing if it does not match;
- keeps it in the extension's own storage folder: no administrator rights, no change to your `PATH`.

It never replaces a brok you already have: `brokspace.brokPath`, `BROK_PATH`, the usual install folders and
the `PATH` all win over the downloaded copy. Run **Brokspace: Download and Install brok** to do it later, and
remove it by uninstalling the extension. The download is a convenience, not a substitute for your package
manager: `brew install brokspace/brok/brok`, APT or the release binary keep working and update brok on their own.
This is the only network access the extension itself makes; everything else goes through brok.

## Getting started

1. Install brok, then this extension.
2. Open a folder and run **Brokspace: Set Up Workspace** from the Brokspace sidebar or
   the Command Palette. It creates `.brokspace/brok.yml`, indexes the folder
   and starts brok.
3. Press `Ctrl+Alt+F` to search, or `Ctrl+Shift+Alt+B` to ask.

Something wrong? **Brokspace: Doctor** shows `brok doctor`, and
**Brokspace: Report a Bug** opens a prefilled GitHub issue with the
diagnostics (secrets masked) in the right repository.

## Settings

| Setting                       | Default |                                                                                                           |
| ----------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `brokspace.brokPath`          | `""`    | Path to the brok executable. Empty: `BROK_PATH`, the install locations, then the `PATH`.                  |
| `brokspace.mcp.enabled`       | `true`  | Register brok's MCP server with the editor. Skipped when `.vscode/mcp.json` already declares `brokspace`. |
| `brokspace.chat.saveSessions` | `true`  | Save chats as session memories (also needs `memory.sessions` in `brok.yml`).                              |
| `brokspace.statusBar.enabled` | `true`  | Show Brokspace's state in the status bar.                                                                 |

Everything else (the model, providers, memory, linked workspaces) lives in
`.brokspace/brok.yml`, so the CLI, the extension and your agents share it.

## Development

```sh
npm ci
npm run build              # dist/ (extension and webviews)
npm run lint && npm run typecheck && npm run l10n:check
npm run test:unit          # set BROK_TEST_PATH to a brok binary for the contract tests
npm run test:integration   # in a downloaded VS Code
npm run package            # brokspace-<version>.vsix
```

Press `F5` with the folder open in VS Code to run the extension in a new window.
Contributor and agent guide: [AGENTS.md](AGENTS.md).

## License

MIT or Apache-2.0, at your option.
