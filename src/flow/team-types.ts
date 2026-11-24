// The team board as the Team view gets it from the runtime (GET /api/sessions/:id/team).
export type TeamTask = {
  id: string
  title: string
  detail: string
  owner: string | null
  createdBy: string
  status: "todo" | "in_progress" | "done" | "dropped"
  dependsOn: string[]
  plan: { text: string; status: "waiting" | "approved" | "returned"; note: string; at: number } | null
  returnedNote: string
  result: string
  updatedAt: number
}
export type TeamPost = { seq: number; at: number; author: string; to: string[]; kind: "question" | "finding" | "answer" | "update"; text: string; re: number | null }
export type TeamClaim = { agent: string; path: string; at: number }
export type TeamEvent = { seq: number; at: number; part: "tasks" | "plans" | "board" | "claims"; action: string; direction: "in" | "out"; from: string; to: string[]; subject: string; text: string; count: number }
export type TeamView = { tasks: TeamTask[]; posts: TeamPost[]; claims: TeamClaim[]; events: TeamEvent[]; requirePlans: boolean }
