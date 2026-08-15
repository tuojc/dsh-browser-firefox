# @deepseek-ai/dsh-bridge-browser

English | [中文](README.zh.md)

The **browser-operation bridge** for dsh: mounts a token-authenticated WebSocket carrier (`/ext/bridge`) that the Chrome extension connects to, proxies gateway RPCs through the same fetch handler the `/api` surface uses, pumps session events per connection, and registers the text-only `browser_*` tool set that reads and operates the user's active tab through the extension — click elements, fill forms, scroll, and navigate in the real browser, login state preserved. The side panel is the conversation entry; the tools are the product.

**Text-only by design**: DeepSeek models have no vision, so page snapshots are structured text (title, main content, numbered interactive inventory, form fields with masked sensitive values) and every action addresses elements by stable inventory numbers. No screenshots exist anywhere in the pipeline.

## Config

| Key | Type | Default | Description |
|---|---|---|---|
| `token` | `string` | generated | Fixed bearer token. When absent, a token is generated on first boot, persisted at `~/.dsh/ext-bridge-token` (chmod 0600), and printed in the boot log. |
| `toolTimeoutMs` | `number` | 60000 | Per-tool-call budget. |
| `snapshotMaxChars` | `number` | 12000 | Upper bound on one rendered snapshot's characters (also negotiated to the extension via `hello.ok` caps). |
| `maxInteractiveItems` | `number` | 60 | Upper bound on interactive inventory items per snapshot. |
| `sessionWorkspacePath` | `string` | `~/.dsh/browser-sessions` | Dedicated Host Workspace for extension-created sessions. The plugin creates and idempotently registers the directory on the first implicit `session.create`; the session cwd becomes this path, so the GUI shows a `browser-sessions` workspace group. Set `""` to keep sessions Ungrouped. |
| `deferSessionCreate` | `boolean` | `true` | Sessions materialize only on the first message: `session.create` answers with a provisional id (nothing persisted), history reads empty, and the first `session.prompt` creates the real session (same id, original payload). Opening the panel without chatting leaves zero trace in the session store/GUI. |

Workspace grouping is best-effort. If the composition has no workspace domain, directory creation fails, or `workspace.create` rejects the path, the plugin logs one warning and sends every session creation without an injected workspace so browser chat remains usable.

## Usage

The remote installer downloads an installer-managed workspace, builds the plugin, and registers its official bundle in the local dsh `web` profile. It requires neither Git nor a local clone:

```sh
curl -fsSL https://raw.githubusercontent.com/Lum1104/dsh-browser/refs/heads/main/scripts/install.sh | bash
cd ~/.dsh/dsh-browser && pnpm start
```

Developers can instead clone the repository and run `./scripts/install.sh` followed by `pnpm start` from that checkout. The local mode uses the current branch without downloading or overwriting source files. Both installation modes register the same profile bundle; build tools resolve only from the selected workspace and never from a parent checkout or parent `node_modules` directory.

The latest public runtime also loads the registered bundle:

```sh
npx @deepseek-ai/dsh web
```

The installer copies the unpacked extension to `~/.dsh/browser-extension` and opens `chrome://extensions`. Load that stable directory in Chrome and use the side panel. Loopback connections are discovered automatically and require no token entry; non-loopback deployments still require the configured bearer token.

## Security model

- The bridge route lives **outside** the `/api` trust fence (which only guards client-connection's routes), so it carries its own bearer-token authentication: the first frame must be `hello` with the token within 5s, verified in constant time. Failed auth closes the socket.
- Gateway methods the `/api` carrier pins to loopback (`settings.*`, `credentials.*`, `host.pickDirectory`, `host.openPath`) are refused for non-loopback remotes **even with a valid token** — defense in depth for `--host 0.0.0.0` deployments.
- One active connection at a time; a new authenticated socket replaces the previous one.
- The bridge is a confused-deputy boundary, not a general auth layer: never expose `dsh web --host 0.0.0.0` on untrusted networks.
- Extracted page text is marked as untrusted model input. Page reads honor the extension's ask/auto/off policy, while state-changing tools require an origin-scoped side-panel decision and fail closed without a panel. Same-origin repetition can be trusted for the current panel session; permanent trust remains an explicit setting.

## Wire protocol

Frames are JSON objects discriminated by `t`, defined in [`protocol.ts`](src/protocol.ts) — the single source of truth shared with the extension through the workspace package's `./src/*` export. The built package also publishes `@deepseek-ai/dsh-bridge-browser/protocol` for external consumers.

- Client → server: `hello` (auth + caps), `rpc` (gateway method passthrough), `tool.result`, `pong`.
- Server → client: `hello.ok` (echoes negotiated caps), `rpc.result`, `event` (gateway event envelope, same shape as `/api/events.mux`), `tool.call`, `ping`, `error`.

## Tools

| Tool | Purpose |
|---|---|
| `browser_snapshot` | Structured text snapshot (title/URL/main/inventory/forms); `delta: true` returns only changes. |
| `browser_click` / `browser_type` / `browser_press` | Operate inventory items by stable index. |
| `browser_scroll` / `browser_navigate` / `browser_back` / `browser_forward` / `browser_reload` | Page movement. |
| `browser_get_text` / `browser_wait` | Read regions / settle detection. |

## Model Experience

- **Token effect**: one `browser_snapshot` (default 12k chars) costs roughly 3–4k tokens; delta snapshots cost a fraction of that. The system-prompt section tells the model to snapshot on demand rather than hoard page text.
- **KV-cache effect**: none beyond ordinary tool results; snapshots are not cached server-side.
- **Latency**: each action awaits the extension's real-page execution plus settle detection (typically 0.2–2s; navigation up to 5s).
- **Failure modes**: `bridge-closed` (extension not connected), `timeout`, `no-active-tab`, `content-unavailable` (page needs a refresh), `action-failed` (stale inventory index — the model should re-snapshot).

## Extension points

- The tool set is the consumer surface; the seam is the bridge wire (`protocol.ts`). Add tools by registering on `ctx.tools` and dispatching over the bridge; the extension's content script dispatches by action name.
- Negotiated caps (`hello.ok`) let the plugin dictate snapshot budgets to the extension without a shared config file.

## Known Limitations and Deferred Work

- One active extension connection (a second window replaces the first).
- Accessible cross-origin iframes are snapshotted and operated with stable `(frame, index)` addresses. Restricted or short-lived frames are reported as unavailable without failing the whole page snapshot.
- Token rotation is manual (edit `~/.dsh/ext-bridge-token` or set `token` in config); no expiry.
- The Playwright-driven extension e2e self-skips without a usable Chromium executable or a built extension bundle.
- Approval is enforced in the extension service worker rather than delegated to model behavior. A future dsh tool-pipeline integration may surface the same policy in other clients.
