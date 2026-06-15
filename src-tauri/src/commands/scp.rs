// src-tauri/src/commands/scp.rs
use serde_json::json;
use tauri::{AppHandle, State};

use crate::emitter::Host;
use crate::error::{locked, AppError, AppResult};
use crate::ssh::client::run_blocking_ssh;
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct ScpUploadRequest {
    pub session_id: String,
    pub local_paths: Vec<String>,
    pub remote_dir: String,
}

#[derive(serde::Deserialize)]
pub struct ScpDownloadRequest {
    pub session_id: String,
    pub remote_paths: Vec<String>,
    pub local_dir: String,
}

#[tauri::command]
pub async fn scp_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ScpUploadRequest,
) -> AppResult<()> {
    let ssh_handle = {
        let sessions = locked(&state.sessions)?;
        sessions
            .get(&request.session_id)
            .ok_or_else(|| AppError::not_found("session_not_found", json!({})))?
            .ssh_handle
            .clone()
    };

    let session_id = request.session_id.clone();
    let local_paths = request.local_paths;
    let remote_dir = request.remote_dir;
    let host = Host::Tauri(app);

    run_blocking_ssh(move || async move {
        for local_path in &local_paths {
            let filename = std::path::Path::new(local_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file");
            let remote_path = format!("{}/{}", remote_dir.trim_end_matches('/'), filename);

            if let Err(e) = crate::ssh::scp::scp_upload_file(
                &ssh_handle,
                local_path,
                &remote_path,
                &session_id,
                &host,
            )
            .await
            {
                // Emit error progress and continue with next file
                let _ = host.emit(
                    "scp:progress",
                    crate::ssh::scp::ScpProgress {
                        session_id: session_id.clone(),
                        filename: filename.to_string(),
                        bytes_transferred: 0,
                        total_bytes: 0,
                        status: "error".into(),
                    },
                );
                eprintln!("[scp] upload error for {}: {}", filename, e);
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn scp_download(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ScpDownloadRequest,
) -> AppResult<()> {
    let ssh_handle = {
        let sessions = locked(&state.sessions)?;
        sessions
            .get(&request.session_id)
            .ok_or_else(|| AppError::not_found("session_not_found", json!({})))?
            .ssh_handle
            .clone()
    };

    let session_id = request.session_id.clone();
    let remote_paths = request.remote_paths;
    let local_dir = request.local_dir;
    let host = Host::Tauri(app);

    run_blocking_ssh(move || async move {
        for remote_path in &remote_paths {
            let filename = std::path::Path::new(remote_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file");
            let local_path = format!("{}/{}", local_dir.trim_end_matches('/'), filename);

            if let Err(e) = crate::ssh::scp::scp_download_file(
                &ssh_handle,
                remote_path,
                &local_path,
                &session_id,
                &host,
            )
            .await
            {
                let _ = host.emit(
                    "scp:progress",
                    crate::ssh::scp::ScpProgress {
                        session_id: session_id.clone(),
                        filename: filename.to_string(),
                        bytes_transferred: 0,
                        total_bytes: 0,
                        status: "error".into(),
                    },
                );
                eprintln!("[scp] download error for {}: {}", filename, e);
            }
        }
        Ok(())
    })
    .await
}

#[derive(serde::Deserialize)]
pub struct ScpExtractPathRequest {
    pub text: String,
}

#[derive(serde::Serialize)]
pub struct ScpExtractPathResponse {
    pub paths: Vec<String>,
}

#[tauri::command]
pub async fn scp_extract_path(request: ScpExtractPathRequest) -> AppResult<ScpExtractPathResponse> {
    // Extract absolute paths from text (matches /path/to/file patterns)
    let mut paths = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for word in request.text.split(|c: char| c.is_whitespace() || c == '"' || c == '\'') {
        // Find path-like substrings
        let trimmed = word.trim_matches(|c: char| !c.is_ascii() || c == ':' || c == ',' || c == ';');
        if trimmed.starts_with('/') && trimmed.len() > 1 {
            // Basic validation: must contain at least one /
            let path = trimmed.to_string();
            if seen.insert(path.clone()) {
                paths.push(path);
            }
        }
    }

    Ok(ScpExtractPathResponse { paths })
}
