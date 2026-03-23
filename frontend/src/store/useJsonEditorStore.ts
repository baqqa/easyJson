import { create } from "zustand";
import type { JsonPath } from "@/lib/jsonPath";
import {
  deleteAtPathImmutable,
  duplicateArrayItemImmutable,
  formatJson,
  insertDefaultObjectAtArrayImmutable,
  parseJsonWithLocation,
  renameKeyAtPathImmutable,
  setAtPathImmutable,
} from "@/lib/jsonPath";

export type JsonParseError = {
  message: string;
  position?: number;
  line?: number;
  col?: number;
};

export type JsonEditorState = {
  filePath: string | null;
  doc: unknown;
  rawText: string;
  dirty: boolean;

  parseError: JsonParseError | null;

  // Set doc directly (e.g., from raw parse success)
  setDoc: (
    next: unknown,
    opts?: { syncRaw?: boolean; dirty?: boolean }
  ) => void;
  setFilePath: (path: string | null) => void;
  setRawText: (nextRaw: string) => void;

  // Validates rawText and updates doc on success.
  tryParseRawText: () => { ok: true } | { ok: false; error: JsonParseError };

  // Path-based operations for the recursive editor UI
  setAtPath: (path: JsonPath, value: unknown) => void;
  deleteAtPath: (path: JsonPath) => void;
  renameKeyAtPath: (path: JsonPath, newKey: string) => void;
  insertDefaultObjectAtArray: (arrayPath: JsonPath, index: number) => void;
  duplicateArrayItem: (arrayPath: JsonPath, index: number) => void;

  markClean: () => void;
};

export const useJsonEditorStore = create<JsonEditorState>((set, get) => ({
  filePath: null,
  doc: {},
  rawText: formatJson({}, 2),
  dirty: false,
  parseError: null,

  setDoc: (next, opts) => {
    const syncRaw = opts?.syncRaw ?? true;
    const dirty = opts?.dirty ?? true;
    set((s) => ({
      ...s,
      doc: next,
      dirty,
      parseError: null,
      rawText: syncRaw ? formatJson(next, 2) : s.rawText,
    }));
  },

  setFilePath: (path) => {
    set((s) => ({
      ...s,
      filePath: path,
    }))
  },

  setRawText: (nextRaw) => {
    set((s) => ({
      ...s,
      rawText: nextRaw,
      // while the user is typing, we keep doc unchanged
      parseError: null,
    }));
  },

  tryParseRawText: () => {
    const text = get().rawText;
    const res = parseJsonWithLocation(text);
    if (!res.ok) {
      const error = res.error;
      set((s) => ({
        ...s,
        parseError: error,
      }));
      return { ok: false as const, error };
    }

    set((s) => ({
      ...s,
      doc: res.value,
      dirty: true,
      parseError: null,
    }));
    return { ok: true as const };
  },

  setAtPath: (path, value) => {
    set((s) => {
      const nextDoc = setAtPathImmutable(s.doc, path, value);
      return {
        ...s,
        doc: nextDoc,
        dirty: true,
        parseError: null,
        rawText: formatJson(nextDoc, 2),
      };
    });
  },

  deleteAtPath: (path) => {
    set((s) => {
      const nextDoc = deleteAtPathImmutable(s.doc, path);
      return {
        ...s,
        doc: nextDoc,
        dirty: true,
        parseError: null,
        rawText: formatJson(nextDoc, 2),
      };
    });
  },

  renameKeyAtPath: (path, newKey) => {
    set((s) => {
      const nextDoc = renameKeyAtPathImmutable(s.doc, path, newKey);
      return {
        ...s,
        doc: nextDoc,
        dirty: true,
        parseError: null,
        rawText: formatJson(nextDoc, 2),
      };
    });
  },

  insertDefaultObjectAtArray: (arrayPath, index) => {
    set((s) => {
      const nextDoc = insertDefaultObjectAtArrayImmutable(s.doc, arrayPath, index);
      return {
        ...s,
        doc: nextDoc,
        dirty: true,
        parseError: null,
        rawText: formatJson(nextDoc, 2),
      };
    });
  },

  duplicateArrayItem: (arrayPath, index) => {
    set((s) => {
      const nextDoc = duplicateArrayItemImmutable(s.doc, arrayPath, index);
      return {
        ...s,
        doc: nextDoc,
        dirty: true,
        parseError: null,
        rawText: formatJson(nextDoc, 2),
      };
    });
  },

  markClean: () => {
    set((s) => ({
      ...s,
      dirty: false,
      parseError: null,
    }))
  },
}));

