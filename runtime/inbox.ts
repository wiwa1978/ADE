// Session "attention" model: one place that decides whether a session is working, needs the user,
// is ready to review, or has a pull request in some state. The UI's Inbox, sidebar dots, and the
// project session list all read from here so the states and their wording stay consistent.
import { getWorkspaceGitSummary } from "./workspace-files.ts";
import type { PullRequestInfo, SessionGit } from "./session-git.ts";

export type SessionState =
	| "working"
	| "needs-approval"
	| "failed"
	| "checks-failing"
	| "ready-to-review"
	| "pr-open"
	| "replied"
	| "merged"
	| "idle";

export type InboxEntry = {
	sessionId: string;
	state: SessionState;
	/** True when the user should look at this session (shown in the Inbox). */
	needsYou: boolean;
	pendingApprovals: number;
	uncommitted: number;
	commitsAhead: number;
	pullRequest: Pick<PullRequestInfo, "number" | "url" | "state" | "isDraft" | "checksSummary" | "reviewDecision"> | null;
	updatedAt: number | null;
};

type SessionLike = {
	id: string;
	status: string;
	archivedAt?: number | null;
	updatedAt?: number | null;
	lastTurnStatus?: string | null;
	workspace?: { kind: string; path: string | null; status: string } | undefined;
};

type HostLike = {
	sessions(): SessionLike[];
	getWorkspacePath(sessionId: string): string | null;
	getWorkspaceBase(sessionId: string): string | null;
	approvals: { listPending(sessionId?: string): { sessionId: string }[] };
};

const PR_TTL_MS = 60_000;
const GIT_TTL_MS = 10_000;

/** Ordered by urgency: the first states need the user most. */
export const stateOrder: SessionState[] = ["needs-approval", "failed", "checks-failing", "replied", "ready-to-review", "pr-open", "working", "merged", "idle"];

export function deriveState(input: {
	working: boolean;
	pendingApprovals: number;
	lastTurnStatus: string | null | undefined;
	uncommitted: number;
	commitsAhead: number;
	pullRequest: InboxEntry["pullRequest"];
	seen: boolean;
}): { state: SessionState; needsYou: boolean } {
	const pr = input.pullRequest;
	if (input.pendingApprovals > 0) return { state: "needs-approval", needsYou: true };
	if (input.working) return { state: "working", needsYou: false };
	if (input.lastTurnStatus === "failed" || input.lastTurnStatus === "blocked") return { state: "failed", needsYou: !input.seen };
	if (pr?.state === "MERGED") return { state: "merged", needsYou: false };
	if (pr?.state === "OPEN" && pr.checksSummary === "failure") return { state: "checks-failing", needsYou: true };
	if (pr?.state === "OPEN") return { state: "pr-open", needsYou: pr.reviewDecision === "CHANGES_REQUESTED" };
	if (input.uncommitted > 0 || input.commitsAhead > 0) return { state: "ready-to-review", needsYou: !input.seen };
	if (input.lastTurnStatus === "completed") return { state: "replied", needsYou: !input.seen };
	return { state: "idle", needsYou: false };
}

export function createInbox(host: HostLike, sessionGit: SessionGit) {
	const prCache = new Map<string, { at: number; value: InboxEntry["pullRequest"]; branch: string | null }>();
	const gitCache = new Map<string, { at: number; uncommitted: number; commitsAhead: number; branch: string | null; upstream: string | null }>();
	const refreshing = new Set<string>();
	/** Sessions whose latest state the user has seen (cleared when the session changes again). */
	const seenAt = new Map<string, number>();

	async function refreshGit(sessionId: string, workspace: string) {
		const base = host.getWorkspaceBase(sessionId);
		try {
			const [summary, status] = await Promise.all([getWorkspaceGitSummary(workspace), sessionGit.status(workspace, base)]);
			gitCache.set(sessionId, { at: Date.now(), uncommitted: summary.files.length, commitsAhead: status.commitsAhead, branch: status.branch, upstream: status.upstream });
		} catch {
			gitCache.set(sessionId, { at: Date.now(), uncommitted: 0, commitsAhead: 0, branch: null, upstream: null });
		}
	}

	async function refreshPullRequest(sessionId: string, workspace: string) {
		if (refreshing.has(sessionId)) return;
		refreshing.add(sessionId);
		try {
			const pr = await sessionGit.pullRequest(workspace);
			prCache.set(sessionId, {
				at: Date.now(),
				branch: pr?.headRefName ?? null,
				value: pr ? { number: pr.number, url: pr.url, state: pr.state, isDraft: pr.isDraft, checksSummary: pr.checksSummary, reviewDecision: pr.reviewDecision } : null,
			});
		} catch {
			// gh missing or offline: keep the previous value, try again after the TTL.
			const previous = prCache.get(sessionId);
			prCache.set(sessionId, { at: Date.now(), branch: previous?.branch ?? null, value: previous?.value ?? null });
		} finally {
			refreshing.delete(sessionId);
		}
	}

	return {
		markSeen(sessionId: string) {
			seenAt.set(sessionId, Date.now());
		},
		/** Forget cached PR data so the next read refreshes it (after push, create, or merge). */
		invalidate(sessionId: string) {
			prCache.delete(sessionId);
			gitCache.delete(sessionId);
		},
		async entries(): Promise<InboxEntry[]> {
			const approvals = host.approvals.listPending();
			const sessions = host.sessions().filter(session => !session.archivedAt);
			const now = Date.now();
			const work: Promise<void>[] = [];
			for (const session of sessions) {
				const workspace = session.workspace?.kind && session.workspace.kind !== "none" ? host.getWorkspacePath(session.id) : null;
				if (!workspace) continue;
				const git = gitCache.get(session.id);
				if (!git || now - git.at > GIT_TTL_MS) work.push(refreshGit(session.id, workspace));
				const pr = prCache.get(session.id);
				// Only sessions whose branch has been pushed can have a pull request.
				if ((!pr || now - pr.at > PR_TTL_MS) && (git?.upstream || pr?.value)) void refreshPullRequest(session.id, workspace);
			}
			await Promise.all(work);
			return sessions.map(session => {
				const git = gitCache.get(session.id);
				const pullRequest = prCache.get(session.id)?.value ?? null;
				const pendingApprovals = approvals.filter(item => item.sessionId === session.id).length;
				const seen = (seenAt.get(session.id) ?? 0) >= (session.updatedAt ?? 0);
				const { state, needsYou } = deriveState({
					working: session.status === "working",
					pendingApprovals,
					lastTurnStatus: session.lastTurnStatus,
					uncommitted: git?.uncommitted ?? 0,
					commitsAhead: git?.commitsAhead ?? 0,
					pullRequest,
					seen,
				});
				return {
					sessionId: session.id,
					state,
					needsYou,
					pendingApprovals,
					uncommitted: git?.uncommitted ?? 0,
					commitsAhead: git?.commitsAhead ?? 0,
					pullRequest,
					updatedAt: session.updatedAt ?? null,
				};
			});
		},
	};
}

export type Inbox = ReturnType<typeof createInbox>;
