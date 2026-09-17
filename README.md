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
result after the wait. Cancelling the agent cancels the timer and reports an
aborted sleep. In the TUI, durations are shown as seconds below a minute,
`Nmin` for whole minutes, `Nh` for whole hours, and `HH:MM:SS` otherwise. The
maximum duration is the largest timeout supported by Node.js.

Install with:

```text
pi install git:github.com/jrhuebers/pi-sleep
```
