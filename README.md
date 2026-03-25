# easyJson

easyJson is a simple desktop JSON editor built with React, TypeScript, and Tauri.

It lets you:
- Open a `.json` file
- Edit values in a visual tree
- Rename keys
- Add and delete fields/items
- Validate JSON while typing
- Save changes back to file

## Tech Stack

- Frontend: React + Vite + TypeScript + Zustand
- Desktop shell: Tauri (Rust)
- UI: Tailwind + shadcn/ui components

## Project Structure

- `frontend` - React app (UI and state management)
- `src-tauri/src-tauri` - Tauri/Rust desktop backend and app config

## Requirements

Install these first:
- Node.js (LTS recommended)
- Rust (stable)
- Tauri system prerequisites

Tauri prerequisites: [https://tauri.app/start/prerequisites/](https://tauri.app/start/prerequisites/)

## Setup

From the project root:

```bash
cd frontend
npm install
```

## Run in Browser (Frontend Only)

```bash
cd frontend
npm run dev
```

This starts Vite on `http://localhost:5173`.

## Run as Desktop App (Tauri)

From `src-tauri/src-tauri`:

```bash
cargo tauri dev
```

Notes:
- Tauri uses the frontend dev server automatically (`http://localhost:5173`) in development.
- If `cargo tauri` is not available, install the Tauri CLI first:

```bash
cargo install tauri-cli --version "^2.0.0"
```

## Build

Frontend build:

```bash
cd frontend
npm run build
```

Desktop app build:

```bash
cd src-tauri/src-tauri
cargo tauri build
```

## How to Use

1. Click **Open** and select a JSON file.
2. Select a top-level key from the **Collections** panel.
3. Edit values in the form/tree view.
4. (Optional) Use **Advanced: Raw JSON** to edit raw text.
5. Click **Save** to write changes.

## Common Scripts

In `frontend`:
- `npm run dev` - start development server
- `npm run build` - build production frontend
- `npm run preview` - preview built frontend
- `npm run lint` - run ESLint

## Local AI Model Setup

The Tauri backend AI looks for local model files in:

- `models/qwen2.5-0.5b`

Expected model file:

- any `*.gguf` file (example: `qwen2.5-0.5b-instruct-q4_0.gguf`)

Optional override:

- set `EASYJSON_MODEL_DIR` to a custom absolute/relative model folder path.
- set `EASYJSON_LLM_RUNNER` to your `llama-cli` executable path (if not in PATH).

If files are missing, the app will still answer via deterministic fallback and show a model health message in the AI panel.
