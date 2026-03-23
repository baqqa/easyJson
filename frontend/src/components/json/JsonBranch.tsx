"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useJsonEditorStore } from "@/store/useJsonEditorStore"
import type { JsonPath } from "@/lib/jsonPath"
import { JsonLeaf } from "./JsonLeaf"

type Props = {
  branchKey: string | number;
  value: unknown;
  path: JsonPath;
  onDelete?: () => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isJsonBranchValue(value: unknown): value is Record<string, unknown> | unknown[] {
  return isPlainObject(value) || Array.isArray(value)
}

export function JsonBranch({ branchKey, value, path, onDelete }: Props) {
  const setAtPath = useJsonEditorStore((s) => s.setAtPath)
  const deleteAtPath = useJsonEditorStore((s) => s.deleteAtPath)
  const renameKeyAtPath = useJsonEditorStore((s) => s.renameKeyAtPath)
  const insertDefaultObjectAtArray = useJsonEditorStore(
    (s) => s.insertDefaultObjectAtArray
  )

  const canRename = typeof branchKey === "string" && path.length > 0
  const [renameMode, setRenameMode] = useState(false)
  const [renameDraft, setRenameDraft] = useState(() => String(branchKey))

  const kind = useMemo(() => {
    if (Array.isArray(value)) return "array"
    if (isPlainObject(value)) return "object"
    return "unknown"
  }, [value])

  const children = useMemo(() => {
    if (!isJsonBranchValue(value)) return []
    if (Array.isArray(value)) {
      return value.map((v, idx) => ({ key: idx, value: v as unknown }))
    }
    return Object.keys(value).map((k) => ({ key: k, value: (value as Record<string, unknown>)[k] }))
  }, [value])

  useEffect(() => {
    if (canRename) setRenameDraft(String(branchKey))
    // If rename is not allowed (array indices/root), ensure we leave rename mode.
    if (!canRename) setRenameMode(false)
  }, [branchKey, canRename])

  if (kind === "unknown") {
    return (
      <div className="rounded-lg border border-destructive/20 p-2 text-sm text-destructive">
        Unsupported branch value at {String(branchKey)}
      </div>
    )
  }

  return (
    <Accordion type="single" collapsible defaultValue="branch">
      <AccordionItem value="branch" className="border-none">
        <AccordionTrigger className="px-0">
          <div className="group/branch flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {renameMode ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    className="w-28 max-w-[35vw]"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault()
                        e.stopPropagation()
                        setRenameMode(false)
                        setRenameDraft(String(branchKey))
                      }
                      if (e.key === "Enter") {
                        e.preventDefault()
                        e.stopPropagation()
                        const next = renameDraft.trim()
                        if (!next) return
                        renameKeyAtPath(path, next)
                        setRenameMode(false)
                      }
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                    }}
                  />
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const next = renameDraft.trim()
                      if (!next) return
                      renameKeyAtPath(path, next)
                      setRenameMode(false)
                    }}
                  >
                    Apply
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setRenameMode(false)
                      setRenameDraft(String(branchKey))
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="group/branch-key flex items-center gap-1">
                  <span className="truncate text-sm font-medium max-w-[170px]">
                    {typeof branchKey === "number" ? `[${branchKey}]` : branchKey}
                  </span>
                  {canRename ? (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="opacity-0 transition-opacity group-hover/branch:opacity-100"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setRenameMode(true)
                      }}
                      aria-label="Rename key"
                      type="button"
                    >
                      ✎
                    </Button>
                  ) : null}
                </div>
              )}
              <span className="text-xs text-muted-foreground">
                ({kind})
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (kind === "object") {
                    const nextKey = window.prompt("Field name?")
                    if (!nextKey) return
                    setAtPath([...path, nextKey], {})
                  } else if (kind === "array") {
                    const arr = value as unknown[]
                    insertDefaultObjectAtArray(path, arr.length)
                  }
                }}
              >
                Add
              </Button>

              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive hover:bg-muted/60 group-hover/branch:opacity-100"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onDelete?.()
                }}
                style={{ display: onDelete ? "block" : "none" }}
                aria-label="Delete"
              >
                🗑
              </button>
            </div>
          </div>
        </AccordionTrigger>

        <AccordionContent>
          <div className="space-y-1 pl-4">
            {children.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">Empty</div>
            ) : null}

            {children.map((child) => {
              const childPath = [...path, child.key] as JsonPath
              const childVal = child.value
              const canBranch = isJsonBranchValue(childVal)

              return (
                <div key={String(child.key)} className="group/row flex items-start gap-2">
                  {canBranch ? (
                    <div className="flex-1">
                      <JsonBranch
                        branchKey={child.key}
                        value={childVal}
                        path={childPath}
                        onDelete={() => deleteAtPath(childPath)}
                      />
                    </div>
                  ) : (
                    <div className="flex-1">
                      <JsonLeaf
                        leafKey={child.key}
                        value={childVal}
                        path={childPath}
                        onDelete={() => deleteAtPath(childPath)}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

