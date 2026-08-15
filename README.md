# dsh Browser Control

**English** | [中文](README.zh.md)

<img width="1701" height="897" alt="dsh Browser Control" src="https://github.com/user-attachments/assets/3b1f3a25-f962-4e02-a9ef-d23e0d01fc8e" />

Connect [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) to the Chrome tab you are already using. The model can read page content, click controls, fill forms, scroll, and navigate while preserving your login state, session, and cookies. A side panel provides the conversation UI.

`dsh` is DeepSeek AI's open-source, plugin-based agent harness. This repository provides a companion browser bridge plugin and Chrome MV3 extension as one standalone pnpm workspace.

The integration is text-only: pages become structured text with a numbered inventory of interactive elements, and the model addresses those elements by number. Screenshots never enter the model-facing pipeline.

The workspace uses a pinned, publicly available `@deepseek-ai/dsh` release for reproducible installation. It requires neither a DeepSeek Harness source checkout, dependencies from a parent directory, nor npm credentials. DeepSeek Harness is currently a developer preview, so upgrades may require coordinated dependency and API updates.

## Core capabilities

| Capability | Tool | Notes |
|---|---|---|
| Read page | `browser_snapshot` | Structured text snapshot: title, URL, main text, numbered controls, and masked form fields; `delta: true` returns only changes |
| Click element | `browser_click` | Click links, buttons, checkboxes, and other controls by inventory number |
| Fill forms | `browser_type` | React/Vue-compatible input; `replace` clears the field first |
| Press keys | `browser_press` | Keyboard events such as Enter, Tab, Escape, and arrow keys |
| Scroll | `browser_scroll` | Viewport scrolling: up, down, top, and bottom |
| Navigate | `browser_navigate` / `browser_back` / `browser_forward` / `browser_reload` | In-tab navigation with login state preserved |
| Read region | `browser_get_text` | Lazy-loaded or partial page text |
| Wait for stability | `browser_wait` | Page-load and render-settle detection |

## Repository layout

```
packages/browser/bridge-browser/
  cordis.patch.yml
extensions/dsh-browser/
scripts/install.sh
```

## Why this design

- **Your real browser, not a headless copy**: the model works in the page you already have open, retaining logins, sessions, and cookies.
- **A text-first model interface**: numbered controls, stable IDs across snapshots, delta updates, and masked sensitive values make pages operable without vision.
- **A narrow privacy boundary**: passwords and payment-card values are always rendered as `••••` and never leave the page.
- **A guarded bridge**: authenticated handshakes protect remote connections, privileged gateway methods reject non-loopback callers, and the extension only operates the active tab.

## Zero-configuration install and use

Prerequisites: Node.js `^22.19` or `>=24`, Corepack/pnpm, and Google Chrome. All required `@deepseek-ai` packages are available from the public npm registry; installation does not require an npm token.

**Step 1 — install the bridge and extension**. The recommended command does not require Git or a local clone:

```sh
curl -fsSL https://raw.githubusercontent.com/Lum1104/dsh-browser/refs/heads/main/scripts/install.sh | bash
```

The remote installer downloads `main` into the installer-managed directory `~/.dsh/dsh-browser`, then installs the pinned public npm dependencies from the lockfile, builds the bridge plugin, registers its official bundle in dsh's local `web` profile, builds the extension, copies it to `~/.dsh/browser-extension`, and opens `chrome://extensions`. Enable Developer mode and load the extension directory when prompted. Running the same command again updates the managed installation; keep source edits in a clone instead.

**Already running dsh? Restart it after installing.** The installer registers the bridge bundle in dsh's local `web` profile, and dsh loads its profile only at startup. An instance started before the install keeps running without the bridge, so the side panel reports "Not connected" even though the extension loaded correctly. Stop that instance and start it again (Step 2); the extension then discovers the bridge automatically and needs no reconfiguration.

Developers can clone the repository and run the same installer from any checkout. This mode uses the current branch without downloading or overwriting source files:

```sh
git clone https://github.com/Lum1104/dsh-browser.git
cd dsh-browser
./scripts/install.sh
```

**Step 2 — start dsh**. For a managed installation, use its pinned version:

