// src-tauri/src/ssh/client.rs
use std::collections::VecDeque;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};

use russh::client;
use russh::ChannelMsg;
use serde_json::json;
use tokio::sync::mpsc::{self, UnboundedReceiver};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

use crate::error::{AppError, AppResult};
use crate::ssh::session::{AgentCapture, SessionCmd, SshSessionHandle, OUTPUT_BUFFER_CAP};
use super::prompt::AuthCtx;

// ---------------------------------------------------------------------------
// SSH Worker 线程：解决 HRTB-Send 问题
// ---------------------------------------------------------------------------

type SshJob = Box<dyn FnOnce() + Send + 'static>;

fn ssh_dispatcher() -> &'static tokio::sync::mpsc::UnboundedSender<SshJob> {
    static TX: OnceLock<tokio::sync::mpsc::UnboundedSender<SshJob>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<SshJob>();
        std::thread::Builder::new()
            .name("ssh-agentx-ssh".into())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("ssh worker runtime");
                let local = tokio::task::LocalSet::new();
                rt.block_on(local.run_until(async move {
                    while let Some(job) = rx.recv().await {
                        job();
                    }
                }));
            })
            .expect("spawn ssh worker thread");
        tx
    })
}

pub fn spawn_ssh<F, Fut, T>(work: F) -> tokio::sync::oneshot::Receiver<AppResult<T>>
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = AppResult<T>> + 'static,
    T: Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    let job: SshJob = Box::new(move || {
        let fut = work();
        tokio::task::spawn_local(async move {
            let _ = tx.send(fut.await);
        });
    });
    let _ = ssh_dispatcher().send(job);
    rx
}

pub async fn run_blocking_ssh<F, Fut, T>(work: F) -> AppResult<T>
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = AppResult<T>> + 'static,
    T: Send + 'static,
{
    spawn_ssh(work)
        .await
        .map_err(|_| AppError::ssh("ssh_task_cancelled", json!({})))?
}

// ---------------------------------------------------------------------------
// SSH Handler：known_hosts 验证
// ---------------------------------------------------------------------------

pub struct SshHandler {
    host: String,
    port: u16,
    known_hosts_path: PathBuf,
    key_mismatch: Arc<StdMutex<bool>>,
    log: Arc<dyn Fn(String) + Send + Sync>,
    prompt_ctx: Option<AuthCtx>,
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
        use russh::keys::known_hosts;
        use russh::keys::HashAlg;

        let check = known_hosts::check_known_hosts_path(
            &self.host,
            self.port,
            server_public_key,
            &self.known_hosts_path,
        );
        let host = self.host.clone();
        let port = self.port;
        let path = self.known_hosts_path.clone();
        let alg = server_public_key.algorithm().as_str().to_string();
        let fp = server_public_key.fingerprint(HashAlg::Sha256).to_string();
        let pubkey = server_public_key.clone();
        let log = self.log.clone();
        let ctx = self.prompt_ctx.clone();
        let mismatch = self.key_mismatch.clone();

        async move {
            match check {
                Ok(true) => Ok(true),
                Ok(false) => match ctx {
                    Some(c) => handle_unknown_host(c, host, port, alg, fp, pubkey, path, log).await,
                    None => {
                        log(format!("Unknown host {host}:{port} ({alg} {fp}). No terminal context."));
                        Ok(false)
                    }
                },
                Err(_) => match ctx {
                    Some(c) => handle_key_mismatch(c, host, port, alg, fp, pubkey, path, log, mismatch).await,
                    None => {
                        if let Ok(mut m) = mismatch.lock() { *m = true; }
                        Ok(false)
                    }
                },
            }
        }
    }

    fn disconnected(
        &mut self,
        reason: client::DisconnectReason<Self::Error>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        async move {
            match reason {
                client::DisconnectReason::Error(e) => Err(e),
                _ => Ok(()),
            }
        }
    }
}

