# dsh Browser Control Plugin (dsh-browser)

**English** | [中文](README.md)

<img width="1687" height="879" alt="2026-08-06_17-10-14" src="https://github.com/user-attachments/assets/39e2f960-4002-4e5b-b02d-b015e348980c" />

Let dsh models **read and operate pages open in your own browser**: extract content, click elements, fill forms, scroll, and navigate while preserving the page's login state, session, and cookies. The side panel provides the conversation UI.

The integration is text-only: DeepSeek models receive a structured text representation with a numbered interactive-element inventory. The entire model-facing pipeline operates without screenshots.

This repository is a standalone pnpm workspace: the root package installs a pinned internal-testing release of `@deepseek-ai/dsh` from private npm, the bridge plugin declares peer and development dependencies on the same release line, and the Chrome extension shares the bridge protocol through a workspace dependency. No DeepSeek Harness source checkout is required.

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
extensions/dsh-browser/
examples/browser-bridge.cordis.yml
scripts/install.sh
```

## Why this design

- **Operate the real browser, not a headless copy**: the model works in the page the user already has open, retaining logins, sessions, and cookies.
- **Text-first model interface**: numbered controls, stable IDs across snapshots, delta updates, and masked sensitive values make pages usable without vision.
- **Privacy boundary**: passwords and payment-card values are always rendered as `••••` and never leave the page.
- **Security boundary**: the bridge uses token-authenticated handshakes; privileged gateway methods reject non-loopback callers; the extension only operates the active tab.

## Zero-configuration install and use

Prerequisites: Node.js `^22.19` or `>=24`, Corepack/pnpm, and npm credentials that can read private `@deepseek-ai` packages. pnpm 11 does not read project-level authentication fields; reference the environment variable from the user-level `~/.npmrc`, and never write the real token into the repository:

```ini
@deepseek-ai:registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

**Step 1 — install dependencies and the extension**:

```sh
./scripts/install.sh
```

The script installs private npm dependencies from the lockfile, builds the bridge plugin, links the local plugin into dsh's `web` profile, builds the extension, copies it to `~/.dsh/browser-extension`, and opens `chrome://extensions`. Enable Developer mode and load that directory when prompted.

**Step 2 — start dsh** from this repository root:

```sh
pnpm start
```

Port 3080 is used by default. Run `pnpm start -- --port <port>` if it is occupied. When the DeepSeek whale icon appears in the toolbar, click it to open the side panel.

**For subsequent use**, the extension does not need to be installed again. Start dsh from this repository root with:

```sh
pnpm start
```

**No configuration is required for local use**: the extension discovers dsh through `/ext/bridge-config`, and loopback connections do not require a token. An address and token are only needed for remote deployment with `--host 0.0.0.0`.

**Step 3 — use it**: open any normal `http://` or `https://` page and click the DeepSeek whale icon. When the side panel reports "Connected", chat normally or click "Read page" first. A page that was already open before the extension was installed or reloaded is instrumented automatically on the first action; no page refresh is needed. Browser-internal and protected pages such as `chrome://` and the Chrome Web Store cannot be read or operated.

After updating the code, run `./scripts/install.sh` again, click Reload for "dsh Browser Assistant" in `chrome://extensions`, and reopen the side panel. Chrome should load `~/.dsh/browser-extension`; do not load the source directory `extensions/dsh-browser/`.

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
- The SDK dependencies of `@deepseek-ai/dsh` and the bridge plugin are pinned to the same internal-testing release line. An upgrade must update the manifests and lockfile together and rerun the root checks.

## Security

- The bridge path sits outside the `/api` trust boundary and performs its own bearer-token authentication.
- Privileged gateway methods such as `settings.*`, `credentials.*`, and `host.open*` reject non-loopback sources.
- The model-facing pipeline is text-only; passwords and payment-card values never leave the page.
- Only the active tab is operated; the extension never switches tabs silently.
