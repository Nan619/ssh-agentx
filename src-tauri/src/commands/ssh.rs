// src-tauri/src/commands/ssh.rs
use serde_json::json;
use tauri::{AppHandle, State};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::error::{locked, AppError, AppResult};
use crate::ssh::client::{self, run_blocking_ssh};
use crate::ssh::known_hosts;
use crate::ssh::session::{AgentCapture, SshSessionHandle};
use crate::state::AppState;

fn select_host_skills(
    all_skills: &[crate::db::Skill],
    system_info: &str,
    manual_ids: &str,
) -> Vec<String> {
    let sysinfo_lower = system_info.to_lowercase();
    let sysinfo_words: std::collections::HashSet<&str> = sysinfo_lower
        .split(|c: char| !c.is_alphanumeric() && c != '-')
        .filter(|s| s.len() > 1)
        .collect();

    let manual_set: std::collections::HashSet<&str> = manual_ids
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut result: Vec<String> = Vec::new();
    for skill in all_skills {
        if manual_set.contains(skill.id.as_str()) {
            result.push(skill.id.clone());
            continue;
        }
        let score = skill
            .tags
            .split(',')
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty() && sysinfo_words.contains(t.as_str()))
            .count();
        if score > 0 {
            result.push(skill.id.clone());
        }
    }

    let mut seen = std::collections::HashSet::new();
    result.retain(|id| seen.insert(id.clone()));
    result
}

/// Minimal base64 encoder (avoids adding a crate dependency).
fn b64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 0x3F) as usize]);
        out.push(T[((n >> 12) & 0x3F) as usize]);
        if chunk.len() > 1 { out.push(T[((n >> 6) & 0x3F) as usize]); } else { out.push(b'='); }
        if chunk.len() > 2 { out.push(T[(n & 0x3F) as usize]); } else { out.push(b'='); }
    }
    String::from_utf8(out).unwrap()
}

// ---------------------------------------------------------------------------
// ssh_connect
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct ConnectRequest {
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    pub password: Option<String>,
    pub key_id: Option<String>,
    pub cols: u32,
    pub rows: u32,
    pub tab_id: String,
    pub skill_ids: Option<String>,
}

#[derive(serde::Serialize)]
pub struct ConnectResponse {
    pub session_id: String,
    pub success: bool,
    pub error: Option<String>,
    pub host_skill_ids: Vec<String>,
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ConnectRequest,
) -> AppResult<ConnectResponse> {
    let known_hosts_path = known_hosts::path_for(&state.data_dir);
    let log_session_id = Some(request.tab_id.clone());

    // 若 auth_method == "key"，从 DB 取 pem + passphrase
    let key_data: Option<(String, Option<String>)> = if request.auth_method == "key" {
        match request.key_id.as_deref() {
            Some(kid) => {
                let key = state.db.get_key(kid)
                    .map_err(AppError::from)?
                    .ok_or_else(|| AppError::config("ssh_key_not_found", serde_json::json!({ "id": kid })))?;
                Some((key.pem, key.passphrase))
            }
            None => return Err(AppError::config("ssh_key_id_missing", serde_json::json!({}))),
        }
    } else {
        None
    };

    let hostname = request.hostname.clone();
    let port = request.port;
    let auth_method = request.auth_method.clone();
    let username = request.username.clone();
    let password = request.password.clone();
    let cols = request.cols;
    let rows = request.rows;
    let app_host = crate::emitter::Host::Tauri(app);

    match run_blocking_ssh(move || async move {
        client::connect(
            hostname,
            port,
            auth_method,
            username,
            password,
            key_data,
            cols,
            rows,
            app_host,
            known_hosts_path,
            log_session_id,
        )
        .await
    })
    .await
    {
        Ok(result) => {
            let session_id = result.session_id.clone();
            locked(&state.sessions)?.insert(session_id.clone(), result.handle);

            // Compute host_skill_ids using manual bindings + system_info if available.
            // system_info is populated asynchronously; try a non-blocking read.
            let host_skill_ids = {
                let manual_ids = request.skill_ids.as_deref().unwrap_or("");
                let all_skills = state.db.list_skills_full().unwrap_or_default();

                // Try a non-blocking read of system_info from the freshly-stored session.
                let system_info = {
                    let system_info_arc = {
                        let sessions = locked(&state.sessions)?;
                        sessions
                            .get(&session_id)
                            .map(|s| s.system_info.clone())
                    };
                    if let Some(arc) = system_info_arc {
                        arc.try_lock()
                            .ok()
                            .and_then(|guard| guard.clone())
                            .unwrap_or_default()
                    } else {
                        String::new()
                    }
                };

                let ids = select_host_skills(&all_skills, &system_info, manual_ids);

                // Store the computed ids back into the session handle.
                if let Ok(mut sessions) = locked(&state.sessions) {
                    if let Some(s) = sessions.get_mut(&session_id) {
                        s.host_skill_ids = ids.clone();
                    }
                }

                ids
            };

            Ok(ConnectResponse {
                session_id,
                success: true,
                error: None,
                host_skill_ids,
            })
        }
        Err(e) => Ok(ConnectResponse {
            session_id: String::new(),
            success: false,
            error: Some(e.to_string()),
            host_skill_ids: Vec::new(),
        }),
    }
}