async fn handle_unknown_host(
    ctx: AuthCtx,
    host: String,
    port: u16,
    alg: String,
    fp: String,
    pubkey: russh::keys::ssh_key::PublicKey,
    path: PathBuf,
    log: Arc<dyn Fn(String) + Send + Sync>,
) -> Result<bool, russh::Error> {
    use russh::keys::known_hosts;
    let banner = format!(
        "\r\nThe authenticity of host '{host}' can't be established.\r\n\
         {alg} key fingerprint is {fp}.\r\n\
         Are you sure you want to continue connecting (yes/no/[fingerprint])? "
    );
    let answer = match super::prompt::prompt_host_key(&ctx, &banner, false).await {
        Ok(a) => a,
        Err(_) => {
            log(format!("Host key confirmation cancelled for {host}:{port}."));
            return Ok(false);
        }
    };
    let trimmed = answer.trim();
    if !(trimmed.eq_ignore_ascii_case("yes") || trimmed == fp) {
        log(format!("Host key rejected by user for {host}:{port}."));
        return Ok(false);
    }
    match known_hosts::learn_known_hosts_path(&host, port, &pubkey, &path) {
        Ok(()) => log(format!("Permanently added {host}:{port} to known_hosts.")),
        Err(e) => log(format!("known_hosts write failed: {e}")),
    }
    Ok(true)
}

async fn handle_key_mismatch(
    ctx: AuthCtx,
    host: String,
    port: u16,
    alg: String,
    fp: String,
    pubkey: russh::keys::ssh_key::PublicKey,
    path: PathBuf,
    log: Arc<dyn Fn(String) + Send + Sync>,
    mismatch: Arc<StdMutex<bool>>,
) -> Result<bool, russh::Error> {
    use russh::keys::known_hosts;
    use russh::keys::HashAlg;

    let set_mismatch = || {
        if let Ok(mut m) = mismatch.lock() { *m = true; }
    };
    let old_fps: Vec<String> = known_hosts::known_host_keys_path(&host, port, &path)
        .ok()
        .unwrap_or_default()
        .into_iter()
        .map(|(_, k)| k.fingerprint(HashAlg::Sha256).to_string())
        .collect();
    let old_fps_str = if old_fps.is_empty() {
        "(unknown)".to_string()
    } else {
        old_fps.join("\r\n  ")
    };
    let banner = format!(
        "\r\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\r\n\
         @    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\n\
         @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\r\n\
         Host: {host}:{port}\r\nOld fingerprint:\r\n  {old_fps_str}\r\nNew: {fp} ({alg})\r\n\
         Type 'replace' to trust new key, anything else aborts.\r\n> "
    );
    let answer = match super::prompt::prompt_host_key(&ctx, &banner, true).await {
        Ok(a) => a,
        Err(_) => {
            set_mismatch();
            return Ok(false);
        }
    };
    if answer.trim() != "replace" {
        set_mismatch();
        return Ok(false);
    }
    match crate::ssh::known_hosts::remove_host(&host, port, &path) {
        Ok(n) => log(format!("Removed {n} stale entry/entries for {host}:{port}.")),
        Err(e) => {
            log(format!("Failed to remove old known_hosts entry: {e}"));
            set_mismatch();
            return Ok(false);
        }
    }
    match known_hosts::learn_known_hosts_path(&host, port, &pubkey, &path) {
        Ok(()) => log(format!("New host key for {host}:{port} added to known_hosts.")),
        Err(e) => log(format!("known_hosts write failed: {e}")),
    }
    Ok(true)
}

fn map_connect_error(e: russh::Error, host: &str, port: u16, mismatch: &StdMutex<bool>) -> AppError {
    let changed = mismatch.lock().map(|g| *g).unwrap_or(false);
    if changed {
        AppError::ssh("ssh_host_key_changed", json!({ "host": host, "port": port }))
    } else {
        AppError::ssh("ssh_connect_failed", json!({ "err": e.to_string() }))
    }
}

// ---------------------------------------------------------------------------
// connect：建立连接 + PTY + session_task
// ---------------------------------------------------------------------------

pub struct ConnectResult {
    pub session_id: String,
    pub handle: SshSessionHandle,
}

