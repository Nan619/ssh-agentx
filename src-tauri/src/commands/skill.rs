use tauri::State;
use uuid::Uuid;

use crate::db::{Skill, SkillSummary};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct SkillInput {
    pub name: String,
    pub description: String,
    pub tags: String,
    pub content: String,
}

#[tauri::command]
pub async fn list_skills(state: State<'_, AppState>) -> AppResult<Vec<SkillSummary>> {
    state.db.list_skills().map_err(AppError::from)
}

#[tauri::command]
pub async fn get_skill(state: State<'_, AppState>, id: String) -> AppResult<Skill> {
    state
        .db
        .get_skill(&id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::not_found("skill_not_found", serde_json::json!({ "id": id })))
}

#[tauri::command]
pub async fn create_skill(
    state: State<'_, AppState>,
    skill: SkillInput,
) -> AppResult<SkillSummary> {
    if skill.name.trim().is_empty() {
        return Err(AppError::config("skill_name_empty", serde_json::json!({})));
    }
    let id = Uuid::new_v4().to_string();
    let full = Skill {
        id: id.clone(),
        name: skill.name.clone(),
        description: skill.description.clone(),
        tags: skill.tags.clone(),
        content: skill.content,
        enabled: 1,
    };
    state.db.insert_skill(&full).map_err(AppError::from)?;
    Ok(SkillSummary {
        id,
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
        enabled: 1,
    })
}

#[tauri::command]
pub async fn update_skill(
    state: State<'_, AppState>,
    id: String,
    skill: SkillInput,
    enabled: i32,
) -> AppResult<SkillSummary> {
    if skill.name.trim().is_empty() {
        return Err(AppError::config("skill_name_empty", serde_json::json!({})));
    }
    let full = Skill {
        id: id.clone(),
        name: skill.name.clone(),
        description: skill.description.clone(),
        tags: skill.tags.clone(),
        content: skill.content,
        enabled,
    };
    state.db.update_skill(&full).map_err(|e| {
        if e.contains("skill not found") {
            AppError::not_found("skill_not_found", serde_json::json!({ "id": &id }))
        } else {
            AppError::from(e)
        }
    })?;
    Ok(SkillSummary {
        id,
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
        enabled,
    })
}

#[tauri::command]
pub async fn delete_skill(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.delete_skill(&id).map_err(AppError::from)
}
