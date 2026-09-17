import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const MAX_TIMEOUT_MS = 2_147_483_647;

type SleepRenderState = {
	startedAt?: number;
	timer?: ReturnType<typeof setInterval>;
};

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

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			if (signal) signal.removeEventListener("abort", abort);
			resolve();
		}, milliseconds);

		const abort = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (signal) signal.removeEventListener("abort", abort);
			reject(new Error("Sleep aborted."));
		};

		if (signal?.aborted) abort();
		else signal?.addEventListener("abort", abort, { once: true });
	});
}

export default function sleepExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "sleep",
		label: "Sleep",
		description: "Wait for a specified number of seconds, then return a message. This blocks the agent in the foreground until the wait ends.",
		promptSnippet: "Wait in the foreground for a duration, then continue with a message",
		promptGuidelines: [
			"Use sleep instead of bash sleep when the agent must remain blocked until a delay ends.",
			"sleep is foreground-only: do not use it for work that should continue in the background.",
		],
		parameters: Type.Object({
			seconds: Type.Number({
				exclusiveMinimum: 0,
				maximum: MAX_TIMEOUT_MS / 1_000,
				description: "How many seconds to wait. Fractional seconds are allowed.",
			}),
			message: Type.String({ description: "Message to inject into the session when the wait ends." }),
		}),
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

			const elapsed = !context.isPartial && !context.isError
				? duration
				: state.startedAt === undefined
					? formatProgressDuration(0, includeHours, includeMinutes)
					: formatProgressDuration(
						Math.min(totalSeconds, Math.floor((Date.now() - state.startedAt) / 1_000)),
						includeHours,
						includeMinutes,
					);
			const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			component.setText(
				theme.fg("toolTitle", theme.bold("sleep ")) +
					theme.fg("muted", `${elapsed}/${duration}`) +
					theme.fg("dim", `: ${JSON.stringify(message)}`),
			);
			return component;
		},

		renderResult(result, _options, theme) {
			const text = result.content.find((part) => part.type === "text");
			return new Text(theme.fg("success", "✓ ") + theme.fg("dim", text?.type === "text" ? text.text : "Sleep finished."), 0, 0);
		},

		async execute(_toolCallId, params, signal) {
			if (!Number.isFinite(params.seconds) || params.seconds <= 0) {
				throw new Error("seconds must be a positive finite number.");
			}
			const message = params.message.trim();
			if (!message) throw new Error("message must not be empty.");

			await wait(Math.round(params.seconds * 1_000), signal);
			return {
				content: [{ type: "text", text: message }],
				details: { seconds: params.seconds },
			};
		},
	});
}
