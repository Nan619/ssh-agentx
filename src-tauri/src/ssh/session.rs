// src-tauri/src/ssh/session.rs
use std::collections::VecDeque;
use std::sync::Arc;

use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::{oneshot, Mutex};

use crate::error::{AppError, AppResult};

/// 8 KiB 滚动输出缓冲（AI context 用）
pub const OUTPUT_BUFFER_CAP: usize = 8192;

/// agent_exec sentinel 捕获结果
pub struct CaptureResult {
    pub stdout: String,
    pub exit_code: i32,
}

/// PTY 输出的 sentinel 捕获状态
pub struct AgentCapture {
    pub uuid: String,
    pub buffer: String,
    pub start_found: bool,
    pub tail: String,
    pub result_tx: oneshot::Sender<CaptureResult>,
}

impl AgentCapture {
    pub fn on_data_chunk(&mut self, raw: &str) -> Option<CaptureResult> {
        let start_tag = format!("__AGENT_START_{}__", self.uuid);
        let end_prefix = format!("__AGENT_END_{}_", self.uuid);

        self.tail.push_str(raw);
        let working = std::mem::take(&mut self.tail);

        if !self.start_found {
            if let Some(pos) = working.find(&start_tag) {
                self.start_found = true;
                let after = &working[pos + start_tag.len()..];
                let after = after.trim_start_matches(['\r', '\n']);
                self.tail = after.to_string();
            } else {
                // Keep (tag.len() - 1) bytes so a tag starting at the last
                // preserved position can still complete in the next chunk.
                let keep = working.len().saturating_sub(start_tag.len() - 1);
                self.tail = working[keep..].to_string();
            }
            return None;
        }

        if let Some(pos) = working.find(&end_prefix) {
            self.buffer.push_str(&working[..pos]);
            let rest = &working[pos + end_prefix.len()..];
            let exit_code = rest
                .split("__")
                .next()
                .and_then(|s| s.parse::<i32>().ok())
                .unwrap_or(-1);
            let clean = strip_ansi_and_trim(&self.buffer);
            Some(CaptureResult { stdout: clean, exit_code })
        } else {
            // Keep (end_prefix.len() - 1 + 10) bytes for partial match + exit code
            let keep_from = working.len().saturating_sub(end_prefix.len() - 1 + 10);
            self.buffer.push_str(&working[..keep_from]);
            self.tail = working[keep_from..].to_string();
            None
        }
    }
}

fn strip_ansi_and_trim(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            for nc in chars.by_ref() {
                if nc.is_ascii_alphabetic() || nc == '~' { break; }
            }
        } else if c != '\r' {
            out.push(c);
        }
    }
    out.trim().to_string()
}

/// 活跃 SSH 会话的完整句柄（Clone + Send）。
#[derive(Clone)]
pub struct SshSessionHandle {
    /// PTY write / resize / close 命令通道
    pub cmd_tx: UnboundedSender<SessionCmd>,
    /// SSH handle，供系统信息收集等 exec channel 使用
    #[allow(dead_code)]
    pub ssh_handle: Arc<Mutex<russh::client::Handle<super::client::SshHandler>>>,
    /// agent_exec sentinel 捕获状态
    pub agent_capture: Arc<Mutex<Option<AgentCapture>>>,
    /// 滚动输出缓冲
    pub output_buffer: Arc<Mutex<VecDeque<u8>>>,
    /// 注入合成输出（agent 命令头/尾）不经 PTY
    pub output_tx: UnboundedSender<Vec<u8>>,
    /// 连接后后台收集的系统信息（uname/df/free）
    pub system_info: Arc<Mutex<Option<String>>>,
    /// 绑定到此主机的技能 ID 列表
    pub host_skill_ids: Vec<String>,
}

pub enum SessionCmd {
    Write(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

impl SshSessionHandle {
    pub fn write(&self, data: &[u8]) -> AppResult<()> {
        self.cmd_tx
            .send(SessionCmd::Write(data.to_vec()))
            .map_err(|_| AppError::ssh("ssh_session_closed", serde_json::json!({})))
    }

    pub fn resize(&self, cols: u32, rows: u32) -> AppResult<()> {
        self.cmd_tx
            .send(SessionCmd::Resize { cols, rows })
            .map_err(|_| AppError::ssh("ssh_session_closed", serde_json::json!({})))
    }

    pub fn force_close(&self) {
        let _ = self.cmd_tx.send(SessionCmd::Close);
    }
}
