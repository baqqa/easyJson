use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde_json::Value;

use super::prompt::build_context_snippets;
use super::types::{AiAskRequest, AiAskResponse, AiDiagnostics, AiError, AiHealthResponse};

const MAX_INPUT_CHARS: usize = 1_500_000;
const MAX_NEW_TOKENS: usize = 160;
const DEFAULT_TEMPERATURE: f32 = 0.2;
const REQUEST_TIMEOUT_MS: u128 = 12_000;

#[derive(Debug, Clone)]
struct ModelConfig {
    model_dir: PathBuf,
    gguf_file: Option<PathBuf>,
    runner_cmd: String,
    max_input_chars: usize,
    max_new_tokens: usize,
    temperature: f32,
}

#[derive(Debug)]
pub struct AiEngine {
    config: ModelConfig,
    model_loaded: bool,
    // request-level mutual exclusion so multiple heavy runs do not overlap
    busy: Mutex<()>,
}

static ENGINE: OnceLock<AiEngine> = OnceLock::new();

impl AiEngine {
    pub fn global() -> &'static AiEngine {
        ENGINE.get_or_init(Self::new)
    }

    fn new() -> Self {
        let default_model_dir =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../models/qwen2.5-0.5b");

        let model_dir = match std::env::var("EASYJSON_MODEL_DIR") {
            Ok(raw) => {
                let p = PathBuf::from(raw);
                if p.is_absolute() {
                    p
                } else {
                    // Make relative env paths predictable (relative to this crate).
                    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(p)
                }
            }
            Err(_) => default_model_dir,
        };
        let gguf_file = find_first_gguf(&model_dir);
        let runner_cmd = std::env::var("EASYJSON_LLM_RUNNER").unwrap_or_else(|_| "llama-cli".to_string());

        let config = ModelConfig {
            model_dir,
            gguf_file,
            runner_cmd,
            max_input_chars: MAX_INPUT_CHARS,
            max_new_tokens: MAX_NEW_TOKENS,
            temperature: DEFAULT_TEMPERATURE,
        };

        let model_loaded = config.gguf_file.is_some();

        Self {
            config,
            model_loaded,
            busy: Mutex::new(()),
        }
    }

    pub fn health(&self) -> AiHealthResponse {
        let message = if self.model_loaded {
            format!(
                "GGUF model detected. Runner command: {}",
                self.config.runner_cmd
            )
        } else {
            "GGUF model missing. Place a .gguf file in configured model directory."
                .to_string()
        };

        AiHealthResponse {
            healthy: self.model_loaded,
            model_loaded: self.model_loaded,
            model_path: Some(self.config.model_dir.display().to_string()),
            message,
        }
    }

    pub fn ask(&self, req: AiAskRequest) -> Result<AiAskResponse, AiError> {
        let lock = self.busy.try_lock().map_err(|_| AiError::Busy)?;
        let _guard = lock;

        if req.question.trim().is_empty() {
            return Err(AiError::EmptyQuestion);
        }
        if req.json_text.len() > self.config.max_input_chars {
            return Err(AiError::InputTooLarge);
        }

        let started = Instant::now();
        let root: Value = serde_json::from_str(&req.json_text)
            .map_err(|e| AiError::InvalidJson(e.to_string()))?;

        let snippets = build_context_snippets(&root, &req.question, &req.current_path, 8);

        let (answer_text, jump_path, fallback_used) = if self.model_loaded {
            match self.run_gguf_inference(&req.question, &snippets) {
                Ok(text) => {
                    let mut paths = Vec::<Vec<String>>::new();
                    collect_key_paths(&root, &req.question.to_lowercase(), &mut Vec::new(), &mut paths, 20);
                    (text, paths.first().cloned(), false)
                }
                Err(_) => {
                    let answer = self.rule_answer(&root, &req.question, &snippets);
                    (answer.0, answer.1, true)
                }
            }
        } else {
            let answer = self.rule_answer(&root, &req.question, &snippets);
            (answer.0, answer.1, true)
        };
        let tokens_used = answer_text
            .split_whitespace()
            .count()
            .min(self.config.max_new_tokens);

        let elapsed = started.elapsed().as_millis();
        if elapsed > REQUEST_TIMEOUT_MS {
            return Err(AiError::Inference("Request timed out.".to_string()));
        }

        Ok(AiAskResponse {
            answer_text,
            jump_path,
            diagnostics: AiDiagnostics {
                latency_ms: elapsed,
                tokens_used,
                fallback_used,
            },
        })
    }

    fn run_gguf_inference(&self, question: &str, snippets: &[String]) -> Result<String, AiError> {
        let gguf = self
            .config
            .gguf_file
            .as_ref()
            .ok_or_else(|| AiError::ModelUnavailable("No .gguf file found.".to_string()))?;

        let prompt = format!(
            "You are a local JSON assistant. Answer concisely and mention JSON path hints when useful.\n\nContext:\n{}\n\nQuestion:\n{}\n\nAnswer:",
            snippets.join("\n"),
            question
        );

        let output = Command::new(&self.config.runner_cmd)
            .arg("-m")
            .arg(gguf)
            .arg("-p")
            .arg(&prompt)
            .arg("-n")
            .arg(self.config.max_new_tokens.to_string())
            .arg("--temp")
            .arg(format!("{:.2}", self.config.temperature))
            .arg("--ctx-size")
            .arg("2048")
            .arg("--no-display-prompt")
            .output()
            .map_err(|e| {
                AiError::Inference(format!(
                    "Failed to launch runner '{}': {e}. Set EASYJSON_LLM_RUNNER to your llama-cli path.",
                    self.config.runner_cmd
                ))
            })?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(AiError::Inference(format!(
                "Runner exited with status {}: {}",
                output.status,
                if err.is_empty() { "unknown error" } else { &err }
            )));
        }

        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let cleaned = raw
            .strip_prefix(&prompt)
            .map(|s| s.trim().to_string())
            .unwrap_or(raw);

        if cleaned.is_empty() {
            return Err(AiError::Inference("Runner returned empty output.".to_string()));
        }

        Ok(cleaned)
    }

    fn rule_answer(
        &self,
        root: &Value,
        question: &str,
        snippets: &[String],
    ) -> (String, Option<Vec<String>>) {
        let q = question.to_lowercase();
        let mut paths = Vec::<Vec<String>>::new();
        collect_key_paths(root, &q, &mut Vec::new(), &mut paths, 20);

        if q.contains("top") && q.contains("key") {
            if let Value::Object(map) = root {
                let list = map.keys().take(20).cloned().collect::<Vec<_>>().join(", ");
                return (format!("Top-level keys: {}", list), None);
            }
        }

        if q.contains("count") || q.contains("how many") {
            return (
                format!("I found {} likely path match(es).\n{}", paths.len(), snippets.join("\n")),
                paths.first().cloned(),
            );
        }

        if q.contains("where") || q.contains("path") {
            if paths.is_empty() {
                return ("No matching path found.".to_string(), None);
            }
            let first = paths[0].join(" > ");
            return (
                format!("Closest match path: Home > {}\n{}", first, snippets.join("\n")),
                Some(paths[0].clone()),
            );
        }

        (
            format!(
                "Local AI fallback (rule-based):\n{}\n\nQuestion: {}\nTip: ask count/where/top keys for stronger answers.",
                snippets.join("\n"),
                question
            ),
            paths.first().cloned(),
        )
    }
}

fn find_first_gguf(model_dir: &PathBuf) -> Option<PathBuf> {
    let entries = std::fs::read_dir(model_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("gguf"))
            .unwrap_or(false)
        {
            return Some(path);
        }
    }
    None
}

fn collect_key_paths(
    node: &Value,
    needle: &str,
    path: &mut Vec<String>,
    out: &mut Vec<Vec<String>>,
    limit: usize,
) {
    if out.len() >= limit {
        return;
    }

    match node {
        Value::Object(map) => {
            for (k, v) in map {
                path.push(k.clone());
                if k.to_lowercase().contains(needle) && out.len() < limit {
                    out.push(path.clone());
                }
                collect_key_paths(v, needle, path, out, limit);
                path.pop();
                if out.len() >= limit {
                    return;
                }
            }
        }
        Value::Array(items) => {
            for (idx, v) in items.iter().enumerate() {
                path.push(idx.to_string());
                collect_key_paths(v, needle, path, out, limit);
                path.pop();
                if out.len() >= limit {
                    return;
                }
            }
        }
        _ => {}
    }
}
