# Changelog

All notable changes to Brokspace for VS Code. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
