// src-tauri/src/state.rs
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::db::Database;
use crate::ssh::session::SshSessionHandle;

pub struct AppState {
    pub db: Arc<Database>,
    pub sessions: Mutex<HashMap<String, SshSessionHandle>>,
    /// kbd-interactive 多 prompt 回应：tab_id → sender
    pub auth_waiters: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Vec<String>>>>,
    /// 私钥 passphrase 提示：tab_id → sender
    pub passphrase_waiters: Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>,
    /// 主机密钥 TOFU 确认：tab_id → sender
    pub host_key_waiters: Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>,
    /// 进程内 passphrase 缓存，drop 时擦写
    pub passphrase_cache: Mutex<HashMap<String, zeroize::Zeroizing<String>>>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn new(db: Arc<Database>, data_dir: PathBuf) -> Self {
        Self {
            db,
            sessions: Mutex::new(HashMap::new()),
            auth_waiters: Mutex::new(HashMap::new()),
            passphrase_waiters: Mutex::new(HashMap::new()),
            host_key_waiters: Mutex::new(HashMap::new()),
            passphrase_cache: Mutex::new(HashMap::new()),
            data_dir,
        }
    }
}
