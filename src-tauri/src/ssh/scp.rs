// src-tauri/src/ssh/scp.rs
//! SCP protocol implementation over russh exec channels.
//!
//! Upload:   scp -t <remote_path>  (sink mode)
//! Download: scp -f <remote_path>  (source mode)

use std::path::Path;
use std::sync::Arc;

use russh::ChannelMsg;
use serde_json::json;
use tokio::io::AsyncWriteExt as _;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

use crate::emitter::Host;
use crate::error::{AppError, AppResult};
use crate::ssh::client::SshHandler;

const CHUNK_SIZE: usize = 65536; // 64 KB
const ACK_TIMEOUT: Duration = Duration::from_secs(30);

/// Progress event payload emitted during SCP transfers.
#[derive(serde::Serialize, Clone)]
pub struct ScpProgress {
    pub session_id: String,
    pub filename: String,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub status: String, // "transferring" | "complete" | "error"
}

fn emit_progress(app: &Host, ev: ScpProgress) {
    let _ = app.emit("scp:progress", ev);
}

/// Upload a single file to the remote host via SCP.
pub async fn scp_upload_file(
    ssh_handle: &Arc<Mutex<russh::client::Handle<SshHandler>>>,
    local_path: &str,
    remote_path: &str,
    session_id: &str,
    app: &Host,
) -> AppResult<()> {
    let path = Path::new(local_path);
    let metadata = std::fs::metadata(path)
        .map_err(|e| AppError::ssh("scp_local_file_error", json!({ "err": e.to_string() })))?;
    let file_size = metadata.len();
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");

    // Open exec channel with scp sink mode
    let mut channel = {
        let h = ssh_handle.lock().await;
        h.channel_open_session()
            .await
            .map_err(|e| AppError::ssh("scp_channel_open", json!({ "err": e.to_string() })))?
    };
    let cmd = format!("scp -t {}", shell_escape(remote_path));
    channel
        .exec(true, cmd.as_str())
        .await
        .map_err(|e| AppError::ssh("scp_exec_failed", json!({ "err": e.to_string() })))?;

    // Wait for initial ACK (server readiness)
    wait_ack(&mut channel).await?;

    // Send file header: C<mode> <size> <filename>\n
    let header = format!("C0644 {} {}\n", file_size, filename);
    {
        let mut w = channel.make_writer();
        w.write_all(header.as_bytes())
            .await
            .map_err(|e| AppError::ssh("scp_write_error", json!({ "err": e.to_string() })))?;
    }

    // Wait for ACK after header
    wait_ack(&mut channel).await?;

    // Send file data in chunks
    let mut file = std::fs::File::open(path)
        .map_err(|e| AppError::ssh("scp_local_file_error", json!({ "err": e.to_string() })))?;

    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut sent: u64 = 0;

    loop {
        use std::io::Read;
        let n = file
            .read(&mut buf)
            .map_err(|e| AppError::ssh("scp_local_file_error", json!({ "err": e.to_string() })))?;
        if n == 0 {
            break;
        }

        {
            let mut w = channel.make_writer();
            w.write_all(&buf[..n])
                .await
                .map_err(|e| AppError::ssh("scp_write_error", json!({ "err": e.to_string() })))?;
        }

        sent += n as u64;
        emit_progress(
            app,
            ScpProgress {
                session_id: session_id.to_string(),
                filename: filename.to_string(),
                bytes_transferred: sent,
                total_bytes: file_size,
                status: "transferring".into(),
            },
        );
    }

    // Send trailing \0 to signal end of file data
    {
        let mut w = channel.make_writer();
        w.write_all(&[0])
            .await
            .map_err(|e| AppError::ssh("scp_write_error", json!({ "err": e.to_string() })))?;
    }

    // Wait for final ACK
    wait_ack(&mut channel).await?;

    emit_progress(
        app,
        ScpProgress {
            session_id: session_id.to_string(),
            filename: filename.to_string(),
            bytes_transferred: file_size,
            total_bytes: file_size,
            status: "complete".into(),
        },
    );

    let _ = channel.close().await;
    Ok(())
}