// ---------------------------------------------------------------------------
// ssh_disconnect
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ssh_disconnect(
    state: State<'_, AppState>,
    session_id: String,
    tab_id: Option<String>,
) -> AppResult<()> {
    // 防御性清理三张 waiters
    if let Some(tid) = tab_id.as_deref() {
        let _ = locked(&state.auth_waiters).map(|mut m| m.remove(tid));
        let _ = locked(&state.passphrase_waiters).map(|mut m| m.remove(tid));
        let _ = locked(&state.host_key_waiters).map(|mut m| m.remove(tid));
    }
    let session = locked(&state.sessions)?
        .remove(&session_id)
        .ok_or_else(|| AppError::not_found("session_not_found", json!({})))?;
    session.force_close();
    Ok(())
}

// ---------------------------------------------------------------------------
// terminal_input / terminal_resize
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct TerminalInput {
    pub session_id: String,
    pub data: Vec<u8>,
}

#[tauri::command]
pub async fn terminal_input(
    state: State<'_, AppState>,
    input: TerminalInput,
) -> AppResult<()> {
    get_session(&state, &input.session_id)?.write(&input.data)
}

#[derive(serde::Deserialize)]
pub struct TerminalResize {
    pub session_id: String,
    pub cols: u32,
    pub rows: u32,
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, AppState>,
    resize: TerminalResize,
) -> AppResult<()> {
    get_session(&state, &resize.session_id)?.resize(resize.cols, resize.rows)
}

