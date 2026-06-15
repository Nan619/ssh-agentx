// src-tauri/src/ssh/auth.rs
//! 认证路径：password / key（文件路径）/ agent / kbd-interactive / none。

use std::path::PathBuf;
use std::sync::Arc;

use russh::client;
use russh::keys::{Algorithm, HashAlg, PrivateKey, PrivateKeyWithHashAlg};
use serde_json::json;

use crate::error::{locked, AppError, AppResult};
use super::client::SshHandler;
use super::prompt::{prompt_passphrase, AuthCtx};

const MAX_PASSPHRASE_RETRIES: usize = 3;

fn check_auth_result(result: client::AuthResult) -> AppResult<()> {
    if result.success() {
        Ok(())
    } else {
        Err(AppError::ssh("ssh_auth_rejected", json!({})))
    }
}

/// 解析私钥文件（文件路径方式，保留现有行为）。
/// 遇加密私钥时通过 ctx 向终端索取 passphrase（最多 3 次）。
pub async fn decode_key_from_path(
    key_path: &str,
    cache_key: &str,
    ctx: Option<&AuthCtx>,
) -> AppResult<PrivateKey> {
    // 先尝试无 passphrase 加载
    match russh::keys::load_secret_key(key_path, None) {
        Ok(k) => return Ok(k),
        Err(russh::keys::Error::KeyIsEncrypted) => {}
        Err(e) => {
            return Err(AppError::ssh(
                "ssh_privkey_load_failed",
                json!({ "err": e.to_string() }),
            ))
        }
    }

    // 检查 passphrase 缓存
    if let Some(ctx) = ctx {
        use tauri::Manager as _;
        let cached: Option<zeroize::Zeroizing<String>> = match &ctx.app {
            crate::emitter::Host::Tauri(app) => {
                let state = app.state::<crate::state::AppState>();
                let guard = locked(&state.passphrase_cache).ok();
                guard.and_then(|m| m.get(cache_key).cloned())
            }
        };
        if let Some(pw) = cached {
            match russh::keys::load_secret_key(key_path, Some(pw.as_str())) {
                Ok(k) => return Ok(k),
                Err(russh::keys::Error::KeyIsEncrypted) => {
                    // 缓存失效，清除
                    let crate::emitter::Host::Tauri(app) = &ctx.app;
                    let state = app.state::<crate::state::AppState>();
                    if let Ok(mut m) = locked(&state.passphrase_cache) {
                        m.remove(cache_key);
                    }
                    drop(state);
                }
                Err(e) => {
                    return Err(AppError::ssh(
                        "ssh_privkey_load_failed",
                        json!({ "err": e.to_string() }),
                    ))
                }
            }
        }
    }

    // 需要交互
    let ctx = ctx.ok_or_else(|| AppError::ssh("ssh_privkey_encrypted_no_ctx", json!({})))?;
    let prompt_label = format!("Enter passphrase for key '{key_path}': ");

    for attempt in 0..MAX_PASSPHRASE_RETRIES {
        let pw = prompt_passphrase(ctx, &prompt_label).await?;
        match russh::keys::load_secret_key(key_path, Some(&pw)) {
            Ok(k) => {
                // 存入缓存
                let crate::emitter::Host::Tauri(app) = &ctx.app;
                use tauri::Manager as _;
                let state = app.state::<crate::state::AppState>();
                if let Ok(mut m) = locked(&state.passphrase_cache) {
                    m.insert(cache_key.to_string(), zeroize::Zeroizing::new(pw));
                }
                drop(state);
                return Ok(k);
            }
            Err(russh::keys::Error::KeyIsEncrypted) => {
                let remaining = MAX_PASSPHRASE_RETRIES - attempt - 1;
                let msg = if remaining > 0 {
                    format!("\x1b[31mIncorrect passphrase, {remaining} attempt(s) left.\x1b[0m\r\n")
                } else {
                    "\x1b[31mIncorrect passphrase.\x1b[0m\r\n".to_string()
                };
                let _ = ctx.app.emit(&format!("ssh:data:{}", ctx.tab_id), msg.into_bytes());
            }
            Err(e) => {
                return Err(AppError::ssh(
                    "ssh_privkey_load_failed",
                    json!({ "err": e.to_string() }),
                ))
            }
        }
    }
    Err(AppError::ssh("ssh_passphrase_too_many", json!({})))
}