```sh
cd ~/.dsh/dsh-browser && pnpm start
```

From a clone, run `pnpm start` in the repository root instead.

Or run the latest public release directly from npm:

```sh
npx @deepseek-ai/dsh web
```

Both commands load the same browser bundle from the local `web` profile. Port 3080 is used by default; if it is occupied, run `pnpm start -- --port <port>` or `npx @deepseek-ai/dsh web --port <port>`. When the DeepSeek whale icon appears in the toolbar, click it to open the side panel.

**For subsequent use**, the extension does not need to be installed again. Run either startup command above.

**No configuration is required for local use**: the extension discovers dsh through `/ext/bridge-config`, and loopback connections do not require a bridge token. This runtime security token is unrelated to npm authentication; an address and bridge token are only needed for remote deployment with `--host 0.0.0.0`.

**Step 3 — use it**: open any normal `http://` or `https://` page and click the DeepSeek whale icon. When the side panel reports "Connected", chat normally or click "Read page" first. A page that was already open before the extension was installed or reloaded is instrumented automatically on the first action; no page refresh is needed. Browser-internal and protected pages such as `chrome://` and the Chrome Web Store cannot be read or operated.

To update a managed installation, run the same `curl | bash` command again. To update a clone, pull or switch to the desired revision and run `./scripts/install.sh`. Then click Reload for "dsh Browser Assistant" in `chrome://extensions` and reopen the side panel. Chrome should load `~/.dsh/browser-extension`; do not load the source directory `extensions/dsh-browser/`. If dsh web is already running, restart it too so it reloads the updated `web` profile (see Troubleshooting).

## Troubleshooting

**Side panel stays "Not connected"**

- Make sure dsh web is running locally (default `http://127.0.0.1:3080`).
- Verify the bridge is loaded: open `http://127.0.0.1:3080/ext/bridge-config`. It should return JSON such as `{"wsUrl":"ws://127.0.0.1:3080/ext/bridge"}`. If it returns a web page instead of JSON, the running dsh predates the bridge registration — restart dsh and refresh the page; the extension reconnects on its own.
- The extension probes ports 3080, 3081, and 3090 automatically. If dsh runs on another port — or you use a remote `--host 0.0.0.0` deployment — set the address (and bridge token) in the side panel settings.

## Development

The bridge plugin and Chrome extension are both members of this repository's workspace. Run all commands from the repository root. For the first development installation, run `pnpm install`.

```sh
pnpm run build
pnpm run typecheck
pnpm run test

pnpm --filter @deepseek-ai/dsh-bridge-browser run build
pnpm --filter @deepseek-ai/dsh-bridge-browser run typecheck
pnpm --filter @deepseek-ai/dsh-bridge-browser run test

pnpm --filter dsh-browser-extension run build
pnpm --filter dsh-browser-extension run test
```

Notes:

- The bridge plugin must have a built `lib/` before startup because the loader consumes it; both `scripts/install.sh` and the root `pnpm run build` build the plugin before the extension.
- The dependencies of `@deepseek-ai/dsh` and the bridge plugin are pinned to the same tested public release line. An upgrade must update the manifests and lockfile together and rerun the root checks.

## Security

- The bridge path sits outside the `/api` trust boundary and performs its own bearer-token authentication.
- Privileged gateway methods such as `settings.*`, `credentials.*`, and `host.open*` reject non-loopback sources.
- The model-facing pipeline is text-only; passwords and payment-card values never leave the page.
- Only the active tab is operated; the extension never switches tabs silently.
- Page-authored text is wrapped as untrusted input. The default `auto` mode reads only the active tab without an extra prompt; privacy-sensitive users can select `ask` for per-read confirmation or `off` to block reads entirely. In `ask` mode, the read dialog can allow one read or persistently switch back to `auto`; this can be reversed in Settings. Read page text is sent to the selected model.
- Click, type, keypress, navigation, history, and reload calls fail closed until the user approves them. An origin may be trusted for the current side-panel session (cleared when the last panel closes or the service worker restarts), while permanent trust is managed explicitly in Settings. Explicit cross-origin `browser_navigate` calls and unknown history destinations always prompt again.
