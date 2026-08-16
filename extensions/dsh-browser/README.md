# dsh Browser Control Extension (Chrome MV3)

English | [中文](README.zh.md)

The **browser-operation end** of dsh: the model reads and operates the browser page you have open — extract content, click elements, fill forms, scroll, and navigate, all in the real page with your login state preserved. The side panel is the conversation entry.

**Text-only mode**: DeepSeek models cannot see images, so the page is rendered as structured text (a numbered interactive-element inventory) and the model addresses elements by number; the pipeline deliberately never produces images.

## What the model can do

| Capability | Action | Notes |
|---|---|---|
| Read page | `browser_snapshot` | Title/URL/main text/numbered inventory/form fields (sensitive values masked); `delta: true` returns only changes |
| Click element | `browser_click` | Click by inventory number (links/buttons/checkboxes…), React/Vue compatible |
| Fill forms | `browser_type` | Type text; `replace` clears first |
| Keys | `browser_press` | Enter/Tab/Escape/arrows etc. |
| Scroll | `browser_scroll` | Viewport scrolling (up/down/top/bottom) |
| Navigate | `browser_navigate` / `browser_back` / `browser_forward` / `browser_reload` | Navigation inside the controlled tab, login state preserved |
| Read region | `browser_get_text` | Lazy-loaded content / partial text |
| Wait | `browser_wait` | Page load and render-settle detection |

## Architecture

```
side panel (React) ◄─port─► background SW ◄─WS─► dsh bridge plugin
                                 │
                  tabs.sendMessage (DSH_ACTION)
                                 ▼
                        content script (snapshot/actions/privacy)
```

- **background** (`src/background/`): bridge connection (token auth + exponential-backoff reconnect + keepalive), gateway RPC client, and **fail-closed tool dispatch to a user-controlled tab**.
- **content script** (`src/content/`): text-only snapshot (readability main text + numbered interactive inventory + form fields), **stable element numbers** (`data-dsh-el`), delta changes, click/type/press/scroll/navigate actions, sensitive-field masking.
- **panel** (`src/panel/`): React conversation UI (resumable session/history/live events/settings); messages render as sanitized Markdown, `ask_user_question` requests render as answerable cards, manual tab switches render a control-handoff strip, and an active turn exposes a standard stop control.
- **Protocol**: `protocol.ts` in the `@deepseek-ai/dsh-bridge-browser` workspace package is the single source of truth, shared by both ends through the package's source export.

## Build

```sh
pnpm install
pnpm --filter dsh-browser-extension run build
pnpm --filter dsh-browser-extension run test
```

Run these commands from the repository root; the build outputs `extensions/dsh-browser/dist/`.

## Install and use

The recommended zero-configuration command does not require Git or a local clone:

1. **Build and install the extension**:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/Lum1104/dsh-browser/refs/heads/main/scripts/install.sh | bash
   ```

   The script downloads a managed workspace to `~/.dsh/dsh-browser`, builds the bridge plugin, registers its official bundle in the local dsh `web` profile, builds the extension, copies the output to the stable directory `~/.dsh/browser-extension`, and opens `chrome://extensions`. Enable Developer mode, choose Load unpacked, and select the extension directory. Running the command again updates the managed installation.

   A cloned checkout uses the same installer without downloading or overwriting source files:

   ```sh
   git clone https://github.com/Lum1104/dsh-browser.git
   cd dsh-browser
   ./scripts/install.sh
   ```

2. **Start dsh with the bridge plugin mounted**. Use either the workspace-pinned runtime:

   ```sh
   cd ~/.dsh/dsh-browser && pnpm start
   ```

   From a clone, run `pnpm start` in the repository root instead.

   Or the latest public runtime:

   ```sh
   npx @deepseek-ai/dsh web
   ```

   Both commands load the same bundle from the local `web` profile. Port 3080 is used by default; append `--port <port>` when it is occupied.

   Loading or reloading the extension before dsh starts is safe: local discovery waits for the bridge before opening a WebSocket, and opening the side panel triggers another discovery attempt.

