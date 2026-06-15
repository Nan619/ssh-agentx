// src-tauri/src/commands/host.rs
use tauri::State;
use uuid::Uuid;

use crate::db::{SshGroup, SshHost, SshKeySummary};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[tauri::command]
pub async fn list_hosts(state: State<'_, AppState>) -> AppResult<Vec<SshHost>> {
    state.db.list_hosts().map_err(AppError::from)
}

#[tauri::command]
pub async fn create_host(state: State<'_, AppState>, host: SshHost) -> AppResult<SshHost> {
    let mut host = host;
    if host.id.is_empty() {
        host.id = Uuid::new_v4().to_string();
    }
    state.db.insert_host(&host).map_err(AppError::from)?;
    Ok(host)
}

#[tauri::command]
pub async fn update_host(state: State<'_, AppState>, host: SshHost) -> AppResult<SshHost> {
    state.db.update_host(&host).map_err(AppError::from)?;
    Ok(host)
}

#[tauri::command]
pub async fn delete_host(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.delete_host(&id).map_err(AppError::from)
}

#[tauri::command]
pub async fn list_groups(state: State<'_, AppState>) -> AppResult<Vec<SshGroup>> {
    state.db.list_groups().map_err(AppError::from)
}

#[tauri::command]
pub async fn create_group(state: State<'_, AppState>, group: SshGroup) -> AppResult<SshGroup> {
    let mut group = group;
    if group.id.is_empty() {
        group.id = Uuid::new_v4().to_string();
    }
    state.db.insert_group(&group).map_err(AppError::from)?;
    Ok(group)
}

#[tauri::command]
pub async fn delete_group(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.delete_group(&id).map_err(AppError::from)
}

#[tauri::command]
pub async fn update_group(state: State<'_, AppState>, group: SshGroup) -> AppResult<SshGroup> {
    state.db.update_group(&group).map_err(AppError::from)?;
    Ok(group)
}

#[tauri::command]
pub async fn list_keys(state: State<'_, AppState>) -> AppResult<Vec<SshKeySummary>> {
    state.db.list_keys().map_err(AppError::from)
}

#[tauri::command]
pub async fn create_key(
    state: State<'_, AppState>,
    name: String,
    pem: String,
    passphrase: Option<String>,
) -> AppResult<SshKeySummary> {
    let id = Uuid::new_v4().to_string();
    state.db.insert_key(&id, &name, &pem, passphrase.as_deref()).map_err(AppError::from)?;
    Ok(SshKeySummary { id, name })
}

#[tauri::command]
pub async fn update_key(state: State<'_, AppState>, id: String, name: String) -> AppResult<SshKeySummary> {
    state.db.update_key(&id, &name).map_err(|e| {
        if e.contains("key not found") {
            AppError::not_found("key_not_found", serde_json::json!({ "id": &id }))
        } else {
            AppError::from(e)
        }
    })?;
    Ok(SshKeySummary { id, name })
}

#[tauri::command]
pub async fn delete_key(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.delete_key(&id).map_err(AppError::from)
}
