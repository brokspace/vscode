#!/usr/bin/env python3
# Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0
"""
Renders the webview bundle (dist/) with a stand-in for the extension host and
saves screenshots of the main states into docs/images, in a dark and a light
theme and in a narrow sidebar. Needs `npm run build` and Playwright
(`pip install playwright && playwright install chromium`). It shows the real
React UI with sample data, not a running editor.
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "images"
DIST = ROOT / "dist"

THEMES = {
    "dark": dict(cls="vscode-dark", vars={
        "foreground": "#cccccc", "descriptionForeground": "#9d9d9d", "errorForeground": "#f85149",
        "focusBorder": "#007fd4", "editor-background": "#1e1e1e", "sideBar-background": "#252526",
        "editorWidget-background": "#252526", "panel-border": "#3c3c3c", "widget-border": "#454545",
        "input-background": "#3c3c3c", "input-foreground": "#cccccc", "input-border": "#3c3c3c",
        "button-background": "#0e639c", "button-foreground": "#ffffff", "button-hoverBackground": "#1177bb",
        "button-secondaryBackground": "#3a3d41", "button-secondaryForeground": "#ffffff",
        "list-hoverBackground": "#2a2d2e", "textLink-foreground": "#3794ff", "textCodeBlock-background": "#2b2b2b",
        "toolbar-hoverBackground": "#5a5d5e50", "badge-background": "#4d4d4d", "badge-foreground": "#ffffff", "input-placeholderForeground": "#a6a6a6", "icon-foreground": "#c5c5c5", "testing-iconPassed": "#73c991",
    }),
    "light": dict(cls="vscode-light", vars={
        "foreground": "#3b3b3b", "descriptionForeground": "#717171", "errorForeground": "#a1260d",
        "focusBorder": "#005fb8", "editor-background": "#ffffff", "sideBar-background": "#f8f8f8",
        "editorWidget-background": "#f3f3f3", "panel-border": "#e5e5e5", "widget-border": "#c8c8c8",
        "input-background": "#ffffff", "input-foreground": "#3b3b3b", "input-border": "#cecece",
        "button-background": "#005fb8", "button-foreground": "#ffffff", "button-hoverBackground": "#0258a8",
        "button-secondaryBackground": "#e5e5e5", "button-secondaryForeground": "#3b3b3b",
        "list-hoverBackground": "#e8e8e8", "textLink-foreground": "#005fb8", "textCodeBlock-background": "#f0f0f0",
        "toolbar-hoverBackground": "#b8b8b850", "badge-background": "#c4c4c4", "badge-foreground": "#333333", "input-placeholderForeground": "#767676", "icon-foreground": "#3b3b3b", "testing-iconPassed": "#388a34",
    }),
}

INFO = {"found": True, "path": "brok", "version": "0.6.0"}
STATUS = {"version": "0.6.0", "initialized": True, "llm": {"provider": "ollama", "model": "qwen2.5-coder:14b"},
          "memory": {"enabled": True, "sessions": True, "global": False, "counts": {"private": 3, "shared": 1, "global": 0}},
          "links": [], "shards": [], "daemon": {"running": True}}
READY = {"kind": "ready", "info": INFO, "status": STATUS}
FRESH = {"kind": "not-initialized", "info": INFO}

STEPS = [
    {"id": "1", "label": "Attached context", "kind": "read", "status": "done", "startedAt": 0, "endedAt": 4, "resources": ["src/auth/session.ts"]},
    {"id": "2", "label": "Searching the index", "kind": "read", "status": "done", "startedAt": 4, "endedAt": 160, "resources": []},
    {"id": "3", "label": "Asking your model", "kind": "network", "status": "done", "startedAt": 160, "endedAt": 2400, "resources": []},
]
TURN = {
    "id": "t1", "kind": "ask", "done": True, "question": "Where is authentication handled?",
    "answer": "Authentication is handled in **`src/auth/session.ts`**: `createSession` signs the token and `requireSession` verifies it on every request.\n\n- The middleware is registered in `src/server.ts`.\n- Tokens expire after 15 minutes (`SESSION_TTL`).",
    "sources": [{"path": "src/auth/session.ts", "start_line": 12, "end_line": 48, "symbol": "createSession"},
                {"path": "src/server.ts", "start_line": 30, "end_line": 41}],
    "model": "ollama/qwen2.5-coder:14b", "context": ["src/auth/session.ts"], "steps": STEPS,
}
CHIPS = [{"id": "c1", "kind": "file", "label": "src/auth/session.ts", "persistent": False, "chars": 3200,
          "truncated": False, "redactions": 0, "external": False, "omitted": False}]

PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://%(dist)s/codicons/codicon.css"><link rel="stylesheet" href="file://%(dist)s/webview.css">
<style>body{%(vars)s}</style></head><body class="%(cls)s"><div id="root"></div>
<script>window.__BROKSPACE__={page:'workspace',l10n:{},language:'en'};
window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__posted.push(m),getState:()=>undefined,setState:()=>undefined});</script>
<script src="file://%(dist)s/webview.js"></script></body></html>"""


