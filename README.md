# pi-sleep

A small Pi extension that provides a foreground `sleep` tool. It waits inside
an active tool execution, so Pi remains blocked until the delay ends instead of
starting a background shell process.

## Tool

```ts
sleep({
  seconds: number, // positive; fractional seconds allowed
  message: string, // returned to the session when the wait ends
})
```

The message is shown in the tool call immediately and added as the tool
result after the wait. While sleeping, the TUI updates elapsed/total progress
once per second, such as `05/30s: "message"`. The elapsed counter uses a
stable `SS` format for sleeps under a minute, `MM:SS` for sleeps under an hour,
and `HH:MM:SS` for longer sleeps. The total duration after `/` remains in its
human-readable form (`30s`, `10min`, `2h`, or `HH:MM:SS`).
Cancelling the agent cancels the timer and reports an aborted sleep.
The maximum duration is the largest timeout supported by Node.js.

Install with:

```text
pi install git:github.com/jrhuebers/pi-sleep
```
