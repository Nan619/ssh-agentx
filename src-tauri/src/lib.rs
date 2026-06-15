// src-tauri/src/lib.rs
mod agent;
mod commands;
mod db;
mod emitter;
mod error;
mod ssh;
mod state;

use std::sync::Arc;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            std::fs::create_dir_all(&app_dir).ok();

            let database = db::Database::new(app_dir.clone())
                .expect("Failed to initialize database");
            let db = Arc::new(database);

            let app_state = state::AppState::new(db, app_dir);
            app.manage(app_state);
            app.manage(commands::agent::SharedAgentState::new(
                commands::agent::AgentStateInner::new(),
            ));

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // SSH
            commands::ssh::ssh_connect,
            commands::ssh::ssh_disconnect,
            commands::ssh::terminal_input,
            commands::ssh::terminal_resize,
            commands::ssh::agent_exec,
            commands::ssh::get_terminal_output,
            // known_hosts / passphrase / auth
            commands::ssh::ssh_host_key_respond,
            commands::ssh::ssh_host_key_cancel,
            commands::ssh::ssh_passphrase_respond,
            commands::ssh::ssh_passphrase_cancel,
            commands::ssh::ssh_auth_respond,
            commands::ssh::ssh_auth_cancel,
            // Host CRUD
            commands::host::list_hosts,
            commands::host::create_host,
            commands::host::update_host,
            commands::host::delete_host,
            // Groups
            commands::host::list_groups,
            commands::host::create_group,
            commands::host::delete_group,
            commands::host::update_group,
            // SSH Keys
            commands::host::list_keys,
            commands::host::create_key,
            commands::host::update_key,
            commands::host::delete_key,
            // Skills
            commands::skill::list_skills,
            commands::skill::get_skill,
            commands::skill::create_skill,
            commands::skill::update_skill,
            commands::skill::delete_skill,
            // SCP file transfer
            commands::scp::scp_upload,
            commands::scp::scp_download,
            commands::scp::scp_extract_path,
            // Model configs
            commands::config::list_model_configs,
            commands::config::save_model_config,
            commands::config::delete_model_config,
            commands::config::set_active_model,
            commands::config::get_active_model,
            // Agent
            commands::agent::agent_chat,
            commands::agent::configure_provider,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
