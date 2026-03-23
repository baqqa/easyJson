# Frontend Architecture (easyJson)

This frontend is a React + TypeScript app that provides a structured JSON editor UI.
It is designed to work inside a Tauri desktop shell, but the architecture is cleanly split so the UI logic stays in React and filesystem operations are called through Tauri plugins.

- A tree-based editor for nested JSON
- Backed by a single source of truth in a small Zustand store
- With immutable path-based updates for predictability and easy debugging
- Plus a raw JSON mode for power users

## High-Level Flow

1. User opens a file (`Open` button)
2. File text is read through Tauri FS plugin
3. Text is parsed into a JSON document with location-aware error handling
4. UI renders the JSON recursively as branches and leaves
5. Edits update the store immutably using JSON path helpers
6. Store regenerates pretty-formatted raw JSON text
7. User saves (`Save` button), writing raw text back to disk

## Folder-by-Folder Breakdown

### `src/main.tsx`

- Frontend entry point
- Mounts the React application

### `src/App.tsx`

- App shell for this project
- Renders `JsonEditorRoot` as the main experience

### `src/components/json`

Core editor UI.

- `JsonEditorRoot.tsx`
  - Top-level container and orchestration layer
  - Handles open/save actions through Tauri plugins (`dialog` + `fs`)
  - Computes root collections (top-level keys) and active selection
  - Shows parse status and raw JSON panel

- `JsonBranch.tsx`
  - Recursive renderer for arrays/objects
  - Supports add/delete/rename operations
  - Delegates primitive values to `JsonLeaf`

- `JsonLeaf.tsx`
  - Renderer/editor for primitive nodes (`string`, `number`, `boolean`, `null`)
  - Supports inline key renaming and deletion
  - Contains small UX details, such as color preview when the key is `color`

### `src/store`

- `useJsonEditorStore.ts`
  - Central state container (Zustand)
  - Tracks `doc`, `rawText`, `dirty`, `filePath`, and `parseError`
  - Exposes semantic actions (`setAtPath`, `deleteAtPath`, `renameKeyAtPath`, etc.)
  - Keeps `doc` and `rawText` consistent after mutations

### `src/lib`

- `jsonPath.ts`
  - Pure helper utilities for JSON parsing/formatting
  - Path-based immutable update operations
  - Error location support for better parse feedback

- `utils.ts`
  - General shared UI/helper utilities

### `src/components/ui`

- Reusable UI primitives (button, input, accordion, switch, card)
- Mostly presentational; business logic stays in `components/json` + store

## State Management Design

The store is intentionally small and explicit:

- `doc`: parsed JSON object currently being edited
- `rawText`: text representation shown in advanced mode
- `dirty`: unsaved-changes flag
- `filePath`: current file location for save behavior
- `parseError`: structured parse error (message + optional line/column)

Why this approach works well:

- One source of truth for app behavior
- Immutable updates reduce accidental mutation bugs
- Path-based actions scale naturally for deeply nested JSON
- Easy to test helper functions separately from UI

## Editing Model

The UI supports two synchronized editing styles:

- Tree editing for guided, low-error modifications
- Raw JSON editing for direct power-user control

Raw input is validated with a short debounce so typing remains responsive, and parse feedback is shown immediately when JSON is invalid.

## Tauri Integration

This frontend intentionally avoids direct Node.js filesystem APIs.
Instead, it uses:

- `@tauri-apps/plugin-dialog` for file pickers and save dialogs
- `@tauri-apps/plugin-fs` for reading/writing file content

This keeps the same React architecture while delegating native capabilities to Tauri.

## Why This Architecture

- Clear separation of concerns (UI, state, and pure JSON transforms)
- Predictable updates through immutable path operations
- Recursive rendering that mirrors JSON structure naturally
- Fast iteration with Vite and straightforward component boundaries

It is easy to extend with features like search/filter, undo/redo, schema validation, and keyboard shortcuts because the core data flow is already centralized.

## Run and Build

```bash
npm install
npm run dev
```

Other scripts:

- `npm run build` - type-check + production build
- `npm run preview` - serve production build locally
- `npm run lint` - run ESLint