/// 从 PEM 字符串（内存）解析私钥，passphrase 逻辑与 from_path 相同。
pub async fn decode_key_from_data(
    pem: &str,
    stored_passphrase: Option<&str>,
    cache_key: &str,
    ctx: Option<&AuthCtx>,
) -> AppResult<PrivateKey> {
    use russh::keys::decode_secret_key;

    // 先尝试无 passphrase
    match decode_secret_key(pem, None) {
        Ok(k) => return Ok(k),
        Err(russh::keys::Error::KeyIsEncrypted) => {}
        Err(e) => {
            return Err(AppError::ssh(
                "ssh_privkey_load_failed",
                json!({ "err": e.to_string() }),
            ))
        }
    }

    // 尝试 DB 中存储的 passphrase
    if let Some(pw) = stored_passphrase {
        if !pw.is_empty() {
            match decode_secret_key(pem, Some(pw)) {
                Ok(k) => return Ok(k),
                Err(russh::keys::Error::KeyIsEncrypted) => {}
                Err(e) => {
                    return Err(AppError::ssh(
                        "ssh_privkey_load_failed",
                        json!({ "err": e.to_string() }),
                    ))
                }
            }
        }
    }

    // 检查 passphrase 缓存
    if let Some(ctx) = ctx {
        use tauri::Manager as _;
        let cached: Option<zeroize::Zeroizing<String>> = match &ctx.app {
            crate::emitter::Host::Tauri(app) => {
                let state = app.state::<crate::state::AppState>();
                let guard = locked(&state.passphrase_cache).ok();
                guard.and_then(|m| m.get(cache_key).cloned())
            }
        };
        if let Some(pw) = cached {
            match decode_secret_key(pem, Some(pw.as_str())) {
                Ok(k) => return Ok(k),
                Err(russh::keys::Error::KeyIsEncrypted) => {
                    let crate::emitter::Host::Tauri(app) = &ctx.app;
                    let state = app.state::<crate::state::AppState>();
                    if let Ok(mut m) = locked(&state.passphrase_cache) {
                        m.remove(cache_key);
                    }
                    drop(state);
                }
                Err(e) => {
                    return Err(AppError::ssh(
                        "ssh_privkey_load_failed",
                        json!({ "err": e.to_string() }),
                    ))
                }
            }
        }
    }

    // 需要交互输入
    let ctx = ctx.ok_or_else(|| AppError::ssh("ssh_privkey_encrypted_no_ctx", json!({})))?;
    let prompt_label = "Enter passphrase for SSH key: ".to_string();

    for attempt in 0..MAX_PASSPHRASE_RETRIES {
        let pw = prompt_passphrase(ctx, &prompt_label).await?;
        match decode_secret_key(pem, Some(&pw)) {
            Ok(k) => {
                let crate::emitter::Host::Tauri(app) = &ctx.app;
                use tauri::Manager as _;
                let state = app.state::<crate::state::AppState>();
                if let Ok(mut m) = locked(&state.passphrase_cache) {
                    m.insert(cache_key.to_string(), zeroize::Zeroizing::new(pw));
                }
                drop(state);
                return Ok(k);
            }
            Err(russh::keys::Error::KeyIsEncrypted) => {
                let remaining = MAX_PASSPHRASE_RETRIES - attempt - 1;
                let msg = if remaining > 0 {
                    format!("\x1b[31mIncorrect passphrase, {remaining} attempt(s) left.\x1b[0m\r\n")
                } else {
                    "\x1b[31mIncorrect passphrase.\x1b[0m\r\n".to_string()
                };
                let _ = ctx.app.emit(&format!("ssh:data:{}", ctx.tab_id), msg.into_bytes());
            }
            Err(e) => {
                return Err(AppError::ssh(
                    "ssh_privkey_load_failed",
                    json!({ "err": e.to_string() }),
                ))
            }
        }
    }
    Err(AppError::ssh("ssh_passphrase_too_many", json!({})))
}

/// OpenSSH 兼容的 RSA 签名算法选择。
async fn pick_rsa_hash(
    handle: &client::Handle<SshHandler>,
    key: &PrivateKey,
) -> AppResult<Option<HashAlg>> {
    if !matches!(key.algorithm(), Algorithm::Rsa { .. }) {
        return Ok(None);
    }
    let supported = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|e| AppError::ssh("ssh_rsa_sigalg_failed", json!({ "err": e.to_string() })))?;
    Ok(supported.flatten())
}

async fn authenticate_private_key(
    handle: &mut client::Handle<SshHandler>,
    username: String,
    key: PrivateKey,
) -> AppResult<()> {
    let alg = pick_rsa_hash(handle, &key).await?;
    let key_with_alg = PrivateKeyWithHashAlg::new(Arc::new(key), alg);
    let result = handle
        .authenticate_publickey(username, key_with_alg)
        .await
        .map_err(|e| AppError::ssh("ssh_pubkey_auth_failed", json!({ "err": e.to_string() })))?;
    check_auth_result(result)
}

