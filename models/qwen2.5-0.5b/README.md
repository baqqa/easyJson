# Local Qwen Model Setup

The app expects a local GGUF model artifact in this folder for backend AI:

- `*.gguf` (for example: `qwen2.5-0.5b-instruct-q4_0.gguf`)

By default, the backend looks at:

- `models/qwen2.5-0.5b`

You can override this path with:

- `EASYJSON_MODEL_DIR` environment variable

Also set your llama.cpp runner command:

- `EASYJSON_LLM_RUNNER` (example: `C:\tools\llama.cpp\build\bin\Release\llama-cli.exe`)

If not set, the app tries `llama-cli` from your PATH.

## Next step after adding files

1. Place a `.gguf` model file in this folder.
2. Ensure `llama-cli` is available via PATH or `EASYJSON_LLM_RUNNER`.
3. Restart the Tauri app.
4. Open **AI: Ask about JSON** and verify health reads `Local Qwen runtime ready.`
