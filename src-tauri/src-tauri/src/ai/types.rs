use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiAskRequest {
    pub question: String,
    pub json_text: String,
    pub current_path: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiDiagnostics {
    pub latency_ms: u128,
    pub tokens_used: usize,
    pub fallback_used: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiAskResponse {
    pub answer_text: String,
    pub jump_path: Option<Vec<String>>,
    pub diagnostics: AiDiagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiHealthResponse {
    pub healthy: bool,
    pub model_loaded: bool,
    pub model_path: Option<String>,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("AI engine busy; try again in a second.")]
    Busy,
    #[error("Question is empty.")]
    EmptyQuestion,
    #[error("Input JSON payload is too large.")]
    InputTooLarge,
    #[error("Invalid JSON payload: {0}")]
    InvalidJson(String),
    #[error("Model artifacts not found: {0}")]
    ModelUnavailable(String),
    #[error("Inference error: {0}")]
    Inference(String),
}