/// 主认证入口。auth_method: "password" | "key" | "agent" | "interactive" | "none"
pub async fn authenticate(
    handle: &mut client::Handle<SshHandler>,
    auth_method: &str,
    username: String,
    password: Option<String>,
    key_data: Option<(String, Option<String>)>, // (pem, stored_passphrase)
    ctx: Option<&AuthCtx>,
) -> AppResult<()> {
    match auth_method {
        "password" => {
            let pw = password.unwrap_or_default();
            let result = handle
                .authenticate_password(username, pw)
                .await
                .map_err(|e| AppError::ssh("ssh_password_auth_failed", json!({ "err": e.to_string() })))?;
            check_auth_result(result)
        }
        "key" => {
            let (pem, stored_pp) = key_data.ok_or_else(|| AppError::ssh("ssh_privkey_missing", json!({})))?;
            let cache_key = format!("pem:{}", &pem[..pem.len().min(64)]);
            let key = decode_key_from_data(&pem, stored_pp.as_deref(), &cache_key, ctx).await?;
            authenticate_private_key(handle, username, key).await
        }
        "agent" => {
            authenticate_with_agent_or_default_keys(handle, username, ctx).await
        }
        "interactive" => {
            let ctx = ctx.ok_or_else(|| AppError::ssh("ssh_interactive_requires_terminal", json!({})))?;
            authenticate_interactive(handle, username, ctx.app.clone(), ctx.tab_id.clone()).await
        }
        "none" => {
            let result = handle
                .authenticate_none(username)
                .await
                .map_err(|e| AppError::ssh("ssh_auth_failed", json!({ "err": e.to_string() })))?;
            check_auth_result(result)
        }
        _ => Err(AppError::ssh("ssh_unknown_auth_method", json!({ "method": auth_method }))),
    }
}

// ---------------------------------------------------------------------------
// SSH Agent + 默认密钥 fallback
// ---------------------------------------------------------------------------

async fn authenticate_with_agent_or_default_keys(
    handle: &mut client::Handle<SshHandler>,
    username: String,
    ctx: Option<&AuthCtx>,
) -> AppResult<()> {
    let agent_err = match authenticate_with_agent(handle, username.clone()).await {
        Ok(()) => return Ok(()),
        Err(e) => e,
    };
    match authenticate_with_default_keys(handle, username, ctx).await {
        Ok(()) => Ok(()),
        Err(key_err) if key_err.code() == "ssh_default_keys_not_found" => Err(agent_err),
        Err(key_err) => Err(key_err),
    }
}

async fn authenticate_with_agent(
    handle: &mut client::Handle<SshHandler>,
    username: String,
) -> AppResult<()> {
    use russh::keys::agent::client::AgentClient;
    #[cfg(unix)]
    {
        let agent = AgentClient::connect_env().await.map_err(|e| {
            AppError::ssh("ssh_agent_unix_connect_failed", json!({ "err": e.to_string() }))
        })?;
        try_agent_identities(handle, username, agent.dynamic()).await
    }
    #[cfg(windows)]
    {
        let pipe = r"\\.\pipe\openssh-ssh-agent";
        if let Ok(agent) = AgentClient::connect_named_pipe(pipe).await {
            return try_agent_identities(handle, username, agent.dynamic()).await;
        }
        let agent = AgentClient::connect_pageant().await.map_err(|e| {
            AppError::ssh("ssh_agent_pageant_failed", json!({ "err": e.to_string() }))
        })?;
        try_agent_identities(handle, username, agent.dynamic()).await
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (handle, username);
        Err(AppError::ssh("ssh_agent_not_supported", json!({})))
    }
}

async fn try_agent_identities<S>(
    handle: &mut client::Handle<SshHandler>,
    username: String,
    mut agent: russh::keys::agent::client::AgentClient<S>,
) -> AppResult<()>
where
    S: russh::keys::agent::client::AgentStream + Send + Unpin + 'static,
{
    use russh::keys::agent::AgentIdentity;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| AppError::ssh("ssh_agent_list_failed", json!({ "err": e.to_string() })))?;
    if identities.is_empty() {
        return Err(AppError::ssh("ssh_agent_no_identity", json!({})));
    }
    let has_rsa = identities.iter().any(|id| {
        matches!(id, AgentIdentity::PublicKey { key, .. } if matches!(key.algorithm(), Algorithm::Rsa { .. }))
    });
    let rsa_hash = if has_rsa {
        handle
            .best_supported_rsa_hash()
            .await
            .map_err(|e| AppError::ssh("ssh_rsa_sigalg_failed", json!({ "err": e.to_string() })))?
            .flatten()
    } else {
        None
    };
    for identity in identities {
        let hash_alg = match &identity {
            AgentIdentity::PublicKey { key, .. } if matches!(key.algorithm(), Algorithm::Rsa { .. }) => rsa_hash,
            _ => None,
        };
        let result = match identity {
            AgentIdentity::PublicKey { key, .. } => {
                handle.authenticate_publickey_with(username.clone(), key, hash_alg, &mut agent).await
            }
            AgentIdentity::Certificate { certificate, .. } => {
                handle.authenticate_certificate_with(username.clone(), certificate, hash_alg, &mut agent).await
            }
        };
        match result {
            Ok(r) if r.success() => return Ok(()),
            Ok(_) => continue,
            Err(_) => continue,
        }
    }
    Err(AppError::ssh("ssh_agent_all_rejected", json!({})))
}

