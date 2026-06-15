use std::time::Duration;

use futures::stream::{BoxStream, StreamExt};
use reqwest::Client;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct ChatChunk {
    pub content: String,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ChatOptions {
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub top_p: f32,
}

pub trait AiProvider: Send + Sync {
    fn chat_stream(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
    ) -> BoxStream<'static, Result<ChatChunk, String>>;
}

/// Create an HTTP client with sensible timeouts for AI API calls.
fn timed_client() -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(120))
        .build()
        .unwrap_or_default()
}

pub enum ProviderConfig {
    OpenAI {
        api_key: String,
        base_url: Option<String>,
    },
    Anthropic {
        api_key: String,
    },
    Ollama {
        base_url: String,
    },
    CustomOpenAI {
        api_key: String,
        base_url: String,
    },
}

/// OpenAI provider
pub struct OpenAiProvider {
    client: Client,
    api_key: String,
    base_url: String,
}

impl OpenAiProvider {
    pub fn new(api_key: String, base_url: Option<String>) -> Self {
        Self {
            client: timed_client(),
            api_key,
            base_url: base_url.unwrap_or_else(|| "https://api.openai.com/v1".into()),
        }
    }
}

impl AiProvider for OpenAiProvider {
    fn chat_stream(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
    ) -> BoxStream<'static, Result<ChatChunk, String>> {
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        let base_url = self.base_url.clone();
        let msgs = messages.to_vec();
        let opts = options.clone();

        let stream = async_stream::stream! {
            let body = serde_json::json!({
                "model": opts.model,
                "messages": msgs.iter().map(|m| serde_json::json!({
                    "role": m.role,
                    "content": m.content,
                })).collect::<Vec<_>>(),
                "temperature": opts.temperature,
                "max_tokens": opts.max_tokens,
                "top_p": opts.top_p,
                "stream": true,
            });

            let response = match client
                .post(format!("{}/chat/completions", base_url))
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    yield Err(format!("Request failed: {}", e));
                    return;
                }
            };

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                yield Err(format!("API error {}: {}", status, body));
                return;
            }

            let mut byte_stream = response.bytes_stream();
            let mut buffer = String::new();

            while let Some(chunk) = byte_stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(_) => { yield Err("Stream error".into()); return; }
                };
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                // Split into complete lines vs incomplete tail.
                // str::lines() cannot tell whether the last segment ends
                // with \n, so we split on the last \n position instead.
                let last_nl = buffer.rfind('\n');
                let (complete, tail) = match last_nl {
                    Some(pos) => (&buffer[..pos], &buffer[pos + 1..]),
                    None => { /* no newline at all — entire buffer is incomplete */
                        continue;
                    }
                };

                for line in complete.lines() {
                    let line = line.trim();
                    if line.is_empty() { continue; }
                    if line == "data: [DONE]" {
                        yield Ok(ChatChunk {
                            content: String::new(),
                            finish_reason: Some("stop".into()),
                        });
                        return;
                    }
                    if let Some(data) = line.strip_prefix("data: ") {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(choices) = parsed["choices"].as_array() {
                                if let Some(choice) = choices.first() {
                                    let delta = &choice["delta"];
                                    let content = delta["content"].as_str().unwrap_or("").to_string();
                                    let finish_reason = choice["finish_reason"].as_str().map(|s| s.to_string());
                                    if !content.is_empty() || finish_reason.is_some() {
                                        yield Ok(ChatChunk { content, finish_reason });
                                    }
                                }
                            }
                        }
                    }
                }
                buffer = tail.to_string();
            }
        };

        stream.boxed()
    }
}

/// Anthropic provider
pub struct AnthropicProvider {
    client: Client,
    api_key: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String) -> Self {
        Self {
            client: timed_client(),
            api_key,
        }
    }
}

impl AiProvider for AnthropicProvider {
    fn chat_stream(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
    ) -> BoxStream<'static, Result<ChatChunk, String>> {
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        let msgs = messages.to_vec();
        let opts = options.clone();

        let stream = async_stream::stream! {
            let system: Vec<_> = msgs.iter().filter(|m| m.role == "system").collect();
            let conversation: Vec<_> = msgs.iter().filter(|m| m.role != "system").collect();

            let mut body = serde_json::json!({
                "model": opts.model,
                "max_tokens": opts.max_tokens,
                "temperature": opts.temperature,
                "top_p": opts.top_p,
                "messages": conversation.iter().map(|m| serde_json::json!({
                    "role": m.role,
                    "content": m.content,
                })).collect::<Vec<_>>(),
                "stream": true,
            });

            if !system.is_empty() {
                body["system"] = serde_json::json!(system.first().unwrap().content);
            }

            let response = match client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    yield Err(format!("Request failed: {}", e));
                    return;
                }
            };

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                yield Err(format!("API error {}: {}", status, body));
                return;
            }

            let mut byte_stream = response.bytes_stream();
            let mut buffer = String::new();

            while let Some(chunk) = byte_stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(_) => { yield Err("Stream error".into()); return; }
                };
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                let last_nl = buffer.rfind('\n');
                let (complete, tail) = match last_nl {
                    Some(pos) => (&buffer[..pos], &buffer[pos + 1..]),
                    None => { continue; }
                };

                for line in complete.lines() {
                    let line = line.trim();
                    if line.is_empty() { continue; }
                    if let Some(data) = line.strip_prefix("data: ") {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                            match parsed["type"].as_str() {
                                Some("content_block_delta") => {
                                    if let Some(text) = parsed["delta"]["text"].as_str() {
                                        yield Ok(ChatChunk {
                                            content: text.to_string(),
                                            finish_reason: None,
                                        });
                                    }
                                }
                                Some("message_stop") => {
                                    yield Ok(ChatChunk {
                                        content: String::new(),
                                        finish_reason: Some("stop".into()),
                                    });
                                    return;
                                }
                                _ => {}
                            }
                        }
                    }
                }
                buffer = tail.to_string();
            }
        };

        stream.boxed()
    }
}

/// Factory
pub fn create_provider(config: &ProviderConfig) -> Box<dyn AiProvider> {
    match config {
        ProviderConfig::OpenAI { api_key, base_url } => {
            Box::new(OpenAiProvider::new(api_key.clone(), base_url.clone()))
        }
        ProviderConfig::Anthropic { api_key } => {
            Box::new(AnthropicProvider::new(api_key.clone()))
        }
        ProviderConfig::Ollama { base_url } => {
            Box::new(OpenAiProvider::new(
                "ollama".to_string(),
                Some(format!("{}/v1", base_url)),
            ))
        }
        ProviderConfig::CustomOpenAI { api_key, base_url } => {
            Box::new(OpenAiProvider::new(api_key.clone(), Some(base_url.clone())))
        }
    }
}
