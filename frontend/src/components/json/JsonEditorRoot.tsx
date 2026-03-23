"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useJsonEditorStore } from "@/store/useJsonEditorStore"
import type { JsonPath } from "@/lib/jsonPath"
import { getAtPath, parseJsonWithLocation } from "@/lib/jsonPath"
import { open, save, message as messageDialog } from "@tauri-apps/plugin-dialog"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { JsonBranch } from "./JsonBranch"
import { JsonLeaf } from "./JsonLeaf"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function detectRootCollections(doc: unknown): Array<{ label: string; path: JsonPath; count: number }> {
  if (!isPlainObject(doc)) return []
  const out: Array<{ label: string; path: JsonPath; count: number }> = []
  for (const [k, v] of Object.entries(doc)) {
    if (Array.isArray(v)) out.push({ label: k, path: [k], count: v.length })
    else if (isPlainObject(v)) out.push({ label: k, path: [k], count: Object.keys(v).length })
    else out.push({ label: k, path: [k], count: 1 })
  }
  return out
}

export function JsonEditorRoot() {
  const doc = useJsonEditorStore((s) => s.doc)
  const rawText = useJsonEditorStore((s) => s.rawText)
  const parseError = useJsonEditorStore((s) => s.parseError)
  const filePath = useJsonEditorStore((s) => s.filePath)
  const dirty = useJsonEditorStore((s) => s.dirty)
  const setDoc = useJsonEditorStore((s) => s.setDoc)
  const setRawText = useJsonEditorStore((s) => s.setRawText)
  const tryParseRawText = useJsonEditorStore((s) => s.tryParseRawText)
  const setFilePath = useJsonEditorStore((s) => s.setFilePath)
  const markClean = useJsonEditorStore((s) => s.markClean)
  const deleteAtPath = useJsonEditorStore((s) => s.deleteAtPath)

  const onOpen = async () => {
    const selected = await open({
      filters: [{ name: "JSON", extensions: ["json"] }],
      multiple: false,
    })
    if (selected === null) return

    try {
      const text = await readTextFile(selected)
      const res = parseJsonWithLocation(text)
      if (!res.ok) {
        await messageDialog(`Invalid JSON: ${res.error.message}`, { kind: "error" })
        return
      }

      setFilePath(selected)
      setDoc(res.value, { syncRaw: true, dirty: false })
      markClean()
    } catch (e) {
      await messageDialog(`Failed to open file: ${(e as Error).message}`, { kind: "error" })
    }
  }

  const onSave = async () => {
    const res = tryParseRawText()
    if (!res.ok) {
      await messageDialog(`Cannot save: JSON is invalid.\n\n${res.error.message}`, { kind: "error" })
      return
    }

    let target = filePath
    if (!target) {
      target = await save({
        filters: [{ name: "JSON", extensions: ["json"] }],
        defaultPath: "document.json",
      })
      if (!target) return
      setFilePath(target)
    }

    try {
      // Prefer the editor's rawText (already pretty-formatted).
      await writeTextFile(target, rawText)
      markClean()
    } catch (e) {
      await messageDialog(`Failed to save file: ${(e as Error).message}`, { kind: "error" })
    }
  }

  const collections = useMemo(() => detectRootCollections(doc), [doc])
  const [activeCollectionKey, setActiveCollectionKey] = useState<string | null>(null)

  useEffect(() => {
    if (activeCollectionKey && collections.some((c) => c.label === activeCollectionKey)) return
    setActiveCollectionKey(collections[0]?.label ?? null)
  }, [activeCollectionKey, collections])

  const activePath: JsonPath = useMemo(() => {
    if (!activeCollectionKey) return []
    return [activeCollectionKey]
  }, [activeCollectionKey])

  const activeValue = useMemo(() => {
    if (activePath.length === 0) return doc
    return getAtPath(doc, activePath)
  }, [doc, activePath])

  const editor = useMemo(() => {
    if (Array.isArray(activeValue) || isPlainObject(activeValue)) {
      return (
        <JsonBranch
          branchKey={activeCollectionKey ?? "root"}
          value={activeValue}
          path={activePath}
          onDelete={activeCollectionKey ? () => deleteAtPath(activePath) : undefined}
        />
      )
    }
    return (
      <JsonLeaf
        leafKey={activeCollectionKey ?? "root"}
        value={activeValue}
        path={activePath}
        onDelete={activeCollectionKey ? () => deleteAtPath(activePath) : undefined}
      />
    )
  }, [activeCollectionKey, activePath, activeValue, deleteAtPath])

  const rawDebounceRef = useRef<number | null>(null)
  const onRawChange = (next: string) => {
    setRawText(next)
    if (rawDebounceRef.current) window.clearTimeout(rawDebounceRef.current)
    rawDebounceRef.current = window.setTimeout(() => {
      tryParseRawText()
    }, 400)
  }

  return (
    <div className="flex h-full w-full flex-col min-h-0">
      <Card className="flex-1 min-h-0 w-full bg-[#0B1F3A] text-white ring-white/10">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="bg-[#0F2A4D] text-white hover:bg-[#102c57]"
              onClick={onOpen}
            >
              Open
            </Button>
            <Button
              variant="default"
              className="bg-[#F59E0B] text-[#0B1F3A] hover:bg-[#FBBF24]"
              onClick={onSave}
              disabled={!dirty && !filePath}
            >
              Save
            </Button>
            <span className="truncate text-xs text-white/70">
              {filePath ? filePath : "No file selected"}
              {dirty ? " *" : ""}
            </span>
          </div>

          <span className="text-xs text-white/70">
            {parseError ? `Invalid JSON: ${parseError.message}` : "Ready"}
          </span>
        </div>

        <div className="grid flex-1 min-h-0 grid-cols-[260px_1fr] gap-4 overflow-hidden p-4">
          <aside className="space-y-3 overflow-auto">
            <div className="text-sm font-medium text-white">Collections</div>
            <div className="space-y-2">
              {collections.length === 0 ? (
                <div className="text-sm text-white/70">
                  Root must be a JSON object to show top-level keys.
                </div>
              ) : null}

              {collections.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  className={[
                    "w-full rounded-lg px-3 py-2 text-left text-sm transition",
                    activeCollectionKey === c.label
                      ? "bg-[#F59E0B]/15 text-white"
                      : "hover:bg-[#0F2A4D] text-white/70",
                  ].join(" ")}
                  onClick={() => setActiveCollectionKey(c.label)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{c.label}</span>
                    <span className="text-xs text-white/70">{c.count}</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <main className="flex min-w-0 flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-auto">
              <div className="mb-3 flex items-center gap-2 text-sm">
                <span className="text-white/70">Home</span>
                {activeCollectionKey ? (
                  <>
                    <span className="text-white/40">›</span>
                    <span className="font-medium text-white truncate">{activeCollectionKey}</span>
                  </>
                ) : null}
              </div>

              {editor}
            </div>

            <div className="mt-4 shrink-0">
              <Accordion type="single" collapsible defaultValue="raw">
                <AccordionItem value="raw">
                  <AccordionTrigger className="text-left text-sm text-white/90">
                    Advanced: Raw JSON
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2">
                      <textarea
                        className="min-h-[180px] w-full resize-y rounded-lg border border-white/15 bg-[#0F2A4D] px-3 py-2 font-mono text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B]/40"
                        value={rawText}
                        onChange={(e) => onRawChange(e.target.value)}
                      />
                      {parseError ? (
                        <div className="text-sm text-[#F87171]">
                          {parseError.message}
                          {parseError.line && parseError.col ? ` (line ${parseError.line}, col ${parseError.col})` : null}
                        </div>
                      ) : (
                        <div className="text-sm text-white/70">
                          Edits validate automatically (debounced).
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </main>
        </div>
      </Card>
    </div>
  )
}

