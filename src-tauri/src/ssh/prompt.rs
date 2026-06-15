// src-tauri/src/ssh/prompt.rs
//! 终端内 oneshot 交互：passphrase / host_key prompt。

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::json;
use tokio::sync::oneshot;

use crate::error::{locked, AppError, AppResult};

#[derive(Clone)]
pub struct AuthCtx {
    pub app: crate::emitter::Host,
    /// xterm tab 的 session_id，用于 emit 事件名和 waiters map key
    pub tab_id: String,
}

struct WaiterGuard<'a> {
    waiters: &'a Mutex<HashMap<String, oneshot::Sender<String>>>,
    tab_id: &'a str,
}

impl Drop for WaiterGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut m) = locked(self.waiters) {
            m.remove(self.tab_id);
        }
    }
}

/// 通用终端 oneshot prompt：注册 sender → emit 事件 → 等用户回应。
pub(crate) async fn prompt_oneshot(
    waiters: &Mutex<HashMap<String, oneshot::Sender<String>>>,
    app: &crate::emitter::Host,
    tab_id: &str,
    event_prefix: &str,
    payload: serde_json::Value,
    cancel_code: &'static str,
) -> AppResult<String> {
    let (tx, rx) = oneshot::channel::<String>();
    {
        let mut w = locked(waiters)?;
        if w.contains_key(tab_id) {
            return Err(AppError::other(
                "ssh_prompt_already_pending",
                json!({ "tab_id": tab_id, "channel": event_prefix }),
            ));
        }
        w.insert(tab_id.to_string(), tx);
    }
    let _guard = WaiterGuard { waiters, tab_id };
    app.emit(&format!("{event_prefix}:{tab_id}"), payload)
        .map_err(|e| {
            AppError::other(
                "emit_failed",
                json!({ "channel": event_prefix, "err": e.to_string() }),
            )
        })?;
    rx.await.map_err(|_| AppError::ssh(cancel_code, json!({})))
}

/// 向终端 tab 弹 passphrase 提示，等用户输完回车。
pub(crate) async fn prompt_passphrase(ctx: &AuthCtx, prompt: &str) -> AppResult<String> {
    use tauri::Manager as _;
    match &ctx.app {
        crate::emitter::Host::Tauri(app) => {
            let state = app.state::<crate::state::AppState>();
            prompt_oneshot(
                &state.passphrase_waiters,
                &ctx.app,
                &ctx.tab_id,
                "ssh:passphrase_prompt",
                json!({ "prompt": prompt }),
                "ssh_user_cancelled_passphrase",
            )
            .await
        }
    }
}

/// 向终端 tab 弹主机密钥确认。
/// `is_mismatch=true` 表示密钥变更场景，前端显示警告并要求用户确认替换；
/// `is_mismatch=false` 表示 TOFU（首次连接）场景。
pub(crate) async fn prompt_host_key(ctx: &AuthCtx, banner: &str, is_mismatch: bool) -> AppResult<String> {
    use tauri::Manager as _;
    match &ctx.app {
        crate::emitter::Host::Tauri(app) => {
            let state = app.state::<crate::state::AppState>();
            prompt_oneshot(
                &state.host_key_waiters,
                &ctx.app,
                &ctx.tab_id,
                "ssh:host_key_prompt",
                json!({ "banner": banner, "is_mismatch": is_mismatch }),
                "ssh_user_cancelled_hostkey",
            )
            .await
        }
    }
}