async fn authenticate_with_default_keys(
    handle: &mut client::Handle<SshHandler>,
    username: String,
    ctx: Option<&AuthCtx>,
) -> AppResult<()> {
    let paths = default_identity_paths();
    let mut last_code: Option<&'static str> = None;
    let mut found = 0usize;

    for path in &paths {
        if !path.exists() { continue; }
        found += 1;
        let path_str = path.to_string_lossy().into_owned();
        let cache_key = format!("path:{path_str}");
        let key = match decode_key_from_path(&path_str, &cache_key, ctx).await {
            Ok(k) => k,
            Err(e) => { last_code = Some(e.code()); continue; }
        };
        match authenticate_private_key(handle, username.clone(), key).await {
            Ok(()) => return Ok(()),
            Err(e) => { last_code = Some(e.code()); }
        }
    }

    if found == 0 {
        return Err(AppError::ssh("ssh_default_keys_not_found", json!({})));
    }
    Err(AppError::ssh(
        "ssh_default_keys_unavailable",
        json!({ "code": last_code.unwrap_or("unknown") }),
    ))
}

fn default_identity_paths() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else { return Vec::new(); };
    let ssh_dir = home.join(".ssh");
    ["id_rsa", "id_ecdsa", "id_ecdsa_sk", "id_ed25519", "id_ed25519_sk"]
        .into_iter()
        .map(|name| ssh_dir.join(name))
        .collect()
}

// ---------------------------------------------------------------------------
// kbd-interactive
// ---------------------------------------------------------------------------

pub async fn authenticate_interactive(
    handle: &mut client::Handle<SshHandler>,
    username: String,
    app: crate::emitter::Host,
    tab_id: String,
) -> AppResult<()> {
    use russh::client::KeyboardInteractiveAuthResponse;
    use tauri::Manager as _;

    let mut reply = handle
        .authenticate_keyboard_interactive_start(username, None::<String>)
        .await
        .map_err(|e| AppError::ssh("ssh_kbi_start_failed", json!({ "err": e.to_string() })))?;

    loop {
        match reply {
            KeyboardInteractiveAuthResponse::Success => return Ok(()),
            KeyboardInteractiveAuthResponse::Failure { .. } => {
                return Err(AppError::ssh("ssh_auth_rejected", json!({})));
            }
            KeyboardInteractiveAuthResponse::InfoRequest { name, instructions, prompts } => {
                let (tx, rx) = tokio::sync::oneshot::channel::<Vec<String>>();
                let prompt_data: Vec<serde_json::Value> = prompts
                    .iter()
                    .map(|p| serde_json::json!({ "prompt": p.prompt, "echo": p.echo }))
                    .collect();

                // 注册 sender，然后 emit；如果 emit 失败，sender 留在 map 里
                // 但 disconnect 会清理所有 waiters，所以不会永久泄漏
                {
                    let state = match &app {
                        crate::emitter::Host::Tauri(a) => a.state::<crate::state::AppState>(),
                    };
                    locked(&state.auth_waiters)?.insert(tab_id.clone(), tx);
                }

                let emit_result = app.emit(
                    &format!("ssh:auth_prompt:{tab_id}"),
                    serde_json::json!({
                        "name": name,
                        "instructions": instructions,
                        "prompts": prompt_data,
                    }),
                );

                if let Err(e) = emit_result {
                    // emit 失败：清理 sender，返回错误
                    let state = match &app {
                        crate::emitter::Host::Tauri(a) => a.state::<crate::state::AppState>(),
                    };
                    let _ = locked(&state.auth_waiters).map(|mut m| m.remove(&tab_id));
                    return Err(AppError::other("emit_failed", json!({ "err": e.to_string() })));
                }

                let responses = rx
                    .await
                    .map_err(|_| AppError::ssh("ssh_user_cancelled_auth", json!({})))?;

                reply = handle
                    .authenticate_keyboard_interactive_respond(responses)
                    .await
                    .map_err(|e| AppError::ssh("ssh_kbi_response_failed", json!({ "err": e.to_string() })))?;
            }
        }
    }
}
