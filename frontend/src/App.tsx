import { JsonEditorRoot } from "@/components/json/JsonEditorRoot"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Minus, Square, X } from "lucide-react"

const isTauriRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)

function App() {
  const onMinimize = async () => {
    if (!isTauriRuntime) return
    await getCurrentWindow().minimize()
  }

  const onMaximize = async () => {
    if (!isTauriRuntime) return
    await getCurrentWindow().toggleMaximize()
  }

  const onClose = async () => {
    if (!isTauriRuntime) return
    await getCurrentWindow().close()
  }

  return (
    <div className="h-screen w-full bg-[#0B1F3A] text-white">
      <header className="flex h-10 items-center justify-between border-b border-white/10 px-2">
        <div className="w-28 text-sm font-medium text-white/80">easyJson</div>
        <div data-tauri-drag-region className="flex-1 text-center text-xs text-white/70">
          easyJson
        </div>
        <div className="flex w-28 items-center justify-end gap-1">
          <button
            type="button"
            className="rounded-md p-1.5 text-[#F59E0B] hover:bg-[#102c57]"
            onClick={onMinimize}
            aria-label="Minimize"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-[#F59E0B] hover:bg-[#102c57]"
            onClick={onMaximize}
            aria-label="Maximize"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-[#F59E0B] hover:bg-[#102c57]"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="h-[calc(100vh-2.5rem)] w-full p-4">
        <JsonEditorRoot />
      </div>
    </div>
  )
}

export default App
