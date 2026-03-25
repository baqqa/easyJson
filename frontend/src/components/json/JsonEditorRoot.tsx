"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useJsonEditorStore } from "@/store/useJsonEditorStore"
import type { JsonPath } from "@/lib/jsonPath"
import { getAtPath, parseJsonWithLocation } from "@/lib/jsonPath"
import { askLocalAi, localAiHealth } from "@/lib/localAi"
import { open, save, message as messageDialog } from "@tauri-apps/plugin-dialog"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { JsonBranch } from "./JsonBranch"
import { JsonLeaf } from "./JsonLeaf"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string") return error
  try {
    const serialized = JSON.stringify(error)
    if (serialized) return serialized
  } catch {
    // ignore serialization errors and fall back below
  }
  return String(error)
}

function detectRootCollections(doc: unknown): Array<{
  label: string
  path: JsonPath
  count: number
  arrays: Array<{ label: string; count: number }>
}> {
  if (!isPlainObject(doc)) return []
  const out: Array<{ label: string; path: JsonPath; count: number; arrays: Array<{ label: string; count: number }> }> = []
  for (const [k, v] of Object.entries(doc)) {
    if (Array.isArray(v)) {
      out.push({ label: k, path: [k], count: v.length, arrays: [] })
    } else if (isPlainObject(v)) {
      const arrays: Array<{ label: string; count: number }> = []
      for (const [childKey, childVal] of Object.entries(v)) {
        if (Array.isArray(childVal)) arrays.push({ label: childKey, count: childVal.length })
      }
      out.push({ label: k, path: [k], count: Object.keys(v).length, arrays })
    } else {
      out.push({ label: k, path: [k], count: 1, arrays: [] })
    }
  }
  return out
}

type SearchMode = "keys" | "values"
type SearchMatch = {
  path: JsonPath
  label: string
}
type ChatMessage = {
  role: "user" | "assistant"
  text: string
}

function formatPath(path: JsonPath): string {
  return path
    .map((seg) => (typeof seg === "number" ? `[${seg}]` : String(seg)))
    .join(" > ")
}

function collectSearchMatches(root: unknown, query: string, mode: SearchMode, limit = 25): SearchMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const matches: SearchMatch[] = []

  const isPrimitive = (v: unknown): v is string | number | boolean | null =>
    v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"

  const visit = (node: unknown, path: JsonPath) => {
    if (matches.length >= limit) return

    if (Array.isArray(node)) {
      node.forEach((v, idx) => visit(v, [...path, idx]))
      return
    }

    if (isPlainObject(node)) {
      for (const [k, v] of Object.entries(node)) {
        if (mode === "keys" && k.toLowerCase().includes(q) && matches.length < limit) {
          matches.push({ path: [...path, k], label: k })
        }
        visit(v, [...path, k])
        if (matches.length >= limit) return
      }
      return
    }

    if (mode === "values" && isPrimitive(node) && matches.length < limit) {
      const text = String(node)
      if (text.toLowerCase().includes(q)) {
        matches.push({ path, label: text })
      }
    }
  }

  visit(root, [])
  return matches
}

type QAIndex = {
  keys: Array<{ key: string; keyLower: string; path: JsonPath; value: unknown }>
  primitives: Array<{ path: JsonPath; value: string | number | boolean | null; valueLower: string }>
  arrays: Array<{ path: JsonPath; length: number }>
  rootKeys: string[]
}

function indexJsonForQA(root: unknown): QAIndex {
  const keys: QAIndex["keys"] = []
  const primitives: QAIndex["primitives"] = []
  const arrays: QAIndex["arrays"] = []

  const rootKeys = isPlainObject(root) ? Object.keys(root) : []

  const isPrimitive = (v: unknown): v is string | number | boolean | null =>
    v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"

  const visit = (node: unknown, path: JsonPath) => {
    if (Array.isArray(node)) {
      arrays.push({ path, length: node.length })
      node.forEach((v, idx) => visit(v, [...path, idx]))
      return
    }

    if (isPlainObject(node)) {
      for (const [k, v] of Object.entries(node)) {
        keys.push({ key: k, keyLower: k.toLowerCase(), path: [...path, k], value: v })
        visit(v, [...path, k])
      }
      return
    }

    if (isPrimitive(node)) {
      const text = String(node)
      primitives.push({ path, value: node, valueLower: text.toLowerCase() })
    }
  }

  visit(root, [])
  return { keys, primitives, arrays, rootKeys }
}