// ---------------------------------------------------------------------------
// get_terminal_output
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_terminal_output(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<String> {
    let output_buffer = {
        let sessions = locked(&state.sessions)?;
        sessions
            .get(&session_id)
            .map(|s| s.output_buffer.clone())
            .ok_or_else(|| AppError::not_found("session_not_found", json!({})))?
    };
    let buf = output_buffer.lock().await;
    let bytes: Vec<u8> = buf.iter().copied().collect();
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

// ---------------------------------------------------------------------------
// agent_exec：sentinel 注入
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct AgentExecRequest {
    pub session_id: String,
    pub command: String,
}

#[derive(serde::Serialize)]
pub struct AgentExecResponse {
    pub exit_code: i32,
    pub stdout: String,
}

#[tauri::command]
pub async fn agent_exec(
    state: State<'_, AppState>,
    request: AgentExecRequest,
) -> AppResult<AgentExecResponse> {
    let uuid = Uuid::new_v4().to_string();

    // Base64-encode the command to prevent shell injection
    let cmd_b64 = b64_encode(request.command.as_bytes());
    let injected = format!(
        "\x15_s=\"__AGENT_ST\"\"ART_{0}__\"; _e=\"__AGENT_EN\"\"D_{0}_\"; \
         printf \"${{_s}}\\n\"; echo \"{1}\" | base64 -d | sh; __ret=$?; \
         printf \"${{_e}}${{__ret}}__\\n\"\n",
        uuid, cmd_b64
    );

    let (agent_capture_arc, output_tx) = {
        let sessions = locked(&state.sessions)?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| AppError::not_found("session_not_found", json!({})))?;
        (session.agent_capture.clone(), session.output_tx.clone())
    };

    // Guard: reject concurrent agent_exec calls
    {
        let guard = agent_capture_arc.lock().await;
        if guard.is_some() {
            return Err(AppError::ssh("agent_exec_busy", json!({})));
        }
    }

    // 命令头显示（黄色）— 替换裸 \n 为 \r\n 避免 xterm.js 列偏移
    let display_cmd = request.command.replace('\n', "\r\n");
    let header = format!("\r\n\x1b[1;33m[Agent] $ {}\x1b[0m\r\n", display_cmd);
    let _ = output_tx.send(header.into_bytes());

    // 注册 sentinel capture
    let rx = {
        let (tx, rx) = oneshot::channel::<crate::ssh::session::CaptureResult>();
        let mut guard = agent_capture_arc.lock().await;
        // Double-check after acquiring write lock
        if guard.is_some() {
            return Err(AppError::ssh("agent_exec_busy", json!({})));
        }
        *guard = Some(AgentCapture {
            uuid: uuid.clone(),
            buffer: String::new(),
            start_found: false,
            tail: String::new(),
            result_tx: tx,
        });
        rx
    };

    // 写入注入命令
    {
        let sessions = locked(&state.sessions)?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| AppError::not_found("session_not_found", json!({})))?;
        session.write(&injected.into_bytes())?;
    }

    // 等待 sentinel 完成（30 s 超时），无论成功失败都清理 capture
    let result = tokio::time::timeout(std::time::Duration::from_secs(30), rx).await;
    let result = match result {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => {
            *agent_capture_arc.lock().await = None;
            return Err(AppError::ssh("agent_exec_channel_closed", json!({})));
        }
        Err(_) => {
            *agent_capture_arc.lock().await = None;
            return Err(AppError::ssh("agent_exec_timeout", json!({})));
        }
    };

    Ok(AgentExecResponse {
        exit_code: result.exit_code,
        stdout: result.stdout,
    })
}

// ---------------------------------------------------------------------------
// known_hosts / passphrase / auth respond/cancel 命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ssh_host_key_respond(
    state: State<'_, AppState>,
    tab_id: String,
    answer: String,
) -> AppResult<()> {
    let tx = locked(&state.host_key_waiters)?
        .remove(&tab_id)
        .ok_or_else(|| AppError::other("no_pending_hostkey", json!({})))?;
    tx.send(answer).map_err(|_| AppError::other("hostkey_channel_closed", json!({})))
}

#[tauri::command]
pub async fn ssh_host_key_cancel(
    state: State<'_, AppState>,
    tab_id: String,
) -> AppResult<()> {
    locked(&state.host_key_waiters)?.remove(&tab_id);
    Ok(())
}

#[tauri::command]
pub async fn ssh_passphrase_respond(
    state: State<'_, AppState>,
    tab_id: String,
    passphrase: String,
) -> AppResult<()> {
    let tx = locked(&state.passphrase_waiters)?
        .remove(&tab_id)
        .ok_or_else(|| AppError::other("no_pending_passphrase", json!({})))?;
    tx.send(passphrase).map_err(|_| AppError::other("passphrase_channel_closed", json!({})))
}

#[tauri::command]
pub async fn ssh_passphrase_cancel(
    state: State<'_, AppState>,
    tab_id: String,
) -> AppResult<()> {
    locked(&state.passphrase_waiters)?.remove(&tab_id);
    Ok(())
}

#[tauri::command]
pub async fn ssh_auth_respond(
    state: State<'_, AppState>,
    tab_id: String,
    responses: Vec<String>,
) -> AppResult<()> {
    let tx = locked(&state.auth_waiters)?
        .remove(&tab_id)
        .ok_or_else(|| AppError::other("no_pending_auth", json!({})))?;
    tx.send(responses).map_err(|_| AppError::other("auth_channel_closed", json!({})))
}

#[tauri::command]
pub async fn ssh_auth_cancel(
    state: State<'_, AppState>,
    tab_id: String,
) -> AppResult<()> {
    locked(&state.auth_waiters)?.remove(&tab_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn get_session(state: &State<'_, AppState>, session_id: &str) -> AppResult<SshSessionHandle> {
    locked(&state.sessions)?
        .get(session_id)
        .cloned()
        .ok_or_else(|| AppError::not_found("session_not_found", json!({})))
}
