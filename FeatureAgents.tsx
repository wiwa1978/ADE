export type FeatureAgent = {
  id: string
  parentId: string
  assignmentId: string
  name: string
  assignment: string
  status: "running" | "waiting" | "blocked" | "failed" | "completed" | "unknown"
  model: string | null
  reasoning: string
  error: string | null
  messages: { id: string; role: "user" | "assistant"; content: string }[]
}
