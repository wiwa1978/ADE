// Runs automations: checks schedules every minute and labelled issues every few minutes, and starts
// a session in its own worktree for each run. Runs never overlap per automation: while the previous
// run's agent is still working, the next one waits.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { AutomationStore, scheduleIsDue, type Automation } from "./automations.ts";
import type { Conversation } from "../packages/protocol/index.ts";

const execute = promisify(execFile);

type Issue = { number: number; title: string; body: string; url: string };

export type AutomationRunnerDeps = {
	store: AutomationStore;
	projects: () => Array<{ id: string; name?: string; repository?: string | null; githubUrl?: string | null } | null | undefined>;
	sessions: () => Conversation[];
	createSession: (input: Record<string, unknown>) => Promise<Conversation | undefined>;
	setEngine: (sessionId: string, engine: string) => void;
	prepareWorktree: (session: Conversation) => void;
	sendToAgent: (sessionId: string, content: string) => Promise<unknown>;
	listLabelledIssues?: (repository: string, label: string, cwd: string) => Promise<Issue[]>;
	now?: () => number;
};

function repoSlug(githubUrl: string | null | undefined) {
	const match = /github\.com\/([^/]+)\/([^/.]+)/i.exec(githubUrl ?? "");
	return match ? `${match[1]}/${match[2]}` : null;
}

async function ghLabelledIssues(repository: string, label: string, cwd: string): Promise<Issue[]> {
	const { stdout } = await execute("gh", ["issue", "list", "-R", repository, "--label", label, "--state", "open", "--limit", "30", "--json", "number,title,body,url"], {
		cwd, timeout: 60_000, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
	});
	const parsed = JSON.parse(stdout) as unknown;
	return Array.isArray(parsed) ? parsed.map(item => ({ number: Number(item.number), title: String(item.title ?? ""), body: String(item.body ?? ""), url: String(item.url ?? "") })) : [];
}

export function fillPrompt(prompt: string, issue?: Issue) {
	if (!issue) return prompt.replace(/\{\{issue\}\}/g, "").trim();
	const details = `#${issue.number}: ${issue.title}\n${issue.url}\n\n${issue.body.trim()}`.trim();
	return prompt.includes("{{issue}}") ? prompt.replace(/\{\{issue\}\}/g, details) : `${prompt}\n\nIssue ${details}`;
}

export function createAutomationRunner(deps: AutomationRunnerDeps) {
	const now = deps.now ?? Date.now;
	const listIssues = deps.listLabelledIssues ?? ghLabelledIssues;
	const running = new Set<string>();
	let lastIssueCheck = 0;
	let timer: ReturnType<typeof setInterval> | null = null;
	let firstTick: ReturnType<typeof setTimeout> | null = null;
	const safeTick = () => { void tick().catch(() => undefined); };

	/** True while the automation's previous session is still working. */
	const previousStillWorking = (automation: Automation) => {
		const last = automation.runs[0]?.sessionId;
		return Boolean(last && deps.sessions().find(session => session.id === last)?.status === "working");
	};

	async function run(automation: Automation, reason: string, issue?: Issue) {
		if (running.has(automation.id)) throw Object.assign(new Error("This automation is already starting a run."), { statusCode: 409 });
		running.add(automation.id);
		const at = now();
		try {
			const project = deps.projects().find(item => item?.id === automation.projectId);
			if (!project?.repository) throw new Error("The project has no local checkout to work in.");
			const id = randomUUID();
			const stamp = new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
			const title = (issue ? `${automation.name}: #${issue.number} ${issue.title}` : `${automation.name} · ${stamp}`).slice(0, 120);
			const slug = repoSlug(project.githubUrl);
			const session = await deps.createSession({
				id,
				title,
				repository: project.repository,
				kind: "worktree",
				projectId: project.id,
				...(issue && slug ? { githubIssue: { repository: slug, number: issue.number, title: issue.title.slice(0, 300) || `Issue ${issue.number}`, body: issue.body.slice(0, 5000), state: "open", url: issue.url, truncated: issue.body.length > 5000 } } : {}),
			});
			if (!session) throw new Error("The session could not be created.");
			if (session.workspace?.status !== "ready") throw new Error(session.workspace?.message || "The session's worktree could not be created.");
			deps.prepareWorktree(session);
			if (automation.agent !== "pi") deps.setEngine(id, automation.agent);
			await deps.sendToAgent(id, fillPrompt(automation.prompt, issue));
			deps.store.recordRun(automation.id, { at, sessionId: id, reason }, issue?.number);
			return id;
		} catch (error) {
			deps.store.recordRun(automation.id, { at, sessionId: null, reason, error: error instanceof Error ? error.message : String(error) }, issue?.number);
			throw error;
		} finally {
			running.delete(automation.id);
		}
	}

	async function tick() {
		const time = now();
		for (const automation of deps.store.all()) {
			if (!automation.enabled || running.has(automation.id) || previousStillWorking(automation)) continue;
			if (automation.trigger.type === "schedule" && scheduleIsDue(automation, time)) {
				await run(automation, "Scheduled").catch(() => undefined);
			}
		}
		// Labelled issues: poll GitHub every 5 minutes.
		if (time - lastIssueCheck < 5 * 60_000) return;
		lastIssueCheck = time;
		for (const automation of deps.store.all()) {
			if (!automation.enabled || automation.trigger.type !== "issue-label" || running.has(automation.id) || previousStillWorking(automation)) continue;
			const project = deps.projects().find(item => item?.id === automation.projectId);
			const slug = repoSlug(project?.githubUrl);
			if (!slug || !project?.repository) continue;
			try {
				const issues = await listIssues(slug, automation.trigger.label, project.repository);
				// One new issue per check, oldest first, so a burst of labels doesn't start many agents at once.
				const next = issues.filter(issue => !automation.seenIssues.includes(issue.number)).sort((a, b) => a.number - b.number)[0];
				if (next) await run(automation, `Issue #${next.number} labelled ${automation.trigger.label}`, next).catch(() => undefined);
			} catch {
				// gh unavailable or offline: try again next time.
			}
		}
	}

	return {
		run,
		tick,
		/** Issues that already carry the label when an automation is created are not picked up. */
		async currentIssues(projectId: string, label: string) {
			const project = deps.projects().find(item => item?.id === projectId);
			const slug = repoSlug(project?.githubUrl);
			if (!slug || !project?.repository) return [];
			return (await listIssues(slug, label, project.repository).catch(() => [])).map(issue => issue.number);
		},
		start() {
			if (timer) return;
			timer = setInterval(safeTick, 60_000);
			timer.unref?.();
			firstTick = setTimeout(safeTick, 5_000);
			firstTick.unref?.();
		},
		stop() {
			if (timer) clearInterval(timer);
			if (firstTick) clearTimeout(firstTick);
			timer = null;
			firstTick = null;
		},
	};
}

export type AutomationRunner = ReturnType<typeof createAutomationRunner>;
