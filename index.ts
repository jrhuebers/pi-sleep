import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const MAX_TIMEOUT_MS = 2_147_483_647;

type SleepRenderState = {
	startedAt?: number;
	finalElapsedSeconds?: number;
	timer?: ReturnType<typeof setInterval>;
};

type SleepFeatures = {
	backgroundTasks: boolean;
	slurm: boolean;
};

type WatchedJob = {
	id: string;
	source: "background" | "slurm";
	event: string;
};

type SleepParams = {
	seconds: number;
	message: string;
	background_job_ids?: string[];
	slurm_job_ids?: string[];
};

type SleepWaiter = {
	jobs: WatchedJob[];
	finish: (job?: WatchedJob) => void;
	abort: () => void;
};

type SleepTracker = {
	finished: Map<string, WatchedJob>;
	waiters: Set<SleepWaiter>;
};

function jobKey(job: WatchedJob): string {
	return `${job.source}:${job.id}`;
}

function eventJob(source: WatchedJob["source"], event: unknown): WatchedJob | undefined {
	if (typeof event !== "object" || event === null || typeof (event as { id?: unknown }).id !== "string") return undefined;
	return {
		id: (event as { id: string }).id,
		source,
		event: source === "background" ? "background-tasks:finished" : "slurm:finished",
	};
}

function rememberFinished(tracker: SleepTracker, job: WatchedJob): void {
	tracker.finished.set(jobKey(job), job);
	while (tracker.finished.size > 4_096) {
		const oldest = tracker.finished.keys().next().value as string | undefined;
		if (oldest === undefined) break;
		tracker.finished.delete(oldest);
	}
	for (const waiter of [...tracker.waiters]) {
		if (waiter.jobs.some((watched) => jobKey(watched) === jobKey(job))) waiter.finish(job);
	}
}

function createSleepTracker(pi: ExtensionAPI): SleepTracker {
	const tracker: SleepTracker = { finished: new Map(), waiters: new Set() };
	pi.events.on("background-tasks:finished", (data) => {
		const job = eventJob("background", data);
		if (job) rememberFinished(tracker, job);
	});
	pi.events.on("slurm:finished", (data) => {
		const job = eventJob("slurm", data);
		if (job) rememberFinished(tracker, job);
	});
	return tracker;
}

function abortTrackedSleeps(tracker: SleepTracker): void {
	for (const waiter of [...tracker.waiters]) waiter.abort();
	tracker.finished.clear();
}

function persistedFinishedJobs(ctx: ExtensionContext, jobs: WatchedJob[]): WatchedJob[] {
	const entries = ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>;
	const latest = (customType: string): Record<string, unknown> | undefined => {
		const data = [...entries].reverse().find((entry) => entry.type === "custom" && entry.customType === customType)?.data;
		return typeof data === "object" && data !== null ? data as Record<string, unknown> : undefined;
	};
	const backgroundState = latest("pi-background-tasks-state");
	const finishedBackground = new Set(
		Array.isArray(backgroundState?.finishedJobIds)
			? backgroundState.finishedJobIds.filter((id): id is string => typeof id === "string")
			: [],
	);
	const slurmState = latest("pi-research-engineer-slurm-state");
	const terminalSlurm = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMEOUT"]);
	const slurmJobs = Array.isArray(slurmState?.jobs) ? slurmState.jobs : [];
	return jobs.filter((job) => {
		if (job.source === "background") return finishedBackground.has(job.id);
		return slurmJobs.some((value) => {
			if (typeof value !== "object" || value === null) return false;
			const candidate = value as { id?: unknown; lastState?: unknown };
			return candidate.id === job.id && typeof candidate.lastState === "string" && terminalSlurm.has(candidate.lastState);
		});
	});
}

function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds)) return "?s";
	if (seconds < 60) return `${seconds}s`;

	const totalSeconds = Math.max(0, Math.round(seconds));
	const minutes = Math.floor(totalSeconds / 60);
	const remainingSeconds = totalSeconds % 60;
	if (totalSeconds < 3_600 && remainingSeconds === 0) return `${minutes}min`;

	const hours = Math.floor(totalSeconds / 3_600);
	const remainingMinutes = Math.floor((totalSeconds % 3_600) / 60);
	if (remainingMinutes === 0 && remainingSeconds === 0) return `${hours}h`;
	if (totalSeconds < 3_600) {
		return [minutes, remainingSeconds]
			.map((part) => part.toString().padStart(2, "0"))
			.join(":");
	}

	return [hours, remainingMinutes, remainingSeconds]
		.map((part) => part.toString().padStart(2, "0"))
		.join(":");
}