function answerJsonQuestion(question: string, index: QAIndex): { answer: string; jumpPath?: JsonPath } {
  const qLower = question.trim().toLowerCase()
  const quoted = Array.from(question.matchAll(/["']([^"']+)["']/g)).map((m) => m[1])

  const wantsCount = /\bcount\b|\bhow many\b|\bnumber of\b|\btotal\b/.test(qLower)
  const wantsExists = /\bexists\b|\bmissing\b|\bpresent\b|\bis there\b|\bdo we have\b|\bcontains\b/.test(qLower)
  const wantsList = /\blist\b|\bshow\b|\bwhich\b|\btop\b|\bwhat\b/.test(qLower)
  const wantsWhere = /\bwhere\b|\bpath\b|\blocate\b/.test(qLower)
  const wantsSummary = /\bsummary\b|\bdescribe\b|\bwhat is\b|\boverview\b/.test(qLower)

  const uniqueKeys = Array.from(new Set(index.keys.map((k) => k.key)))
  const findKeyCandidate = () => {
    for (const candidate of quoted) {
      const lower = candidate.toLowerCase()
      if (index.keys.some((k) => k.keyLower === lower)) return candidate
    }
    for (const k of uniqueKeys) {
      if (qLower.includes(k.toLowerCase())) return k
    }
    const m = qLower.match(/key\s+([a-zA-Z0-9_.$-]+)/)
    if (m?.[1]) {
      const lower = m[1].toLowerCase()
      if (index.keys.some((k) => k.keyLower === lower)) return m[1]
    }
    return null
  }

  const keyCandidate = findKeyCandidate()
  const keyLower = keyCandidate ? keyCandidate.toLowerCase() : null

  const valueCandidate = !keyCandidate && quoted.length > 0 ? quoted[0] : quoted.length > 0 ? quoted[0] : null
  const valueLower = valueCandidate ? valueCandidate.toLowerCase() : null

  const examplePaths = (paths: JsonPath[]) => {
    const shown = paths.slice(0, 5)
    return shown.map((p) => `- Home > ${formatPath(p)}`).join("\n")
  }

  try {
    if (wantsSummary || (!keyCandidate && !valueCandidate)) {
      const rootKeyList = index.rootKeys.slice(0, 12)
      const rootKeyText = rootKeyList.length > 0 ? rootKeyList.join(", ") : "None"
      const arraysCount = index.arrays.length
      const answer = [
        `This JSON document has ${index.rootKeys.length} top-level key(s).`,
        `Top-level keys: ${rootKeyText}.`,
        `It contains ${arraysCount} array node(s) in total.`,
        `Tip: ask things like “count key age”, “where is key id”, or “find value "foo"”.`,
      ].join("\n")
      return { answer }
    }

    if (wantsCount) {
      if (keyLower) {
        const occs = index.keys.filter((k) => k.keyLower === keyLower)
        const paths = occs.map((o) => o.path)
        const answer = [`Key "${keyCandidate}" appears ${occs.length} time(s).`]
        if (paths.length > 0) {
          answer.push("Example locations:\n" + examplePaths(paths))
        }
        const jumpPath = paths[0]
        return { answer: answer.join("\n"), jumpPath }
      }
      if (valueLower) {
        const occs = index.primitives.filter((p) => p.valueLower.includes(valueLower))
        const paths = occs.map((o) => o.path)
        const answer = [`Value contains "${valueCandidate}" in ${occs.length} node(s).`]
        if (paths.length > 0) {
          answer.push("Example locations:\n" + examplePaths(paths))
        }
        return { answer: answer.join("\n"), jumpPath: paths[0] }
      }
    }

    if (wantsExists) {
      if (keyLower) {
        const occs = index.keys.filter((k) => k.keyLower === keyLower)
        const paths = occs.map((o) => o.path)
        const answer = occs.length > 0
          ? `Yes — key "${keyCandidate}" exists (${occs.length} occurrence(s)).\nExample:\n${examplePaths(paths)}`
          : `No — key "${keyCandidate}" was not found.`
        return { answer, jumpPath: paths[0] }
      }
      if (valueLower) {
        const occs = index.primitives.filter((p) => p.valueLower.includes(valueLower))
        const paths = occs.map((o) => o.path)
        const answer = paths.length > 0
          ? `Yes — a value matching "${valueCandidate}" exists (${paths.length} node(s)).\nExample:\n${examplePaths(paths)}`
          : `No — value "${valueCandidate}" was not found.`
        return { answer, jumpPath: paths[0] }
      }
    }

    if (wantsWhere) {
      if (keyLower) {
        const occs = index.keys.filter((k) => k.keyLower === keyLower).map((o) => o.path)
        const answer = [`Key "${keyCandidate}" is located at:`, examplePaths(occs)].filter(Boolean).join("\n")
        return { answer, jumpPath: occs[0] }
      }
      if (valueLower) {
        const occs = index.primitives.filter((p) => p.valueLower.includes(valueLower)).map((o) => o.path)
        const answer = [`Values matching "${valueCandidate}" are located at:`, examplePaths(occs)].filter(Boolean).join("\n")
        return { answer, jumpPath: occs[0] }
      }
    }

    if (wantsList) {
      if (keyLower) {
        const occs = index.keys.filter((k) => k.keyLower === keyLower)
        const paths = occs.map((o) => o.path)
        const answer = [
          `Found ${occs.length} occurrence(s) of key "${keyCandidate}".`,
          paths.length > 0 ? "Example locations:\n" + examplePaths(paths) : "No locations found.",
        ].join("\n")
        return { answer, jumpPath: paths[0] }
      }

      const keys = index.rootKeys
      const answer = `Top-level keys (${keys.length}): ${keys.slice(0, 25).join(", ")}${keys.length > 25 ? " ..." : ""}`
      return { answer, jumpPath: keys.length > 0 ? [keys[0]] : undefined }
    }

    return { answer: "I couldn’t understand that question. Try “count key X” or “where is key Y”." }
  } catch (e) {
    return { answer: `AI error: ${getErrorMessage(e)}` }
  }
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
      await messageDialog(`Failed to open file: ${getErrorMessage(e)}`, { kind: "error" })
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
      showSavedToast()
    } catch (e) {
      await messageDialog(`Failed to save file: ${getErrorMessage(e)}`, { kind: "error" })
    }
  }

  const collections = useMemo(() => detectRootCollections(doc), [doc])
  const [viewPath, setViewPath] = useState<JsonPath>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [searchMode, setSearchMode] = useState<SearchMode>("keys")
  const qaIndex = useMemo(() => indexJsonForQA(doc), [doc])

  const [aiQuestion, setAiQuestion] = useState("")
  const [aiChat, setAiChat] = useState<ChatMessage[]>([
    { role: "assistant", text: "Ask a question about the current JSON." },
  ])
  const [aiJumpPath, setAiJumpPath] = useState<JsonPath | null>(null)
  const [aiPending, setAiPending] = useState(false)
  const [aiHealthMessage, setAiHealthMessage] = useState<string>("Checking local model...")
  const aiChatRef = useRef<HTMLDivElement | null>(null)

  const onAskAI = async () => {
    const q = aiQuestion.trim()
    if (!q) return

    setAiQuestion("")
    setAiChat((prev) => [...prev, { role: "user", text: q }])
    setAiPending(true)
    try {
      const payloadText = rawText.length > 400_000 ? rawText.slice(0, 400_000) : rawText
      const timeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("Local AI timed out.")), 12_000)
      })

      const res = (await Promise.race([
        askLocalAi({
          question: q,
          jsonText: payloadText,
          currentPath: viewPath,
        }),
        timeout,
      ])) as Awaited<ReturnType<typeof askLocalAi>>

      const jumpPath: JsonPath | null =
        res.jump_path && res.jump_path.length > 0
          ? (res.jump_path.map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg)) as JsonPath)
          : null

      setAiChat((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `${res.answer_text}\n\n(latency: ${res.diagnostics?.latency_ms ?? "-"} ms, mode: ${
            res.diagnostics?.fallback_used ? "fallback" : "model"
          })`,
        },
      ])
      setAiJumpPath(jumpPath)
    } catch {
      // Frontend deterministic fallback if backend AI is unavailable.
      const res = answerJsonQuestion(q, qaIndex)
      setAiChat((prev) => [
        ...prev,
        { role: "assistant", text: `${res.answer}\n\n(Backend unavailable, used local fallback.)` },
      ])
      setAiJumpPath(res.jumpPath ?? null)
    } finally {
      setAiPending(false)
    }
  }

  useEffect(() => {
    if (!aiChatRef.current) return
    aiChatRef.current.scrollTop = aiChatRef.current.scrollHeight
  }, [aiChat, aiPending])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const health = await localAiHealth()
        if (cancelled) return
        if (health.model_loaded) {
          setAiHealthMessage("Local Qwen runtime ready.")
        } else {
          setAiHealthMessage(`${health.message}${health.model_path ? ` (path: ${health.model_path})` : ""}`)
        }
      } catch {
        if (cancelled) return
        setAiHealthMessage("Could not query AI health from backend.")
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // If nothing is selected yet, default to the first root key.
    if (viewPath.length > 0) return
    if (collections.length === 0) return
    setViewPath([collections[0].label])
  }, [collections, viewPath.length])

  const topLevelKey = typeof viewPath[0] === "string" ? (viewPath[0] as string) : null

  const activeValue = useMemo(() => {
    if (viewPath.length === 0) return doc
    try {
      return getAtPath(doc, viewPath)
    } catch {
      return doc
    }
  }, [doc, viewPath])

  const activeKey: string | number = viewPath.length === 0 ? "root" : viewPath[viewPath.length - 1]

  const searchMatches = useMemo(
    () => collectSearchMatches(doc, searchQuery, searchMode, 25),
    [doc, searchQuery, searchMode]
  )

  const highlightedPathKeys = useMemo(() => {
    return new Set(searchMatches.map((m) => JSON.stringify(m.path)))
  }, [searchMatches])

  const editor = useMemo(() => {
    const onDeleteCurrent = viewPath.length > 0 ? () => deleteAtPath(viewPath) : undefined
    if (Array.isArray(activeValue) || isPlainObject(activeValue)) {
      return (
        <JsonBranch
          branchKey={activeKey}
          value={activeValue}
          path={viewPath}
          onDelete={onDeleteCurrent}
          onNavigate={setViewPath}
          highlightPaths={highlightedPathKeys}
        />
      )
    }
    return (
      <JsonLeaf
        leafKey={activeKey}
        value={activeValue}
        path={viewPath}
        onDelete={onDeleteCurrent}
        highlightPaths={highlightedPathKeys}
      />
    )
  }, [activeKey, activeValue, viewPath, deleteAtPath, highlightedPathKeys, setViewPath])

  const rawDebounceRef = useRef<number | null>(null)
  const saveToastTimerRef = useRef<number | null>(null)
  const [showSaveToast, setShowSaveToast] = useState(false)

  const showSavedToast = () => {
    setShowSaveToast(true)
    if (saveToastTimerRef.current) window.clearTimeout(saveToastTimerRef.current)
    saveToastTimerRef.current = window.setTimeout(() => {
      setShowSaveToast(false)
    }, 3000)
  }

  useEffect(() => {
    return () => {
      if (saveToastTimerRef.current) window.clearTimeout(saveToastTimerRef.current)
    }
  }, [])
  const onRawChange = (next: string) => {
    setRawText(next)
    if (rawDebounceRef.current) window.clearTimeout(rawDebounceRef.current)
    rawDebounceRef.current = window.setTimeout(() => {
      tryParseRawText()
    }, 400)
  }

  return (
    <div className="flex h-full w-full flex-col min-h-0">
      <div
        className={[
          "pointer-events-none fixed left-1/2 top-14 z-50 -translate-x-1/2 rounded-md border border-emerald-300/40 bg-emerald-500/90 px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-300",
          showSaveToast ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
        ].join(" ")}
        role="status"
        aria-live="polite"
      >
        File saved successfully
      </div>
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
            <div className="space-y-2">
              <div className="text-sm font-medium text-white">Search</div>

              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchMode === "keys" ? "Search keys..." : "Search values..."}
                className="min-w-0 border-white/10 bg-[#0F2A4D] text-white placeholder:text-white/40"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  className={[
                    "rounded-md px-2 py-1 text-xs transition",
                    searchMode === "keys"
                      ? "bg-[#F59E0B]/15 text-white"
                      : "hover:bg-[#0F2A4D] text-white/70",
                  ].join(" ")}
                  onClick={() => setSearchMode("keys")}
                >
                  Keys
                </button>
                <button
                  type="button"
                  className={[
                    "rounded-md px-2 py-1 text-xs transition",
                    searchMode === "values"
                      ? "bg-[#F59E0B]/15 text-white"
                      : "hover:bg-[#0F2A4D] text-white/70",
                  ].join(" ")}
                  onClick={() => setSearchMode("values")}
                >
                  Values
                </button>
              </div>

              {searchQuery.trim() ? (
                <div className="max-h-48 overflow-auto space-y-1">
                  {searchMatches.length === 0 ? (
                    <div className="text-sm text-white/50">No matches</div>
                  ) : (
                    searchMatches.map((m, idx) => {
                      const isSelected =
                        m.path.length === viewPath.length && m.path.every((seg, i) => seg === viewPath[i])

                      return (
                        <button
                          key={`${idx}-${m.path.join(".")}`}
                          type="button"
                          className={[
                            "w-full rounded-md px-3 py-1.5 text-left text-sm transition",
                            isSelected
                              ? "bg-[#F59E0B]/15 text-white"
                              : "hover:bg-[#0F2A4D] text-white/70",
                          ].join(" ")}
                          onClick={() => setViewPath(m.path)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate">{m.label}</span>
                            <span className="shrink-0 max-w-[130px] truncate text-xs text-white/50">
                              {formatPath(m.path)}
                            </span>
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              ) : null}
            </div>

            <div className="text-sm font-medium text-white">Collections</div>
            <div className="space-y-2">
              {collections.length === 0 ? (
                <div className="text-sm text-white/70">
                  Root must be a JSON object to show top-level keys.
                </div>
              ) : null}

              {collections.map((c) => {
                const selectedArrayKey =
                  topLevelKey === c.label && viewPath.length === 2 && typeof viewPath[1] === "string"
                    ? (viewPath[1] as string)
                    : null

                return (
                  <div key={c.label} className="space-y-1">
                    <button
                      type="button"
                      className={[
                        "w-full rounded-lg px-3 py-2 text-left text-sm transition",
                        topLevelKey === c.label
                          ? "bg-[#F59E0B]/15 text-white"
                          : "hover:bg-[#0F2A4D] text-white/70",
                      ].join(" ")}
                      onClick={() => setViewPath([c.label])}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{c.label}</span>
                        <span className="text-xs text-white/70">{c.count}</span>
                      </div>
                    </button>

                    {c.arrays.length > 0 ? (
                      <details
                        className="pl-3"
                        open={topLevelKey === c.label && selectedArrayKey !== null}
                      >
                        <summary className="cursor-pointer select-none text-xs font-medium text-white/60 hover:text-white">
                          Arrays ({c.arrays.length})
                        </summary>
                        <div className="mt-1 space-y-1">
                          {c.arrays.map((a) => {
                            const isSelected = selectedArrayKey === a.label
                            return (
                              <button
                                key={a.label}
                                type="button"
                                className={[
                                  "w-full rounded-md px-3 py-1 text-left text-sm transition",
                                  isSelected
                                    ? "bg-[#F59E0B]/15 text-white"
                                    : "hover:bg-[#0F2A4D] text-white/70",
                                ].join(" ")}
                                onClick={() => setViewPath([c.label, a.label])}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{a.label}</span>
                                  <span className="text-xs text-white/50">{a.count}</span>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </details>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </aside>

          <main className="flex min-w-0 flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-auto">
              <div className="mb-3 flex items-center gap-2 text-sm">
                <button
                  type="button"
                  className="text-white/70 hover:underline"
                  onClick={() => setViewPath([])}
                >
                  Home
                </button>
                {viewPath.length > 0
                  ? viewPath.map((seg, idx) => {
                      const isLast = idx === viewPath.length - 1
                      const label = typeof seg === "number" ? `[${seg}]` : String(seg)
                      const targetPath = viewPath.slice(0, idx + 1)

                      return [
                        <span key={`sep-${idx}`} className="text-white/40">
                          ›
                        </span>,
                        <button
                          key={`crumb-${idx}`}
                          type="button"
                          className={isLast ? "font-medium text-white truncate" : "text-white/70 hover:underline"}
                          onClick={() => setViewPath(targetPath)}
                        >
                          {label}
                        </button>,
                      ]
                    })
                  : null}
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

                <AccordionItem value="ai">
                  <AccordionTrigger className="text-left text-sm text-white/90">
                    AI: Ask about JSON
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={aiQuestion}
                          onChange={(e) => setAiQuestion(e.target.value)}
                          placeholder='Try: count key "id"'
                          className="bg-[#0F2A4D] border-white/10 text-white placeholder:text-white/40"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") onAskAI()
                          }}
                        />
                        <Button
                          size="sm"
                          variant="default"
                          className="bg-[#F59E0B] text-[#0B1F3A] hover:bg-[#FBBF24]"
                          onClick={onAskAI}
                          disabled={aiPending}
                        >
                          {aiPending ? "Asking..." : "Ask"}
                        </Button>
                      </div>

                      <div
                        ref={aiChatRef}
                        className="max-h-64 overflow-y-auto rounded-md border border-white/10 bg-[#0F2A4D] p-2 space-y-2"
                      >
                        {aiChat.map((m, idx) => (
                          <div
                            key={`${m.role}-${idx}`}
                            className={[
                              "rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
                              m.role === "user"
                                ? "bg-[#1A3A66] text-white ml-6"
                                : "bg-[#0B1F3A] text-white/90 mr-6 border border-white/10",
                            ].join(" ")}
                          >
                            <div className="mb-1 text-[11px] uppercase tracking-wide text-white/50">
                              {m.role === "user" ? "You" : "AI"}
                            </div>
                            {m.text}
                          </div>
                        ))}
                        {aiPending ? (
                          <div className="rounded-md px-3 py-2 text-sm bg-[#0B1F3A] text-white/70 border border-white/10 mr-6">
                            <div className="mb-1 text-[11px] uppercase tracking-wide text-white/50">AI</div>
                            Thinking...
                          </div>
                        ) : null}
                      </div>
                      <div className="text-xs text-white/50">{aiHealthMessage}</div>

                      {aiJumpPath ? (
                        <div>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="bg-[#0F2A4D] text-white hover:bg-[#102c57]"
                            onClick={() => setViewPath(aiJumpPath)}
                          >
                            Jump to match
                          </Button>
                        </div>
                      ) : null}
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

