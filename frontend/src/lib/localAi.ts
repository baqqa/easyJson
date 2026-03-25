import { invoke } from "@tauri-apps/api/core"

export type LocalAiResponse = {
  answer_text: string
  jump_path?: string[] | null
  diagnostics?: {
    latency_ms: number
    tokens_used: number
    fallback_used: boolean
  }
}

export type LocalAiHealth = {
  healthy: boolean
  model_loaded: boolean
  model_path?: string | null
  message: string
}

export async function askLocalAi(input: {
  question: string
  jsonText: string
  currentPath: Array<string | number>
}): Promise<LocalAiResponse> {
  const currentPath = input.currentPath.map((seg) => String(seg))
  const response = await invoke<LocalAiResponse>("ai_ask", {
    question: input.question,
    jsonText: input.jsonText,
    currentPath,
  })
  return response
}

export async function localAiHealth() {
  return invoke<LocalAiHealth>("ai_health")
}
