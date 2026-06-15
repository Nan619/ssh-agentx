# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SSH AgentX is a **Tauri 2 desktop app** — Rust backend + React/TypeScript frontend — providing a multi-tab SSH terminal client with an integrated AI operations assistant (LLM chat panel).

## Commands

```bash
# Development (starts Vite dev server on :1420 + Tauri native window)
npm run dev

# Build production binary
npm run build          # TypeScript check + Vite bundling
npm run tauri build    # Full Tauri build → installable binary

# Tauri CLI passthrough
npm run tauri <args>
```

**Prerequisites on Windows:** Run `source build-env.sh` first to set Rust toolchain, MSVC, and Windows SDK paths.

There are no unit tests configured in this project.

## Architecture

### Three-Panel Layout

`App.tsx` composes a VSCode-style layout:
- **Activity Bar** (far left) — icon buttons toggling sidebar views
- **Sidebar** — SSH host list, resizable via drag handle
- **Editor Area** (center) — one xterm.js terminal per SSH session tab
- **Agent Panel** (right) — LLM chat, resizable; collapsible

### Frontend → Backend IPC

All backend calls go through Tauri's `invoke()`. Command handlers live in `src-tauri/src/commands/`:

| Module | Key commands |
|---|---|
| `ssh.rs` | `ssh_connect`, `ssh_disconnect`, `terminal_input`, `terminal_resize`, `agent_exec`, `get_terminal_output`, `ssh_host_key_respond/cancel`, `ssh_passphrase_respond/cancel`, `ssh_auth_respond/cancel` |
| `host.rs` | `list_hosts`, `create_host`, `update_host`, `delete_host` |
| `config.rs` | `list_model_configs`, `save_model_config`, `delete_model_config`, `set_active_model`, `get_active_model` |
| `agent.rs` | `agent_chat`, `configure_provider` |

Terminal output is pushed to the frontend via Tauri events (not return values), streamed in real-time from the Rust PTY reader.

### SSH Session Lifecycle

1. `ssh_connect` → `russh` handshake + PTY allocation → session stored in `AppState.sessions` (`src-tauri/src/state.rs`)
2. Frontend xterm.js keystroke → `terminal_input` invoke → write to PTY channel
3. PTY output reader loop → emit `terminal:output` Tauri event → xterm.js `.write()`
4. `ssh_disconnect` → channel close + remove from `AppState.sessions`

`AppState` is held in Tauri's managed state, containing:
- `sessions` — active PTY sessions (`HashMap<String, SshSessionHandle>`)
- `auth_waiters`, `passphrase_waiters`, `host_key_waiters` — oneshot channels for interactive authentication prompts
- `passphrase_cache` — in-memory passphrase cache (zeroized on drop)

Each `SshSession` has three channels:
- `write_tx` — user keystrokes and injected agent commands into the PTY
- `resize_tx` — terminal window-size changes
- `output_tx` — also accepts **synthetic** output (agent headers/footers printed in yellow) that bypasses the PTY entirely

A rolling **8 KiB ring buffer** (`output_buffer`) captures recent terminal output for AI context; `get_terminal_output` exposes it to the frontend.

After connect, system info (`uname`, `hostname`, `uptime`, `df`, `free`) is collected in a background task (up to 5 s) via a separate exec channel and stored in `session.system_info`. This is injected into every `agent_chat` system prompt.

### Interactive Authentication

SSH connections may require interactive prompts handled via the frontend:

- **Host key verification** — TOFU (trust-on-first-use) prompt when connecting to unknown hosts
- **Passphrase prompts** — for encrypted private keys
- **kbd-interactive auth** — multi-prompt authentication (e.g., PAM, OTP)

Each prompt type uses a oneshot channel in `AppState` (`auth_waiters`, `passphrase_waiters`, `host_key_waiters`). The frontend shows a dialog and calls the corresponding `*_respond` or `*_cancel` command to resolve the channel.

### `agent_exec` — Sentinel Injection Mechanism

`agent_exec` does **not** open a separate exec channel. It injects a sentinel-wrapped command into the shared PTY shell:

```
Ctrl+U   (clears partial readline input)
_s="__AGENT_ST""ART_<uuid>__"; _e="__AGENT_EN""D_<uuid>_";
printf "${_s}\n"; <command>; __ret=$?; printf "${_e}${__ret}__\n"
```

The forwarding task running in `ssh_connect` feeds PTY output through `AgentCapture.on_data_chunk()` which scans for the sentinels and resolves a `oneshot` channel when the END sentinel is found (30 s timeout). The stdout and exit code are returned to the AI.

### AI Agent

- **System prompt** defined in `src-tauri/src/agent/context.rs` — written in Chinese; establishes ops assistant persona. At chat time, `agent_chat` appends host context, live system info, and up to 4 KiB of recent terminal output.
- **Provider abstraction** in `src-tauri/src/agent/provider.rs` — `AiProvider` trait with SSE streaming. Supported provider types: `openai`, `anthropic`, `ollama` (routed via OpenAI-compat `/v1`), `custom`/`deepseek` (OpenAI-compat with custom base URL).
- **`agent_chat`** streams chunks via `agent:chunk` Tauri events; `agent:error` on failure. The frontend accumulates chunks in a `ref` and commits to the store only on `finish_reason: "stop"`.

Active provider is configured via `configure_provider` (in-memory only) and persisted to SQLite by the frontend through `save_model_config` + `set_active_model`.

### Error Handling

Backend errors use `AppError` (`src-tauri/src/error.rs`) with i18n-ready coded messages:
- Each error variant wraps a `CodedMsg` with a `code` (translation key) and `params` (JSON object for placeholder substitution)
- `Display` format: `__rssh_err__|{"code":"...","params":{...}}` — parsed by frontend for localized error messages
- Use `AppError::ssh()`, `AppError::not_found()`, `AppError::config()`, `AppError::other()` constructors

### State Management

**Frontend (Zustand):**
- `terminalStore` — session list, active terminal ID, per-session output buffer
- `hostStore` — SSH host configs (mirrors DB, fetched on mount)
- `agentStore` — chat message history, streaming state

**Backend (Tauri managed state):**
- `AppState` — wraps sessions, interactive auth waiters, passphrase cache
- `SharedAgentState` (`Mutex<AgentStateInner>`) — current LLM provider instance + `ChatOptions`

### Persistence

SQLite at `{appDataDir}/ssh-agent.db`, initialized in `src-tauri/src/db/mod.rs`.

**`hosts`** — SSH connection profiles (hostname, port, auth method, optional password/key path)  
**`model_configs`** — LLM provider configs (provider name, model, API key, base URL, active flag)

Credentials stored in plaintext in SQLite (no OS keyring in current implementation despite the `keyring` crate being referenced in earlier commits).

## Key Files

| Path | Purpose |
|---|---|
| `src/App.tsx` | Root layout composition |
| `src/components/terminal/TerminalView.tsx` | xterm.js integration + IPC wiring |
| `src/components/agent/AgentPanel.tsx` | AI chat UI + streaming render + `agent_exec` trigger |
| `src-tauri/src/lib.rs` | Tauri app setup, state registration, command registration |
| `src-tauri/src/state.rs` | `AppState` — sessions + interactive auth waiters |
| `src-tauri/src/ssh/session.rs` | `SessionManager`, `SshSession`, `AgentCapture` sentinel logic |
| `src-tauri/src/ssh/client.rs` | `russh` connection + `channel_driver` PTY loop |
| `src-tauri/src/commands/ssh.rs` | `ssh_connect` (spawns forwarding task), `agent_exec`, interactive auth handlers |
| `src-tauri/src/agent/context.rs` | `OPS_AGENT_PROMPT` + `HostContext` system prompt builder |
| `src-tauri/src/agent/provider.rs` | `AiProvider` trait + `OpenAiProvider`/`AnthropicProvider` impls |
| `src-tauri/src/commands/agent.rs` | `agent_chat` (builds full prompt, streams response) |
| `src-tauri/src/db/mod.rs` | SQLite schema + CRUD helpers |
| `src-tauri/src/error.rs` | `AppError` + `CodedMsg` i18n error system |
| `build-env.sh` | Windows build environment (Rust/MSVC/SDK) |
