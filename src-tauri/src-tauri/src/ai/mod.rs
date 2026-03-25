mod engine;
mod prompt;
mod qwen;
mod types;

pub use types::{AiAskRequest, AiAskResponse, AiHealthResponse};
pub use qwen::AiModelState;

use std::time::Instant;
use types::AiDiagnostics;

const MAX_ASK_JSON_CHARS: usize = 60_000;

#[tauri::command]
pub fn ai_health(state: tauri::State<'_, AiModelState>) -> Result<AiHealthResponse, String> {
    Ok(AiHealthResponse {
        healthy: true,
        model_loaded: true,
        model_path: Some(state.model_path.clone()),
        message: "Local Qwen runtime ready.".to_string(),
    })
}

#[tauri::command]
pub fn ai_ask(
    state: tauri::State<'_, AiModelState>,
    question: String,
    json_text: String,
    current_path: Vec<String>,
) -> Result<AiAskResponse, String> {
    let question_trimmed = question.trim().to_string();
    if question_trimmed.is_empty() {
        return Err("Question is empty.".to_string());
    }

    let prompt = format!(
        "Question:\n{}\n\nCurrent path:\n{}\n\nJSON:\n{}",
        question_trimmed,
        if current_path.is_empty() {
            "Home".to_string()
        } else {
            format!("Home > {}", current_path.join(" > "))
        },
        if json_text.len() > MAX_ASK_JSON_CHARS {
            &json_text[..MAX_ASK_JSON_CHARS]
        } else {
            &json_text
        }
    );

    let jump_path = if current_path.is_empty() {
        None
    } else {
        Some(current_path)
    };

    let started = Instant::now();
    let runtime = state
        .runtime
        .lock()
        .map_err(|_| "ai runtime lock poisoned".to_string())?;
    let answer_text = runtime.analyze_json(&prompt)?;
    let latency_ms = started.elapsed().as_millis();
    Ok(AiAskResponse {
        answer_text,
        jump_path,
        diagnostics: AiDiagnostics {
            latency_ms,
            tokens_used: 0,
            fallback_used: false,
        },
    })
}

#[tauri::command]
pub fn ai_analyze_json(
    state: tauri::State<'_, AiModelState>,
    json_snippet: String,
) -> Result<String, String> {
    qwen::ai_analyze_json_impl(state, json_snippet)
}
