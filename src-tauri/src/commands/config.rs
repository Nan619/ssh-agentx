// src-tauri/src/commands/config.rs
use tauri::State;
use uuid::Uuid;

use crate::db::ModelConfig;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[tauri::command]
pub async fn list_model_configs(state: State<'_, AppState>) -> AppResult<Vec<ModelConfig>> {
    state.db.list_models().map_err(AppError::from)
}

#[tauri::command]
pub async fn save_model_config(state: State<'_, AppState>, model: ModelConfig) -> AppResult<ModelConfig> {
    let mut model = model;
    if model.id.is_empty() {
        model.id = Uuid::new_v4().to_string();
    }
    state.db.save_model(&model).map_err(AppError::from)?;
    Ok(model)
}

#[tauri::command]
pub async fn delete_model_config(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.delete_model(&id).map_err(AppError::from)
}

#[tauri::command]
pub async fn set_active_model(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.set_active_model(&id).map_err(AppError::from)
}

#[tauri::command]
pub async fn get_active_model(state: State<'_, AppState>) -> AppResult<Option<ModelConfig>> {
    state.db.get_active_model().map_err(AppError::from)
}
