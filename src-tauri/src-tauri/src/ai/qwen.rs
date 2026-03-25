use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::Mutex;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;

const MAX_PREDICT: usize = 192;
const MAX_PROMPT_TOKENS: usize = 1536;

pub struct QwenRuntime {
    backend: LlamaBackend,
    model: LlamaModel,
    model_path: PathBuf,
}

impl QwenRuntime {
    pub fn load_once() -> Result<Self, String> {
        let backend = LlamaBackend::init().map_err(|e| format!("llama backend init error: {e}"))?;
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let candidate_dirs = [
            // Expected by your latest requirement: src-tauri/resources
            manifest_dir.join("../resources"),
            // Fallback if user placed resources inside crate root
            manifest_dir.join("resources"),
            // Fallback to old model folder
            manifest_dir.join("../../models/qwen2.5-0.5b"),
        ];
        let model_path = candidate_dirs
            .iter()
            .find_map(|dir| find_first_gguf(dir))
            .ok_or_else(|| {
                let tried = candidate_dirs
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(" | ");
                format!("GGUF model non trovato. Cartelle controllate: {tried}")
            })?;

        let model = LlamaModel::load_from_file(&backend, &model_path, &LlamaModelParams::default())
            .map_err(|e| format!("model load error: {e}"))?;

        Ok(Self {
            backend,
            model,
            model_path,
        })
    }

    pub fn analyze_json(&self, json_snippet: &str) -> Result<String, String> {
        let prompt = format!(
            "<|im_start|>system\nSei un assistente che analizza snippet JSON e risponde in modo breve e utile.<|im_end|>\n<|im_start|>user\nAnalizza questo JSON e rispondi alla richiesta implicita dell'utente:\n{}\n<|im_end|>\n<|im_start|>assistant\n",
            json_snippet
        );

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(2048))
            .with_n_batch(2048)
            .with_n_threads(8)
            .with_n_threads_batch(8);

        let mut ctx = self
            .model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| format!("context init error: {e}"))?;

        let mut prompt_tokens = self
            .model
            .str_to_token(&prompt, AddBos::Always)
            .map_err(|e| format!("tokenize error: {e}"))?;
        if prompt_tokens.is_empty() {
            return Err("prompt tokenization returned empty".to_string());
        }
        if prompt_tokens.len() > MAX_PROMPT_TOKENS {
            prompt_tokens.truncate(MAX_PROMPT_TOKENS);
        }

        let mut batch = LlamaBatch::new(MAX_PROMPT_TOKENS + 1, 1);
        batch
            .add_sequence(&prompt_tokens, 0, false)
            .map_err(|e| format!("batch add_sequence error: {e}"))?;
        ctx.decode(&mut batch)
            .map_err(|e| format!("decode prompt error: {e}"))?;

        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::temp(0.2),
            LlamaSampler::top_k(40),
            LlamaSampler::top_p(0.9, 1),
            LlamaSampler::dist(42),
        ]);

        let mut out = String::new();
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut n_cur = i32::try_from(prompt_tokens.len()).map_err(|_| "too many prompt tokens")?;

        for _ in 0..MAX_PREDICT {
            let token: LlamaToken = sampler.sample(&ctx, -1);
            sampler.accept(token);

            if self.model.is_eog_token(token) {
                break;
            }

            let piece = self
                .model
                .token_to_piece(token, &mut decoder, true, None)
                .map_err(|e| format!("decode token piece error: {e}"))?;
            out.push_str(&piece);

            batch.clear();
            batch
                .add(token, n_cur, &[0], true)
                .map_err(|e| format!("batch add token error: {e}"))?;
            ctx.decode(&mut batch)
                .map_err(|e| format!("decode step error: {e}"))?;
            n_cur += 1;
        }

        Ok(out.trim().to_string())
    }
}

pub struct AiModelState {
    pub runtime: Mutex<QwenRuntime>,
    pub model_path: String,
}

impl AiModelState {
    pub fn new() -> Result<Self, String> {
        let runtime = QwenRuntime::load_once()?;
        let model_path = runtime.model_path.display().to_string();
        Ok(Self {
            runtime: Mutex::new(runtime),
            model_path,
        })
    }
}

pub fn ai_analyze_json_impl(
    state: tauri::State<'_, AiModelState>,
    json_snippet: String,
) -> Result<String, String> {
    if json_snippet.trim().is_empty() {
        return Err("json_snippet vuoto".to_string());
    }

    let runtime = state
        .runtime
        .lock()
        .map_err(|_| "ai runtime lock poisoned".to_string())?;
    runtime.analyze_json(&json_snippet)
}

fn find_first_gguf(dir: &PathBuf) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
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
