import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { harness, stateEntry, flush } from "./harness.js";

const source = process.env.PI_RUNAI_EXTENSION;
const id = "cluster/project/job";
const integration = { skip: !source && "Set PI_RUNAI_EXTENSION to test the real pi-runai extension" };

async function setup(sleepFirst: boolean) {
  const runai = (await import(pathToFileURL(resolve(source!)).href)).default;
  const h = harness([]);
  if (sleepFirst) h.loadSleep();
  runai(h.api);
  if (!sleepFirst) h.loadSleep();
  return h;
}

for (const sleepFirst of [true, false]) {
  const order = sleepFirst ? "sleep loaded first" : "Run:ai loaded first";
  test(`real pi-runai monitor completion wakes sleep (${order})`, integration, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const h = await setup(sleepFirst);
    try {
      await h.start();
      await h.fire("agent_start"); // Keep notifications from triggering unrelated model turns.
      await h.call("runai_submit", { name: "job", image: "example.org/test:latest" });
      const waiting = h.wait({ runai_job_ids: [id] });
      h.rows.set("job", "Succeeded");
      // Advance only interval timers: exercise the real asynchronous monitor
      // without waiting in real time or mocking sleep's completion timer.
      const rawInterval = Number(process.env.PI_RUNAI_POLL_INTERVAL_MS ?? 15000);
      t.mock.timers.tick(Number.isFinite(rawInterval) ? Math.max(5000, rawInterval) : 15000);
      const done = await waiting;
      assert.deepEqual(done.details.interruptedBy, { source: "runai", jobId: id });
      assert.equal(h.getBranch().at(-1).data.jobs[0].lastState, "COMPLETED");
    } finally { await h.stop(); }
  });

  test(`real pi-runai restored terminal jobs wake immediately (${order})`, integration, async () => {
    for (const status of ["COMPLETED", "FAILED", "CANCELLED"]) {
      const h = await setup(sleepFirst);
      h.setBranch([stateEntry(status)]);
      try {
        await h.start();
        assert.equal((await h.wait({ runai_job_ids: [id] })).details.interruptedBy.jobId, id);
        await h.fire("session_tree");
        assert.equal((await h.wait({ runai_job_ids: [id] })).details.interruptedBy.jobId, id);
      } finally { await h.stop(); }
    }
  });
}

test("real pi-runai cancellation wakes an active sleep", integration, async () => {
  const h = await setup(true);
  try {
    await h.start();
    await h.fire("agent_start");
    await h.call("runai_submit", { name: "job", image: "example.org/test:latest" });
    const result = h.wait({ runai_job_ids: [id] });
    await h.call("runai_cancel", { job_id: id, reason: "mock-only obsolete job", confirm: true });
    assert.deepEqual((await result).details.interruptedBy, { source: "runai", jobId: id });
    assert(h.commands.some(args => args[0] === "delete"));
  } finally { await h.stop(); }
});

test("real pi-runai preemption, unknown states and missing jobs never wake sleep", integration, async () => {
  for (const status of ["Preempted", "Restarting", "NewState", undefined]) {
    const h = await setup(true);
    h.setBranch([stateEntry("PENDING")]);
    if (status) h.rows.set("job", status);
    try {
      await h.start();
      await flush();
      const done = await h.wait({ seconds: 0.001, runai_job_ids: [id] });
      assert.equal(done.details.interruptedBy, undefined);
    } finally { await h.stop(); }
  }
});
