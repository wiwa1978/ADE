import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeDenyRules, guardrailFor } from "./guardrails.ts";

const blocked = (command: string) => guardrailFor(command)?.id ?? null;

test("guardrails block merging, force-pushing, pushing to main, remote deletes and wiping the disk", () => {
	assert.equal(blocked("gh pr merge 12 --squash"), "merge");
	assert.equal(blocked("git push --force"), "force-push");
	assert.equal(blocked("git push -f origin ade/fix"), "force-push");
	assert.equal(blocked("git push origin +ade/fix"), "force-push");
	assert.equal(blocked("git push --force-with-lease=ade/fix"), "force-push");
	assert.equal(blocked("git push origin main"), "push-protected");
	assert.equal(blocked("git push origin HEAD:main"), "push-protected");
	assert.equal(blocked("git push origin refs/heads/master"), "push-protected");
	assert.equal(blocked("git push --all"), "push-protected");
	assert.equal(blocked("git push origin --delete ade/old"), "delete-remote");
	assert.equal(blocked("git push origin :ade/old"), "delete-remote");
	assert.equal(blocked("gh repo delete me/app --yes"), "delete-remote");
	assert.equal(blocked("rm -rf /"), "wipe");
	assert.equal(blocked("rm -rf ~"), "wipe");
	assert.equal(blocked("sudo rm -rf / --no-preserve-root"), "wipe");
});

test("guardrails can't be hidden inside compound commands", () => {
	assert.equal(blocked("npm test && git push -f"), "force-push");
	assert.equal(blocked("echo ok; gh pr merge 3"), "merge");
	assert.equal(blocked("(cd app && git push origin main)"), "push-protected");
	assert.equal(blocked("env GIT_TRACE=1 git push --force"), "force-push");
});

test("normal agent work is not blocked", () => {
	for (const command of [
		"git push", "git push -u origin ade/fix-login-1a2b", "git push origin feature-main", "git commit -m 'fix main menu'",
		"git merge origin/main", "gh pr create --fill", "gh pr view", "rm -rf node_modules", "rm -rf ./dist", "git branch -D ade/old",
	]) assert.equal(blocked(command), null, command);
});

test("Claude Code gets the same guardrails as deny rules", () => {
	const rules = claudeDenyRules();
	assert.ok(rules.includes("Bash(gh pr merge:*)"));
	assert.ok(rules.includes("Bash(git push --force:*)"));
	assert.ok(rules.every(rule => /^Bash\(.+:\*\)$/.test(rule)));
});
