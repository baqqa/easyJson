"use client"
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useJsonEditorStore } from "@/store/useJsonEditorStore";
import type { JsonPath } from "@/lib/jsonPath";

type Props = {
  leafKey: string | number;
  value: unknown;
  path: JsonPath;
  onDelete?: () => void;
};

function parseLiteral(text: string): unknown {
  // Small helper for the "null" editor.
  const t = text.trim();
  if (t === "") return "";
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

function normalizeHexColor(hex: string): string | null {
  const h = hex.trim();
  const m6 = h.match(/^#([0-9a-fA-F]{6})$/);
  if (m6) return `#${m6[1]}`;
  const m3 = h.match(/^#([0-9a-fA-F]{3})$/);
  if (m3) {
    const [r, g, b] = m3[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

export function JsonLeaf({ value, path, onDelete, leafKey }: Props) {
  const setAtPath = useJsonEditorStore((s) => s.setAtPath);
  const renameKeyAtPath = useJsonEditorStore((s) => s.renameKeyAtPath);

  const kind = useMemo(() => {
    if (value === null) return "null";
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    return "other";
  }, [value]);

  const [nullDraft, setNullDraft] = useState<string>("null");
  const [nullMode, setNullMode] = useState<boolean>(false);
  const canRename = typeof leafKey === "string" && path.length > 0;
  const [renameMode, setRenameMode] = useState<boolean>(false);
  const [renameDraft, setRenameDraft] = useState<string>(() => String(leafKey));
  const maybeColor = useMemo(() => {
    if (leafKey !== "color" || typeof value !== "string") return null;
    return normalizeHexColor(value);
  }, [leafKey, value]);

  useEffect(() => {
    // Keep the draft in sync if the key changes due to rename/delete.
    if (canRename) setRenameDraft(leafKey);
    if (!canRename) setRenameMode(false);
  }, [leafKey, canRename]);

  return (
    <div className="group flex items-center gap-2 py-1">
      <div className="shrink-0 text-sm text-muted-foreground">
        {typeof leafKey === "number" ? (
          `[${leafKey}]`
        ) : canRename && renameMode ? (
          <div className="flex items-center gap-1">
            <Input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              className="w-28 max-w-[40vw]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setRenameMode(false);
                  setRenameDraft(String(leafKey));
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  const next = renameDraft.trim();
                  if (!next) return;
                  renameKeyAtPath(path, next);
                  setRenameMode(false);
                }
              }}
              onClick={(e) => {
                // Avoid any surrounding accordion/toggle reacting while editing.
                e.stopPropagation();
              }}
            />
            <Button
              size="xs"
              variant="secondary"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const next = renameDraft.trim();
                if (!next) return;
                renameKeyAtPath(path, next);
                setRenameMode(false);
              }}
            >
              Apply
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setRenameMode(false);
                setRenameDraft(String(leafKey));
              }}
            >
              Cancel
            </Button>
          </div>
        ) : canRename ? (
          <div className="group/leaf-key flex items-center gap-1">
            <span className="min-w-[56px] max-w-[130px] truncate">{leafKey}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              className="opacity-0 transition-opacity group-hover/leaf-key:opacity-100"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setRenameMode(true);
              }}
              aria-label="Rename key"
              type="button"
            >
              ✎
            </Button>
          </div>
        ) : (
          <span className="truncate">{leafKey}</span>
        )}
      </div>

      {kind === "boolean" ? (
        <Switch
          checked={value as boolean}
          onCheckedChange={(checked) => setAtPath(path, checked)}
        />
      ) : kind === "string" ? (
        <div className="flex items-center gap-2">
          {maybeColor ? (
            <span
              className="inline-block h-4 w-4 rounded-full border border-input/50"
              style={{ backgroundColor: maybeColor }}
              aria-label="Color preview"
            />
          ) : null}
          <Input
            value={value as string}
            onChange={(e) => setAtPath(path, e.target.value)}
            className="flex-1"
          />
        </div>
      ) : kind === "number" ? (
        <Input
          type="number"
          value={Number.isFinite(value as number) ? String(value) : ""}
          onChange={(e) => {
            const next = e.target.value;
            if (next.trim() === "") return;
            const n = Number(next);
            if (Number.isNaN(n)) return;
            setAtPath(path, n);
          }}
          className="flex-1"
        />
      ) : kind === "null" ? (
        <div className="flex items-center gap-2">
          {!nullMode ? (
            <>
              <span className="text-sm text-muted-foreground">Empty</span>
              <Button variant="secondary" size="sm" onClick={() => setNullMode(true)}>
                Set
              </Button>
            </>
          ) : (
            <>
              <Input
                value={nullDraft}
                onChange={(e) => setNullDraft(e.target.value)}
                className="w-full max-w-[320px]"
              />
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  setAtPath(path, parseLiteral(nullDraft));
                  setNullMode(false);
                }}
              >
                Apply
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setNullMode(false)}>
                Cancel
              </Button>
            </>
          )}
        </div>
      ) : (
        <Input
          value={typeof value === "string" ? value : String(value)}
          onChange={(e) => setAtPath(path, e.target.value)}
          className="flex-1"
        />
      )}

      <button
        type="button"
        className="ml-auto rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive hover:bg-muted/60 group-hover:opacity-100"
        onClick={onDelete}
        style={{ display: onDelete ? "block" : "none" }}
        aria-label="Delete"
      >
        🗑
      </button>
    </div>
  );
}