pub async fn connect(
    hostname: String,
    port: u16,
    auth_method: String,
    username: String,
    password: Option<String>,
    key_data: Option<(String, Option<String>)>,
    cols: u32,
    rows: u32,
    app: crate::emitter::Host,
    known_hosts_path: PathBuf,
    log_session_id: Option<String>,
) -> AppResult<ConnectResult> {
    let log: Arc<dyn Fn(String) + Send + Sync> = match log_session_id.clone() {
        Some(sid) => {
            let app2 = app.clone();
            Arc::new(move |msg: String| {
                let line = format!("\x1b[90m[ssh] {msg}\x1b[0m\r\n");
                let _ = app2.emit(&format!("terminal:output_raw:{sid}"), line.into_bytes());
            })
        }
        None => Arc::new(|_: String| ()),
    };

    let ctx = log_session_id.clone().map(|tab_id| AuthCtx { app: app.clone(), tab_id });
    let mismatch = Arc::new(StdMutex::new(false));

    let mut cfg = client::Config::default();
    cfg.keepalive_interval = Some(Duration::from_secs(30));
    cfg.keepalive_max = 3;
    let config = Arc::new(cfg);

    let handler = SshHandler {
        host: hostname.clone(),
        port,
        known_hosts_path,
        key_mismatch: mismatch.clone(),
        log: log.clone(),
        prompt_ctx: ctx.clone(),
    };

    let mut handle = match timeout(
        Duration::from_secs(10),
        client::connect(config, (hostname.as_str(), port), handler),
    )
    .await
    {
        Ok(result) => result.map_err(|e| map_connect_error(e, &hostname, port, &mismatch))?,
        Err(_) => return Err(AppError::ssh("ssh_connect_timeout", json!({ "host": hostname, "port": port }))),
    };

    super::auth::authenticate(&mut handle, &auth_method, username, password, key_data, ctx.as_ref()).await?;

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| AppError::ssh("ssh_open_channel_failed", json!({ "err": e.to_string() })))?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| AppError::ssh("ssh_pty_request_failed", json!({ "err": e.to_string() })))?;
    channel
        .request_shell(false)
        .await
        .map_err(|e| AppError::ssh("ssh_shell_request_failed", json!({ "err": e.to_string() })))?;

    let ssh_handle = Arc::new(Mutex::new(handle));
    let session_id = uuid::Uuid::new_v4().to_string();
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<SessionCmd>();
    let (output_tx, output_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let agent_capture: Arc<Mutex<Option<AgentCapture>>> = Arc::new(Mutex::new(None));
    let output_buffer: Arc<Mutex<VecDeque<u8>>> = Arc::new(Mutex::new(VecDeque::with_capacity(OUTPUT_BUFFER_CAP)));
    let system_info: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    let agent_capture2 = agent_capture.clone();
    let output_buffer2 = output_buffer.clone();
    let sid = session_id.clone();
    let app2 = app.clone();

    // 后台收集系统信息
    tokio::task::spawn_local({
        let ssh_h = ssh_handle.clone();
        let si = system_info.clone();
        async move {
            if let Ok(info) = collect_system_info(&ssh_h).await {
                *si.lock().await = Some(info);
            }
        }
    });

    // session_task：转发 PTY 输出 + 处理命令
    tokio::task::spawn_local(async move {
        session_task(
            sid,
            channel,
            cmd_rx,
            output_rx,
            agent_capture2,
            output_buffer2,
            app2,
        )
        .await;
    });

    Ok(ConnectResult {
        session_id,
        handle: SshSessionHandle {
            cmd_tx,
            ssh_handle,
            agent_capture,
            output_buffer,
            output_tx,
            system_info,
            host_skill_ids: Vec::new(),
        },
    })
}

// ---------------------------------------------------------------------------
// session_task：PTY 事件循环，带 AgentCapture 和 output_buffer
// ---------------------------------------------------------------------------

enum Event {
    Ssh(Option<ChannelMsg>),
    Cmd(Option<SessionCmd>),
    Inject(Option<Vec<u8>>),
}

