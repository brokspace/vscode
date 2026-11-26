# Changelog

All notable changes to Brokspace for VS Code. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Set up this folder** asks before writing files for coding agents into your project, listing them, and you can set up without them. Before, they were written while the checklist said nothing in your code changed ([brok#198](https://github.com/brokspace/brok/issues/198)).
- **Download and Install brok** now brings `brok-agent` too. Before, a downloaded brok had no agent, so there were no answers, reviews, commit messages or live index updates. If you downloaded brok earlier, the extension offers to add the agent ([#19](https://github.com/brokspace/vscode/issues/19)).

## [0.5.1] - 2026-11-26

### Fixed

- Workspace search stops the `brok` process of a query you have already changed, and of the one still running when you close the list, instead of letting them run to the end ([#70](https://github.com/brokspace/vscode/issues/70)).

## [0.5.0] - 2026-11-25

### Added

- Polish the chat header, composer and message footer (#68)
- Attach open tabs and folders and honor index.exclude (#66)
- Add a navigation menu and the workspace to the chat header (#65)

## [0.4.0] - 2026-11-25

### Added

- Chat polish: the header drops the duplicate settings gear and shows the model as a pill that switches between your configured providers (or asks the index alone once); with no model it reads "Index-only · Connect LLM" and opens the model setup. The navigation menu is now labeled **Tools**. The composer is one box: attached context sits inside it as pills, a **+ Context** menu offers the active file, selection, uncommitted Git changes, a folder, open tabs, problems and picked files (with quick buttons for the file and the selection), `@` in the box does the same from the keyboard, and Send turns into Stop while an answer streams. Sources show `file.ts:12-48 · symbol` with the folder muted, and every answer ends with Copy, Retry and the model that wrote it. Git changes never include credential, ignored or excluded files.
- More ways to attach context: the open tabs and a folder you pick (its first eight text files), both under the same rules as a single file, with a note of how many files were left out and why. Brokspace's own `index.exclude` now also keeps a file out of what is attached, besides Git's ignore rules and the credential filter.
- Add a design and accessibility baseline to the webviews (#62)
- Guide the first run with a checklist to a first answer (#60)

## [0.3.0] - 2026-11-25

### Added

- A design and accessibility baseline for the chat, history, settings and first-run checklist: one focus ring for every control, answers announced to screen readers when they start and finish (instead of reading a streamed answer word by word), motion that follows the reduced-motion preference, borders in high-contrast themes, a layout that holds in a narrow sidebar and a wide editor tab, and accessible names on every field. Tokens and components are documented in `docs/design-system.md`.
- A guided first run in the chat: a short checklist from how your data is handled, through brok, the folder and the workspace setup, to your first question, with optional steps (a model, a memory, MCP, a linked repository) that you can skip and resume. Each step follows the real state, so an existing brok, workspace or model is detected and kept, and someone who already has a model configured is not guided. Setting up the folder shows progress and can be cancelled and run again. A first answer (even from the index alone, with no model) completes it, hide it any time, and **Brokspace: Get Started** shows it again. Your choices are kept per workspace across restarts. Downloading brok still asks first, and offline or package-manager users get the install guide.
- Activity under each answer: an expandable list of the steps the assistant took (attached context, searching the index, asking your model, running a skill, saving a note) with their state, duration and the files or memories each read or changed, and a label that says whether a step only reads, sends your question to your LLM, or changes something. A step cut short by closing the window shows as stopped. Saving a note with `/remember` is the one write today and goes through an approval gate (typing the command is the approval); the gate runs an action once, never repeats a succeeded one, and reports one cancelled mid-way as such.
- A friendlier chat composer: typing `/` opens a menu of commands with descriptions (`/review`, `/review staged`, `/review base <ref>`, `/skill <name> <task>` with your skills listed, and the new `/search` and `/remember`), navigable with the arrow keys, Tab and Enter and announced to screen readers. Suggestions fill the box and never send. With code selected or a file open, the empty chat offers to explain it. Up and Down walk the earlier prompts from an empty box. `brokspace.chat.sendWith` chooses Enter or Ctrl/Cmd+Enter to send. New commands **Brokspace: New Chat** (`Ctrl+Alt+N`, `Cmd+Alt+N` on macOS, with the chat focused) and **Stop the Answer**; Escape stops an answer from the box.
- Attach context to a question: buttons above the composer add the active file, the selected code, files you pick, or the active file's errors and warnings. They show as chips before you send, with what was done to them (shortened, secrets hidden, left out). A chip is for the next question only, or pinned for the whole conversation. Files that hold credentials and files Git ignores are never attached, a file outside the workspace only when you pick it, secrets in the text are hidden, and each item and the total are bounded. The attached context reaches your LLM only with the question you send.
- Conversation history: a History tab in the sidebar lists the chats of this workspace, with search over titles and messages, resume, rename, delete and clear history (with confirmation). Chats are kept in the workspace's own storage with their sources and model, an answer cut short by closing the window comes back as interrupted, and nothing is kept when `brokspace.chat.saveSessions` or brok's `memory.sessions` is off. They are separate from memories.
- Settings live in the same sidebar: a Chat and Settings tab bar switches between them without losing the conversation or the draft. Clicking the model in the chat opens the Model settings.

## [0.2.0] - 2026-11-25

### Added

- Chat is now the first view of the Brokspace activity-bar container, so clicking the icon opens the assistant. It is the same conversation as before: **Brokspace: Open Chat** focuses it, and the new **Brokspace: Open Chat in the Editor** opens it in an editor tab for a larger canvas, sharing the same conversation.

### Changed

- Published to Open VSX (`brokspace.brokspace`) through Trusted Publishing, so Cursor, Windsurf, VSCodium and other Open VSX editors install it from their extensions view.

## [0.1.2] - 2026-11-24

### Changed

- The downloaded brok must be between 0.4.0 and below 1.0.0: a release outside that range is explained and not downloaded, instead of installing a brok the extension was not written for (brokspace/vscode#19).

## [0.1.1] - 2026-11-23

### Changed

- Clearer Marketplace listing: a descriptive name ("Brokspace: Local AI Code Search & Memory"), description, keywords, a search demo and an FAQ in the README. The extension id is unchanged.

### Fixed

- The README logo showed as raw HTML tags on the Visual Studio Marketplace; it is now a plain image.
- Search results were hidden whenever the words you typed did not match a result's label, which is most natural-language queries. brok ranks the results, and they are now always shown.

## [0.1.0] - 2026-11-23

The first release, replacing Brokspace IDE. Needs brok 0.4.0 or newer.

### Added

- Brokspace sidebar: overview, memories, linked workspaces, shards and skills,
  with welcome views that guide setup.
- Search across the workspace and its linked workspaces as you type.
- Chat panel with answers from your LLM through brok and their sources;
  `/review`, `/review staged`, `/skill`. Falls back to the index without an LLM.
- `@brokspace` chat participant where the editor has the Chat API.
- Memory: remember notes or the selection, browse, search and forget;
  chats saved as session memories.
- Linked workspaces: add a folder or Git repository, sync, remove.
- Reviews of the working tree or staged changes, and commit messages from the
  Source Control title bar.
- Skills, shards and agent setup commands.
- brok's MCP server registered with the editor (VS Code 1.101+).
- Settings page: model and providers, memory, linked workspaces, metrics,
  diagnostics and bug reports.
- English and Brazilian Portuguese.
- Download on first use: when brok is not found, the extension offers to download it from the
  brokspace/brok GitHub releases, verified against its published SHA-256, into its own storage
  (no administrator rights). An existing install always wins. New command
  **Brokspace: Download and Install brok** (brokspace/vscode#19).

### Changed

- The release workflow publishes to the Visual Studio Marketplace with
  Trusted Publishing (OIDC) instead of a `VSCE_PAT` secret. Open VSX publishing
  is unchanged. See the setup in the brok repository, `docs/publishing.md`.
- `package.json` declares the license as the SPDX expression
  `MIT OR Apache-2.0`.

### Fixed

- Send extension bug reports directly to `brokspace/vscode` when the installed
  brok supports the native `vscode` report target. Older brok releases keep
  the existing compatible fallback.