function formatProgressDuration(seconds: number, includeHours: boolean, includeMinutes: boolean): string {
	const empty = includeHours ? "--:--:--" : includeMinutes ? "--:--" : "--";
	if (!Number.isFinite(seconds) || seconds < 0) return empty;

	const totalSeconds = Math.round(seconds);
	const remainingSeconds = totalSeconds % 60;
	if (!includeMinutes) return remainingSeconds.toString().padStart(2, "0");

	const minutes = Math.floor(totalSeconds / 60);
	if (!includeHours) {
		return [minutes, remainingSeconds]
			.map((part) => part.toString().padStart(2, "0"))
			.join(":");
	}

	const hours = Math.floor(totalSeconds / 3_600);
	const remainingMinutes = Math.floor((totalSeconds % 3_600) / 60);
	return [hours, remainingMinutes, remainingSeconds]
		.map((part) => part.toString().padStart(2, "0"))
		.join(":");
}

function formatElapsedSeconds(seconds: number): string {
	const rounded = Math.round(seconds * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
}

function formatInterruptTargets(args: SleepParams): string | undefined {
	const targets = [
		Array.isArray(args.background_job_ids) && args.background_job_ids.length > 0
			? `background: ${args.background_job_ids.join(", ")}`
			: undefined,
		Array.isArray(args.slurm_job_ids) && args.slurm_job_ids.length > 0
			? `Slurm: ${args.slurm_job_ids.join(", ")}`
			: undefined,
	].filter((target): target is string => target !== undefined);
	return targets.length > 0 ? `interrupt on exit — ${targets.join("; ")}` : undefined;
}

function watchedIds(ids: string[] | undefined, field: string): string[] {
	if (!ids) return [];
	const unique = new Set<string>();
	for (const id of ids) {
		const trimmed = id.trim();
		if (!trimmed) throw new Error(`${field} must not contain an empty job ID.`);
		unique.add(trimmed);
	}
	return [...unique];
}

function waitForSleep(milliseconds: number, tracker: SleepTracker, jobs: WatchedJob[], signal?: AbortSignal): Promise<WatchedJob | undefined> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			if (timer) clearTimeout(timer);
			tracker.waiters.delete(waiter);
			if (signal) signal.removeEventListener("abort", abort);
		};
		const finish = (job?: WatchedJob) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(job);
		};
		const abort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(new Error("Sleep aborted."));
		};
		const waiter: SleepWaiter = { jobs, finish, abort };
		const alreadyFinished = () => jobs
			.map((job) => tracker.finished.get(jobKey(job)))
			.find((job): job is WatchedJob => job !== undefined);

		// The tracker is subscribed for the whole session, so completion events
		// that happened before this tool call are still observable here.
		const completedBeforeWait = alreadyFinished();
		if (completedBeforeWait) {
			finish(completedBeforeWait);
			return;
		}

		tracker.waiters.add(waiter);
		// Recheck after registration to make the ordering guarantee explicit.
		// JavaScript callbacks cannot interleave between the two synchronous
		// operations above, but this also protects future refactors.
		const completedAfterRegistration = alreadyFinished();
		if (completedAfterRegistration) {
			finish(completedAfterRegistration);
			return;
		}

		timer = setTimeout(() => finish(), milliseconds);
		if (signal?.aborted) abort();
		else signal?.addEventListener("abort", abort, { once: true });
	});
}

