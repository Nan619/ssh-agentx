// src-tauri/src/error.rs
use std::sync::{Mutex, MutexGuard};
use serde::Serialize;

/// i18n 错误消息：code 对应前端翻译键，params 用于占位符替换。
/// Display 输出形如 `__rssh_err__|{"code":"...","params":{...}}`。
#[derive(Debug, Clone)]
pub struct CodedMsg {
    pub code: &'static str,
    pub params: serde_json::Value,
}

impl CodedMsg {
    pub fn new(code: &'static str, params: serde_json::Value) -> Self {
        Self { code, params }
    }
}

impl std::fmt::Display for CodedMsg {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let payload = serde_json::json!({ "code": self.code, "params": &self.params });
        write!(f, "__rssh_err__|{payload}")
    }
}

impl std::error::Error for CodedMsg {}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Database(CodedMsg),
    #[error(transparent)]
    Io(CodedMsg),
    #[error("__rssh_err__|{{\"code\":\"lock_poisoned\",\"params\":{{}}}}")]
    Lock,
    #[error(transparent)]
    Ssh(CodedMsg),
    #[error(transparent)]
    NotFound(CodedMsg),
    #[error(transparent)]
    Config(CodedMsg),
    #[error(transparent)]
    Other(CodedMsg),
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Database(CodedMsg::new(
            "db_error",
            serde_json::json!({ "err": e.to_string() }),
        ))
    }
}

/// Database 层目前返回 `Result<T, String>`；此 impl 允许 `.map_err(AppError::from)` 直接用。
impl From<String> for AppError {
    fn from(e: String) -> Self {
        Self::Database(CodedMsg::new(
            "db_error",
            serde_json::json!({ "err": e }),
        ))
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(CodedMsg::new(
            "io_error",
            serde_json::json!({ "err": e.to_string() }),
        ))
    }
}

impl AppError {
    pub fn ssh(code: &'static str, params: serde_json::Value) -> Self {
        Self::Ssh(CodedMsg::new(code, params))
    }
    pub fn not_found(code: &'static str, params: serde_json::Value) -> Self {
        Self::NotFound(CodedMsg::new(code, params))
    }
    pub fn config(code: &'static str, params: serde_json::Value) -> Self {
        Self::Config(CodedMsg::new(code, params))
    }
    pub fn other(code: &'static str, params: serde_json::Value) -> Self {
        Self::Other(CodedMsg::new(code, params))
    }
    pub fn code(&self) -> &'static str {
        match self {
            Self::Database(c) | Self::Io(c) | Self::Ssh(c) | Self::NotFound(c)
            | Self::Config(c) | Self::Other(c) => c.code,
            Self::Lock => "lock_poisoned",
        }
    }
}

/// Acquire a std::sync::Mutex lock, mapping PoisonError to AppError::Lock.
pub fn locked<T>(m: &Mutex<T>) -> AppResult<MutexGuard<'_, T>> {
    m.lock().map_err(|_| AppError::Lock)
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
