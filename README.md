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

The returned message is added as the tool result after the wait. Cancelling the
agent cancels the timer and reports an aborted sleep. The maximum duration is
the largest timeout supported by Node.js.

Install with:

```text
pi install git:github.com/jrhuebers/pi-sleep
```