function registerSleepTool(pi: ExtensionAPI, features: SleepFeatures, tracker: SleepTracker): void {
	const properties = {
		seconds: Type.Number({
			exclusiveMinimum: 0,
			maximum: MAX_TIMEOUT_MS / 1_000,
			description: "How many seconds to wait. Fractional seconds are allowed.",
		}),
		message: Type.String({ description: "Message to inject into the session when the wait ends or is interrupted." }),
		...(features.backgroundTasks ? {
			background_job_ids: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
				minItems: 1,
				description: "Optional pi-background-tasks job IDs. Interrupt the sleep when any listed job exits.",
			})),
		} : {}),
		...(features.slurm ? {
			slurm_job_ids: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
				minItems: 1,
				description: "Optional pi-slurm job IDs. Interrupt the sleep when any listed job reaches a terminal state.",
			})),
		} : {}),
	};

	pi.registerTool({
		name: "sleep",
		label: "Sleep",
		description: "Wait for a specified number of seconds, then return a message. This blocks the agent in the foreground until the wait ends.",
		promptSnippet: "Wait in the foreground for a duration, then continue with a message",
		promptGuidelines: [
			"Use sleep instead of bash sleep when the agent must remain blocked until a delay ends.",
			"sleep is foreground-only: do not use it for work that should continue in the background.",
		],
		parameters: Type.Object(properties),
		renderCall(args, theme, context) {
			const state = context.state as SleepRenderState;
			const totalSeconds = typeof args.seconds === "number" ? args.seconds : Number.NaN;
			const includeHours = totalSeconds >= 3_600;
			const includeMinutes = totalSeconds >= 60;
			const duration = formatDuration(totalSeconds);
			const message = typeof args.message === "string" ? args.message.trim() : "?";

			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
			}
			if (context.executionStarted && context.isPartial && state.timer === undefined) {
				state.timer = setInterval(() => context.invalidate(), 1_000);
			}
			if (!context.isPartial && state.timer !== undefined) {
				clearInterval(state.timer);
				state.timer = undefined;
			}

			const elapsedSeconds = state.startedAt === undefined
				? 0
				: Math.min(totalSeconds, Math.floor((Date.now() - state.startedAt) / 1_000));
			if (!context.isPartial && state.finalElapsedSeconds === undefined) {
				state.finalElapsedSeconds = elapsedSeconds;
			}
			const elapsed = formatProgressDuration(
				state.finalElapsedSeconds ?? elapsedSeconds,
				includeHours,
				includeMinutes,
			);
			const interruptTargets = formatInterruptTargets(args as SleepParams);
			const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			component.setText(
				theme.fg("toolTitle", theme.bold("sleep ")) +
					theme.fg("muted", `${elapsed}/${duration}`) +
					theme.fg("dim", `: ${JSON.stringify(message)}`) +
					(interruptTargets ? `\n${theme.fg("dim", `  ${interruptTargets}`)}` : ""),
			);
			return component;
		},

		renderResult(result, _options, theme) {
			const interruptedBy = (result.details as { interruptedBy?: { source: "background" | "slurm"; jobId: string } } | undefined)?.interruptedBy;
			const summary = !interruptedBy
				? "Sleep completed."
				: interruptedBy.source === "background"
					? `Sleep interrupted early because background job ${interruptedBy.jobId} exited.`
					: `Sleep interrupted early because Slurm job ${interruptedBy.jobId} reached a terminal state.`;
			return new Text(theme.fg("success", "✓ ") + theme.fg("dim", summary), 0, 0);
		},

		async execute(_toolCallId, rawParams, signal, _onUpdate, ctx: ExtensionContext) {
			const params = rawParams as SleepParams;
			if (!Number.isFinite(params.seconds) || params.seconds <= 0) {
				throw new Error("seconds must be a positive finite number.");
			}
			const message = params.message.trim();
			if (!message) throw new Error("message must not be empty.");
			const backgroundJobIds = watchedIds(params.background_job_ids, "background_job_ids");
			const slurmJobIds = watchedIds(params.slurm_job_ids, "slurm_job_ids");
			if (backgroundJobIds.length > 0 && !features.backgroundTasks) throw new Error("background_job_ids requires pi-background-tasks.");
			if (slurmJobIds.length > 0 && !features.slurm) throw new Error("slurm_job_ids requires pi-slurm.");

			const watchedJobs: WatchedJob[] = [
				...backgroundJobIds.map((id) => ({ id, source: "background" as const, event: "background-tasks:finished" })),
				...slurmJobIds.map((id) => ({ id, source: "slurm" as const, event: "slurm:finished" })),
			];
			for (const job of persistedFinishedJobs(ctx, watchedJobs)) rememberFinished(tracker, job);
			const startedAt = Date.now();
			const interruptedBy = await waitForSleep(Math.round(params.seconds * 1_000), tracker, watchedJobs, signal);
			const interruptedAfterSeconds = Math.min(params.seconds, (Date.now() - startedAt) / 1_000);
			const text = interruptedBy
				? `Sleep interrupted after ${formatElapsedSeconds(interruptedAfterSeconds)} because ${interruptedBy.source} job ${interruptedBy.id} exited. ${message}`
				: message;
			return {
				content: [{ type: "text", text }],
				details: {
					seconds: params.seconds,
					...(interruptedBy ? {
						interruptedBy: { source: interruptedBy.source, jobId: interruptedBy.id },
						interrupted_after_seconds: interruptedAfterSeconds,
					} : {}),
				},
			};
		},
	});
}

export default function sleepExtension(pi: ExtensionAPI): void {
	// Subscribe during extension loading, before any session_start handlers can
	// restore jobs and emit terminal events. The old implementation subscribed
	// only inside execute(), which dropped completions that happened earlier.
	const tracker = createSleepTracker(pi);
	pi.on("session_shutdown", () => abortTrackedSleeps(tracker));
	pi.on("session_start", () => {
		const toolNames = new Set(pi.getAllTools().map((tool) => tool.name));
		registerSleepTool(pi, {
			backgroundTasks: toolNames.has("jobs"),
			slurm: toolNames.has("slurm_submit"),
		}, tracker);
	});
}
