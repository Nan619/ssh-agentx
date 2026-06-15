// src-tauri/src/emitter.rs
//! Transport-agnostic host context（仅 Tauri 变体）。

use serde::Serialize;

#[derive(Clone)]
pub enum Host {
    Tauri(tauri::AppHandle),
}

impl Host {
    pub fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) -> tauri::Result<()> {
        match self {
            Host::Tauri(app) => {
                use tauri::Emitter as _;
                app.emit(event, payload)
            }
        }
    }
}
