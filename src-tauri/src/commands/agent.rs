// src-tauri/src/commands/agent.rs
use futures::StreamExt;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::agent::context::HostContext;
use crate::agent::provider::{self, AiProvider, ChatMessage, ChatOptions, ProviderConfig};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

fn select_conversation_skills(
    all_skills: &[crate::db::Skill],
    user_message: &str,
    exclude_ids: &[String],
) -> Vec<crate::db::Skill> {
    let msg_lower = user_message.to_lowercase();
    let msg_tokens: std::collections::HashSet<&str> = msg_lower
        .split(|c: char| matches!(c, '，' | '。' | '？' | '！' | ',' | '.' | '?' | '!' | ' ' | '\t' | '\n'))
        .filter(|s| s.len() > 1)
        .collect();

    let exclude: std::collections::HashSet<&str> = exclude_ids.iter().map(|s| s.as_str()).collect();

    let mut scored: Vec<(usize, &crate::db::Skill)> = all_skills
        .iter()
        .filter(|sk| !exclude.contains(sk.id.as_str()))
        .filter_map(|sk| {
            let haystack = format!("{} {} {}", sk.name, sk.description, sk.tags).to_lowercase();
            let score = msg_tokens.iter().filter(|t| haystack.contains(*t)).count();
            if score > 0 { Some((score, sk)) } else { None }
        })
        .collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().take(2).map(|(_, sk)| sk.clone()).collect()
}

pub type SharedAgentState = Mutex<AgentStateInner>;

pub struct AgentStateInner {
    pub provider: Option<Box<dyn AiProvider>>,
    pub chat_options: ChatOptions,
    pub system_prompt: String,
}

impl AgentStateInner {
    pub fn new() -> Self {
        Self {
            provider: None,
            chat_options: ChatOptions {
                model: "gpt-4o".to_string(),
                temperature: 0.7,
                max_tokens: 4096,
                top_p: 1.0,
            },
            system_prompt: crate::agent::context::OPS_AGENT_PROMPT.to_string(),
        }
    }

    pub fn set_provider(&mut self, config: ProviderConfig) {
        self.provider = Some(provider::create_provider(&config));
    }
}

#[derive(serde::Deserialize)]
pub struct AgentChatRequest {
    pub messages: Vec<ChatMessage>,
    pub host_context: Option<HostContext>,
    /// Recent terminal output to include as context (up to 8 KiB).
    pub terminal_context: Option<String>,
    /// SSH session ID to pull live system_info from (if available).
    pub session_id: Option<String>,
}