async fn session_task(
    session_id: String,
    mut channel: russh::Channel<client::Msg>,
    mut cmd_rx: UnboundedReceiver<SessionCmd>,
    mut inject_rx: UnboundedReceiver<Vec<u8>>,
    agent_capture: Arc<Mutex<Option<AgentCapture>>>,
    output_buffer: Arc<Mutex<VecDeque<u8>>>,
    app: crate::emitter::Host,
) {
    loop {
        let event = tokio::select! {
            msg = channel.wait() => Event::Ssh(msg),
            cmd = cmd_rx.recv() => Event::Cmd(cmd),
            data = inject_rx.recv() => Event::Inject(data),
        };

        match event {
            Event::Ssh(Some(ChannelMsg::Data { data })) | Event::Ssh(Some(ChannelMsg::ExtendedData { data, .. })) => {
                let bytes = data.to_vec();

                // 更新 ring buffer (batch)
                {
                    let mut buf = output_buffer.lock().await;
                    if bytes.len() >= OUTPUT_BUFFER_CAP {
                        buf.clear();
                        buf.extend(bytes[bytes.len() - OUTPUT_BUFFER_CAP..].iter().copied());
                    } else {
                        let overflow = (buf.len() + bytes.len()).saturating_sub(OUTPUT_BUFFER_CAP);
                        if overflow > 0 { buf.drain(..overflow); }
                        buf.extend(bytes.iter().copied());
                    }
                }

                // feed AgentCapture; capture exit code to emit footer below
                let footer_exit_code: Option<i32> = {
                    let text = String::from_utf8_lossy(&bytes);
                    let mut cap = agent_capture.lock().await;
                    if let Some(c) = cap.as_mut() {
                        if let Some(result) = c.on_data_chunk(&text) {
                            let exit_code = result.exit_code;
                            let finished = cap.take().unwrap();
                            let _ = finished.result_tx.send(result);
                            Some(exit_code)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                };

                let _ = app.emit("terminal:output", serde_json::json!({
                    "session_id": session_id,
                    "data": bytes,
                }));

                // Emit footer in the same iteration so it precedes the next shell prompt
                if let Some(exit_code) = footer_exit_code {
                    let footer = format!("\x1b[1;33m[Agent] Exit: {}\x1b[0m\r\n", exit_code);
                    let _ = app.emit("terminal:output", serde_json::json!({
                        "session_id": session_id,
                        "data": footer.into_bytes(),
                    }));
                }
            }
            Event::Ssh(Some(ChannelMsg::Eof | ChannelMsg::Close)) | Event::Ssh(None) => break,
            Event::Cmd(Some(SessionCmd::Write(data))) => {
                use tokio::io::AsyncWriteExt as _;
                let mut w = channel.make_writer();
                let _ = w.write_all(&data).await;
            }
            Event::Cmd(Some(SessionCmd::Resize { cols, rows })) => {
                let _ = channel.window_change(cols, rows, 0, 0).await;
            }
            Event::Cmd(Some(SessionCmd::Close)) | Event::Cmd(None) => {
                let _ = channel.close().await;
                break;
            }
            // synthetic output（agent 命令头/尾）
            Event::Inject(Some(bytes)) => {
                let _ = app.emit("terminal:output", serde_json::json!({
                    "session_id": session_id,
                    "data": bytes,
                }));
            }
            Event::Inject(None) => {}
            _ => {}
        }
    }

    // Emit disconnect event so frontend can update status
    let _ = app.emit("terminal:disconnected", serde_json::json!({
        "session_id": session_id,
    }));
}

async fn collect_system_info(
    ssh_handle: &Arc<Mutex<russh::client::Handle<SshHandler>>>,
) -> AppResult<String> {
    let mut channel = {
        let h = ssh_handle.lock().await;
        h.channel_open_session()
            .await
            .map_err(|e| AppError::ssh("ssh_sysinfo_channel", json!({ "err": e.to_string() })))?
    };
    let cmd = "uname -a 2>/dev/null; echo '---'; hostname 2>/dev/null; echo '---'; uptime 2>/dev/null; echo '---'; df -h / 2>/dev/null; echo '---'; free -h 2>/dev/null || true";
    channel.exec(true, cmd).await
        .map_err(|e| AppError::ssh("ssh_sysinfo_exec", json!({ "err": e.to_string() })))?;

    let mut output = String::new();
    let deadline = Duration::from_secs(5);
    loop {
        let msg = match timeout(deadline, channel.wait()).await {
            Ok(Some(m)) => m,
            _ => break,
        };
        match msg {
            ChannelMsg::Data { ref data } => output.push_str(&String::from_utf8_lossy(data)),
            ChannelMsg::ExitStatus { .. } => {
                let _ = timeout(Duration::from_millis(300), channel.wait()).await;
                break;
            }
            _ => {}
        }
    }
    if output.len() > 2048 { output.truncate(2048); }
    Ok(output.trim().to_string())
}
