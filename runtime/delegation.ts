import { configure, defineExtension, defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";

export function createDelegationTools(readTools: readonly ToolRegistration[]) {
	return defineExtension({
		name: "ade-delegation",
		tools: [defineTool({
			name: "delegate",
			description: "Delegate a bounded, independent analysis to a read-only subagent in this feature workspace. Provide all necessary context. Returns its report; it cannot edit files, run commands, or delegate further.",
			parameters: obj({ name: str(), task: str() }),
			replay: "safe",
			async execute(args, api, context) {
				if (!args.name.trim() || args.name.length > 100 || !args.task.trim() || args.task.length > 8000) {
					throw new Error("Provide a short subagent name and an assignment between 1 and 8000 characters.");
				}
				const id = await api.commit(async tx => {
					const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
					if (existing) return existing.id;
					const child = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
					await configure(tx, child.id, {
						modelTools: readTools,
						maxTurns: 8,
						instructions: "You are a read-only subagent assigned to one ADE feature. Complete only the supplied assignment and return a concise report. Use available read tools for this feature's workspace. You cannot edit files, run commands, access GitHub, or delegate. Do not claim capabilities you do not have.",
					});
					await tx.appendEntry(child.id, { kind: "ade.assignment", data: { name: args.name.trim(), task: args.task } });
					return child.id;
				}, context);
				await api.details({ conversationId: id, name: args.name.trim() }, context);
				const child = await api.conversation(id, context);
				if (!child) throw new Error("The saved subagent conversation is unavailable.");
				const submission = await child.submit({ type: "input", content: args.task, requestId: `ade-delegate:${api.taskId}` }, context);
				const settled = await submission.wait(context);
				if (settled.status !== "done") {
					return { isError: true, output: [{ type: "text", text: `Subagent did not complete: ${settled.reason}` }] };
				}
				const entry = settled.answer ? await api.commit(tx => tx.entry(settled.answer!), context) : undefined;
				const text = entry?.model?.filter(message => message.role === "assistant")
					.flatMap(message => message.content.filter(part => part.type === "text").map(part => part.text)).join("\n");
				if (!text?.trim()) throw new Error("The subagent completed without a text report.");
				return { output: [{ type: "text", text }], details: { conversationId: id, name: args.name.trim() } };
			},
		})],
	});
}
