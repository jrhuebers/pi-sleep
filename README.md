# pi-sleep

A small Pi extension that provides a foreground `sleep` tool. It waits inside an active tool execution, so Pi remains blocked until the delay ends instead of starting a background shell process.

## Tool

```ts
sleep({
  seconds: number, // positive; fractional seconds allowed
  message: string, // returned to the session when the wait ends or is interrupted
  background_job_ids?: string[], // available when pi-background-tasks is installed
  slurm_job_ids?: string[], // available when pi-slurm is installed
  runai_job_ids?: string[], // available when pi-runai is installed; cluster/project/name
})
```

The message is shown in the tool call immediately and added as the tool result after the wait. While sleeping, the TUI updates elapsed/total progress once per second, such as `05/30s: "message"`. The elapsed counter uses a stable `SS` format for sleeps under a minute, `MM:SS` for sleeps under an hour, and `HH:MM:SS` for longer sleeps. The total duration after `/` remains in its human-readable form (`30s`, `10min`, `2h`, `MM:SS`, or `HH:MM:SS`). When an observed job interrupts a sleep, the elapsed value is frozen at that point rather than changing to the requested duration. The call also shows a second line listing the background, Slurm and/or Run:ai job IDs that can interrupt it. Cancelling the agent cancels the timer and reports an aborted sleep.

When `pi-background-tasks` is installed, `background_job_ids` is available; when `pi-slurm` is installed, `slurm_job_ids` is available; when `pi-runai` is installed, `runai_job_ids` is available. Supplying these fields interrupts the sleep as soon as any listed job exits or reaches a terminal state. For Run:ai, use the full tracked ID returned by `runai_submit` or `runai_track`, not just the job name: completion, failure and cancellation interrupt; preemption, restarting, unknown states and missing jobs do not.

Completion events are tracked for the whole session, so a job that finished just before the sleep call still interrupts immediately. Persisted completion state is checked on the current session branch, including after reload or tree navigation. The result identifies the job that interrupted it and says how long the sleep actually lasted; its structured details also include `interrupted_after_seconds`. The fields are omitted from the tool schema when their companion extension is absent.

```ts
sleep({
  seconds: 3600,
  message: "Check the experiment logs and artifacts.",
  runai_job_ids: ["cluster/project/experiment-001"],
})
```

The maximum duration is the largest timeout supported by Node.js. Run:ai completion detection uses pi-runai's asynchronous monitor, so interruption follows its polling cadence rather than instantaneous scheduler delivery.

## Install

```text
pi install git:github.com/jrhuebers/pi-sleep
```

## Development

Install dev dependencies with `npm install --legacy-peer-deps`. Make the peer packages available from your Pi installation, or install compatible versions with `--no-save`; Pi supplies these peers when loading managed packages.

```sh
npm test
npm run typecheck
# Optional integration tests against a reviewed pi-runai source checkout:
PI_RUNAI_EXTENSION=../pi-runai/extensions/index.ts npm test
```

The integration tests load both real extension factories with a mocked Run:ai CLI. They never submit or delete cluster workloads.