/// Download a single file from the remote host via SCP.
pub async fn scp_download_file(
    ssh_handle: &Arc<Mutex<russh::client::Handle<SshHandler>>>,
    remote_path: &str,
    local_path: &str,
    session_id: &str,
    app: &Host,
) -> AppResult<()> {
    // Open exec channel with scp source mode
    let mut channel = {
        let h = ssh_handle.lock().await;
        h.channel_open_session()
            .await
            .map_err(|e| AppError::ssh("scp_channel_open", json!({ "err": e.to_string() })))?
    };
    let cmd = format!("scp -f {}", shell_escape(remote_path));
    channel
        .exec(true, cmd.as_str())
        .await
        .map_err(|e| AppError::ssh("scp_exec_failed", json!({ "err": e.to_string() })))?;

    // Send initial ACK to request file info
    send_ack(&mut channel).await?;

    // Read file header: C<mode> <size> <filename>\n
    let header_line = read_line(&mut channel).await?;
    let (file_size, filename) = parse_file_header(&header_line)?;

    // Send ACK for header
    send_ack(&mut channel).await?;

    // Read file data
    let path = Path::new(local_path);
    let mut file = std::fs::File::create(path)
        .map_err(|e| AppError::ssh("scp_local_file_error", json!({ "err": e.to_string() })))?;

    let mut received: u64 = 0;
    let mut data_buf = Vec::new();

    while received < file_size {
        let msg = timeout(ACK_TIMEOUT, channel.wait())
            .await
            .map_err(|_| AppError::ssh("scp_timeout", json!({})))?
            .ok_or_else(|| AppError::ssh("scp_channel_closed", json!({})))?;

        match msg {
            ChannelMsg::Data { data } => {
                let bytes = data.to_vec();
                let needed = (file_size - received) as usize;
                let take = bytes.len().min(needed);
                use std::io::Write;
                file.write_all(&bytes[..take])
                    .map_err(|e| AppError::ssh("scp_local_file_error", json!({ "err": e.to_string() })))?;
                // Save any trailing bytes (the \0 end marker)
                if bytes.len() > take {
                    data_buf.extend_from_slice(&bytes[take..]);
                }
                received += take as u64;
                emit_progress(
                    app,
                    ScpProgress {
                        session_id: session_id.to_string(),
                        filename: filename.clone(),
                        bytes_transferred: received,
                        total_bytes: file_size,
                        status: "transferring".into(),
                    },
                );
            }
            ChannelMsg::ExitStatus { .. } => break,
            _ => {}
        }
    }

    // Send final ACK
    send_ack(&mut channel).await?;

    emit_progress(
        app,
        ScpProgress {
            session_id: session_id.to_string(),
            filename: filename.clone(),
            bytes_transferred: file_size,
            total_bytes: file_size,
            status: "complete".into(),
        },
    );

    let _ = channel.close().await;
    Ok(())
}

// ---------------------------------------------------------------------------
// SCP protocol helpers
// ---------------------------------------------------------------------------

/// Wait for an ACK byte from the remote. 0x00 = OK, 0x01/0x02 = error.
async fn wait_ack(
    channel: &mut russh::Channel<russh::client::Msg>,
) -> AppResult<()> {
    let msg = timeout(ACK_TIMEOUT, channel.wait())
        .await
        .map_err(|_| AppError::ssh("scp_timeout", json!({})))?
        .ok_or_else(|| AppError::ssh("scp_channel_closed", json!({})))?;

    match msg {
        ChannelMsg::Data { data } => {
            let bytes = data.to_vec();
            if bytes.is_empty() {
                return Err(AppError::ssh("scp_protocol_error", json!({ "err": "empty ACK" })));
            }
            match bytes[0] {
                0 => Ok(()),
                1 => {
                    let msg = String::from_utf8_lossy(&bytes[1..]);
                    Err(AppError::ssh("scp_remote_warning", json!({ "msg": msg.trim() })))
                }
                2 => {
                    let msg = String::from_utf8_lossy(&bytes[1..]);
                    Err(AppError::ssh("scp_remote_error", json!({ "msg": msg.trim() })))
                }
                _ => Err(AppError::ssh("scp_protocol_error", json!({ "byte": bytes[0] }))),
            }
        }
        ChannelMsg::ExitStatus { exit_status } if exit_status != 0 => {
            Err(AppError::ssh("scp_exit_error", json!({ "code": exit_status })))
        }
        _ => Ok(()),
    }
}

/// Send an ACK byte (0x00) to the remote.
async fn send_ack(
    channel: &mut russh::Channel<russh::client::Msg>,
) -> AppResult<()> {
    let mut w = channel.make_writer();
    w.write_all(&[0])
        .await
        .map_err(|e| AppError::ssh("scp_write_error", json!({ "err": e.to_string() })))?;
    Ok(())
}

/// Read a line (terminated by \n) from the SCP channel.
async fn read_line(
    channel: &mut russh::Channel<russh::client::Msg>,
) -> AppResult<String> {
    let mut line = Vec::new();
    loop {
        let msg = timeout(ACK_TIMEOUT, channel.wait())
            .await
            .map_err(|_| AppError::ssh("scp_timeout", json!({})))?
            .ok_or_else(|| AppError::ssh("scp_channel_closed", json!({})))?;

        match msg {
            ChannelMsg::Data { data } => {
                for &b in data.iter() {
                    if b == b'\n' {
                        return String::from_utf8(line)
                            .map_err(|_| AppError::ssh("scp_protocol_error", json!({ "err": "invalid UTF-8 in header" })));
                    }
                    line.push(b);
                }
            }
            ChannelMsg::ExitStatus { exit_status } if exit_status != 0 => {
                return Err(AppError::ssh("scp_exit_error", json!({ "code": exit_status })));
            }
            _ => {}
        }
    }
}

/// Parse SCP file header: "C<mode> <size> <filename>"
fn parse_file_header(line: &str) -> AppResult<(u64, String)> {
    let parts: Vec<&str> = line.splitn(3, ' ').collect();
    if parts.len() < 3 || !parts[0].starts_with('C') {
        return Err(AppError::ssh("scp_protocol_error", json!({ "err": format!("unexpected header: {}", line) })));
    }
    let size = parts[1]
        .parse::<u64>()
        .map_err(|_| AppError::ssh("scp_protocol_error", json!({ "err": "invalid file size" })))?;
    Ok((size, parts[2].to_string()))
}

/// Basic shell escaping for remote paths.
fn shell_escape(s: &str) -> String {
    if s.chars().all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '.' || c == '-' || c == '_') {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}