3. **Use it**: open a normal `http://` or `https://` page and click the DeepSeek whale icon. The extension auto-discovers local dsh and loopback connections require no address or token; settings are only needed for remote deployment. Chat directly or click "Read page" first.

Pages that were already open before extension installation or reload are instrumented automatically on the first action, so they do not require a manual refresh. Browser-internal and protected pages such as `chrome://` and the Chrome Web Store cannot be read or operated.

For extension-only development, clone the repository, run `pnpm --filter dsh-browser-extension run build` from its root, and load `extensions/dsh-browser/dist/` directly. Rebuild and reload the extension from `chrome://extensions` after code changes.

## Why text-only

- **Snapshot as the view**: the model's entire view of the page is structured text (title/URL/main/numbered elements/forms), budgeted at 32k chars by default (plugin-configurable, negotiated to the extension via `hello.ok`).
- **Page text is untrusted input**: snapshots and targeted text reads are enclosed in a fresh nonce-bound trust marker and explicitly tell the model never to treat page-authored commands as instructions. This is defense in depth; extension-side action approval is the enforcement boundary.
- **Stable numbering**: element numbers persist across snapshots (WeakMap + `data-dsh-el`), so the model can say "click 7"; a large page change explicitly reports "numbers reindexed".
- **Delta mode**: `browser_snapshot({delta:true})` returns only changed element numbers, saving tokens.
- **Privacy**: password/credit-card values always render as `••••` and never leave the page; accessible names never use a sensitive field's current value.
- **Tab affinity**: prompt submission binds the active tab before the model starts working; a direct browser-tool call also performs the initial bind when needed. A manual tab/window switch pauses later tools and asks whether the assistant should stay on the original tab or follow the newly visible one. Staying permits explicit background operation without changing the user's visible tab; following resets page-reference state. A closed controlled tab fails closed until the user selects the current page, and a switch withdraws any open action approval.
- **Proportional approval**: the default `auto` mode lets the model read the controlled tab without an extra prompt; `ask` restores per-read confirmation and `off` blocks reads. In `ask` mode, the read dialog can allow one read or persistently switch back to `auto`, which remains reversible in Settings. State-changing tools still fail closed and show their exact origin plus a redacted action summary. The user may deny, allow once, or trust one origin for the current side-panel session; temporary trust clears when the last panel closes or the service worker restarts. Permanent trust is managed explicitly in Settings. If the panel is closed, an approval remains pending for up to 60 seconds and, when enabled, a system notification opens the panel for review. The panel restores the requesting session before showing a session-scoped approval. Caller cancellation or bridge timeout withdraws any open approval before an action can run.
- **Conversation continuity**: reopening the panel resumes the most recently active browser conversation by default, falling back to the latest non-empty durable session before creating a new one. This can be disabled in Settings.

## Permissions

`sidePanel` (sidebar), `storage` (settings and recent-session continuity), `notifications` (optional reminders for approvals received while the panel is closed), `tabs` + `activeTab` + `scripting` (observe tab changes and inject/message the explicitly controlled tab, including lazy recovery for pages opened before install), `webNavigation` (enumerate and bind messages to that tab's frame documents), `alarms` (SW keepalive), and `http/https` (content-script injection on normal pages). The extension never changes the visible tab or silently follows a manual switch; background operation happens only after the user chooses to stay on the original tab.

## Known limitations

- Only one extension connection at a time (a second window replaces the first).
- Tab affinity is global to that extension connection rather than per chat session.
- Accessible cross-origin iframes are snapshotted and operated with stable `(frame, index)` addresses. Restricted or short-lived frames are reported as unavailable without failing the whole page snapshot.
- Captcha/image-only controls cannot be handled — the tool result reports "elements with no accessible name" and asks the user to complete that step manually.
- No automatic token rotation.
- Synthetic `browser_press` events do not trigger browser-native default actions such as Tab focus movement, arrow-key scrolling, or Enter activation; use manual input when a workflow depends on those defaults.
- `browser_wait` considers page load plus a fixed quiet window, but does not observe continuously changing DOM state; a live-updating SPA may be reported as stable.