#[tauri::command]
pub async fn agent_chat(
    app: AppHandle,
    agent_state: State<'_, SharedAgentState>,
    app_state: State<'_, AppState>,
    request: AgentChatRequest,
) -> AppResult<String> {
    eprintln!("[agent_chat] called with {} messages", request.messages.len());

    // Resolve system_info and host_skill_ids from the active SSH session.
    // Use a block so the std Mutex guard is dropped before any .await.
    let (system_info, host_skill_ids): (Option<String>, Vec<String>) =
        if let Some(ref sid) = request.session_id {
            let sessions = app_state.sessions.lock()
                .map_err(|_| AppError::Lock)?;
            if let Some(session) = sessions.get(sid) {
                let info = session.system_info.try_lock().ok().and_then(|g| g.clone());
                let ids = session.host_skill_ids.clone();
                (info, ids)
            } else {
                (None, Vec::new())
            }
        } else {
            (None, Vec::new())
        };

    // Load all enabled skills (outside the agent_state lock to avoid blocking)
    let all_skills = app_state.db.list_skills_full().unwrap_or_default();

    // Resolve Host Skills for this session
    let host_skills: Vec<crate::db::Skill> = all_skills
        .iter()
        .filter(|sk| host_skill_ids.contains(&sk.id))
        .cloned()
        .collect();

    // Resolve Conversation Skills by matching user message tokens against skill metadata
    let user_message_text = request.messages.last()
        .map(|m| m.content.as_str())
        .unwrap_or("");
    let conv_skills = select_conversation_skills(&all_skills, user_message_text, &host_skill_ids);

    // Build full message list under the lock
    let (messages, chat_options, provider_exists) = {
        let agent_st = agent_state.lock().await;

        let mut system_content = agent_st.system_prompt.clone();

        // Inject host context
        if let Some(ref ctx) = request.host_context {
            system_content.push_str("\n\n");
            system_content.push_str(&ctx.to_system_prompt());
        }

        // Inject live system info
        if let Some(ref info) = system_info {
            if !info.is_empty() {
                system_content.push_str("\n\n## 服务器系统信息\n```\n");
                system_content.push_str(info);
                system_content.push_str("\n```");
            }
        }

        // Inject Host Skills context
        let host_skill_ctx = crate::agent::context::build_skill_context(&host_skills);
        if !host_skill_ctx.is_empty() {
            system_content.push_str(&host_skill_ctx);
        }

        // Inject Conversation Skills context
        let conv_skill_ctx = crate::agent::context::build_skill_context(&conv_skills);
        if !conv_skill_ctx.is_empty() {
            system_content.push_str(&conv_skill_ctx);
        }

        // Inject recent terminal output
        if let Some(ref ctx) = request.terminal_context {
            if !ctx.is_empty() {
                let trimmed = if ctx.len() > 4096 {
                    &ctx[ctx.len() - 4096..]
                } else {
                    ctx.as_str()
                };
                system_content.push_str("\n\n## 近期终端输出\n```\n");
                system_content.push_str(trimmed);
                system_content.push_str("\n```");
            }
        }

        let mut messages: Vec<ChatMessage> = Vec::new();
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: system_content,
        });
        messages.extend(request.messages);

        let has_provider = agent_st.provider.is_some();
        let opts = agent_st.chat_options.clone();
        eprintln!("[agent_chat] provider_exists={}, model={}", has_provider, opts.model);

        (messages, opts, has_provider)
    };

    if !provider_exists {
        let err_msg = "没有配置 AI 模型，请在设置中配置并激活一个模型";
        let _ = app.emit("agent:error", serde_json::json!({ "error": err_msg }));
        return Err(AppError::other("no_provider_configured", serde_json::json!({})));
    }

    // Emit conversation skill IDs to frontend before streaming begins
    let conv_skill_ids: Vec<String> = conv_skills.iter().map(|s| s.id.clone()).collect();
    let _ = app.emit("agent:conv_skills", serde_json::json!({
        "session_id": request.session_id.as_deref().unwrap_or(""),
        "ids": conv_skill_ids,
    }));

    // Stream the response
    let mut stream = {
        let agent_st = agent_state.lock().await;
        let provider = agent_st.provider.as_ref().unwrap();
        provider.chat_stream(&messages, &chat_options)
    };

    let app_handle = app.clone();
    let mut full_response = String::new();

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(c) => {
                full_response.push_str(&c.content);
                let _ = app_handle.emit(
                    "agent:chunk",
                    serde_json::json!({
                        "content": c.content,
                        "finish_reason": c.finish_reason,
                    }),
                );
            }
            Err(e) => {
                let _ = app_handle.emit("agent:error", serde_json::json!({ "error": e }));
                return Err(AppError::other("provider_error", serde_json::json!({ "err": e })));
            }
        }
    }

    Ok(full_response)
}

#[derive(serde::Deserialize)]
pub struct ConfigureProviderRequest {
    pub provider_type: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: String,
    pub temperature: Option<f32>,
}

#[tauri::command]
pub async fn configure_provider(
    state: State<'_, SharedAgentState>,
    request: ConfigureProviderRequest,
) -> AppResult<()> {
    eprintln!("[configure_provider] type={}, model={}, base_url={:?}",
        request.provider_type, request.model, request.base_url);

    let config = match request.provider_type.as_str() {
        "openai" => ProviderConfig::OpenAI {
            api_key: request.api_key.ok_or_else(|| AppError::config("api_key_required", serde_json::json!({})))?,
            base_url: request.base_url,
        },
        "anthropic" => ProviderConfig::Anthropic {
            api_key: request.api_key.ok_or_else(|| AppError::config("api_key_required", serde_json::json!({})))?,
        },
        "ollama" => ProviderConfig::Ollama {
            base_url: request.base_url.unwrap_or_else(|| "http://localhost:11434".into()),
        },
        "custom" | "deepseek" => ProviderConfig::CustomOpenAI {
            api_key: request.api_key.unwrap_or_default(),
            base_url: request.base_url.ok_or_else(|| AppError::config("base_url_required", serde_json::json!({})))?,
        },
        _ => return Err(AppError::other("unknown_provider_type", serde_json::json!({ "type": request.provider_type }))),
    };

    let mut chat_options = ChatOptions {
        model: request.model,
        ..state.lock().await.chat_options.clone()
    };

    if let Some(temp) = request.temperature {
        chat_options.temperature = temp;
    }

    let mut agent_state = state.lock().await;
    agent_state.set_provider(config);
    agent_state.chat_options = chat_options;

    Ok(())
}