def send(page, *messages):
    for message in messages:
        page.evaluate("m => window.postMessage(m, '*')", message)
    page.wait_for_timeout(150)


CONFIG = {"llm": {"default": "ollama", "providers": {
    "ollama": {"base_url": "http://localhost:11434/v1", "model": "qwen2.5-coder:14b"},
    "lmstudio": {"base_url": "http://localhost:1234/v1", "model": "deepseek-coder-v2:16b"}}}}


def open_model_menu(page):
    page.click(".bk-pill")
    page.wait_for_timeout(100)
    call = [m for m in page.evaluate("window.__posted") if m.get("type") == "rpc" and m.get("method") == "config"][-1]
    send(page, {"type": "rpc", "id": call["id"], "result": CONFIG})


def shoot(browser, theme, width, name, state, messages, after=None, height=720):
    spec = THEMES[theme]
    css = ";".join(f"--vscode-{k}:{v}" for k, v in spec["vars"].items()) + ";--vscode-font-family:system-ui,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:monospace;--vscode-editor-font-size:12px"
    page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=2)
    html = PAGE % {"dist": str(DIST), "vars": css, "cls": spec["cls"]}
    path = pathlib.Path("/tmp") / f"brokspace-shot-{theme}.html"
    path.write_text(html)
    page.goto(f"file://{path}")
    page.wait_for_selector(".bk-workspace")
    send(page, {"type": "state", "state": state, "root": "/home/dev/shop"},
         {"type": "editor/state", "file": "src/auth/session.ts", "selection": False, "sendWith": "enter"},
         *messages)
    if after:
        after(page)
        page.wait_for_timeout(150)
    page.screenshot(path=str(OUT / f"{name}-{theme}.png"))
    page.close()


def main():
    if not (DIST / "webview.js").exists():
        sys.exit("run `npm run build` first")
    OUT.mkdir(parents=True, exist_ok=True)
    progress = {"version": 1, "acknowledged": False, "skipped": [], "firstAnswer": False, "dismissed": False}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in THEMES:
            shoot(browser, theme, 380, "first-run", FRESH,
                  [{"type": "onboarding/state", "progress": {**progress, "acknowledged": True}, "mcpEnabled": True},
                   {"type": "chat/state", "turns": []}])
            shoot(browser, theme, 380, "conversation", READY,
                  [{"type": "onboarding/state", "progress": {**progress, "firstAnswer": True}, "mcpEnabled": True},
                   {"type": "chat/state", "turns": [TURN]}, {"type": "context/state", "items": CHIPS, "limit": 40000}])
            shoot(browser, theme, 380, "navigation", READY,
                  [{"type": "onboarding/state", "progress": {**progress, "firstAnswer": True}, "mcpEnabled": True},
                   {"type": "chat/state", "turns": [TURN]}],
                  after=lambda page: page.click(".bk-tools"))
        ready_msgs = [{"type": "onboarding/state", "progress": {**progress, "firstAnswer": True}, "mcpEnabled": True},
                      {"type": "chat/state", "turns": [TURN]}, {"type": "context/state", "items": CHIPS, "limit": 40000}]
        for theme in THEMES:
            shoot(browser, theme, 380, "model-menu", READY, ready_msgs, after=open_model_menu)
            shoot(browser, theme, 380, "context-menu", READY, ready_msgs, after=lambda page: page.click(".bk-context-button"))
            no_llm = {**READY, "status": {**STATUS, "llm": {"provider": "none"}}}
            shoot(browser, theme, 380, "index-only", no_llm, ready_msgs)
        shoot(browser, "dark", 1000, "wide", READY, ready_msgs, height=760)
        shoot(browser, "dark", 260, "narrow", READY,
              [{"type": "onboarding/state", "progress": {**progress, "firstAnswer": True}, "mcpEnabled": True},
               {"type": "chat/state", "turns": [TURN]}], height=640)
        browser.close()
    print("saved to", OUT)


if __name__ == "__main__":
    main()
