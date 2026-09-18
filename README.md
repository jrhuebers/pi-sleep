# pi-sleep

A small Pi extension that provides a foreground `sleep` tool. It waits inside
an active tool execution, so Pi remains blocked until the delay ends instead of
starting a background shell process.

## Tool

```ts
sleep({
  seconds: number, // positive; fractional seconds allowed
  message: string, // returned to the session when the wait ends or is interrupted
  background_job_ids?: string[], // available when pi-background-tasks is installed
  slurm_job_ids?: string[], // available when pi-slurm is installed
})
```

The message is shown in the tool call immediately and added as the tool
result after the wait. While sleeping, the TUI updates elapsed/total progress
once per second, such as `05/30s: "message"`. The elapsed counter uses a
stable `SS` format for sleeps under a minute, `MM:SS` for sleeps under an hour,
and `HH:MM:SS` for longer sleeps. The total duration after `/` remains in its
human-readable form (`30s`, `10min`, `2h`, `MM:SS`, or `HH:MM:SS`). When an
observed job interrupts a sleep, the elapsed value is frozen at that point
rather than changing to the requested duration. The call also shows a second
line listing the background and/or Slurm job IDs that can interrupt it.
Cancelling the agent cancels the timer and reports an aborted sleep.

When `pi-background-tasks` is installed, `background_job_ids` is available; when
`pi-slurm` is installed, `slurm_job_ids` is available.  Supplying either field
interrupts the sleep as soon as any listed job exits (or, for Slurm, reaches a
terminal state). The result identifies the job that interrupted it and says how
long the sleep actually lasted; its structured details also include
`interrupted_after_seconds`. The fields are omitted from the tool schema when
their companion extension is absent.

The maximum duration is the largest timeout supported by Node.js.

Install with:

```text
pi install git:github.com/jrhuebers/pi-sleep
```
