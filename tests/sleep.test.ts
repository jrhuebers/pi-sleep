import test from "node:test";
import assert from "node:assert/strict";
import { harness, stateEntry } from "./harness.js";

const id = "cluster/project/job";

test("Run:ai schema is exposed only with pi-runai; missing companion is rejected", async () => {
  for (const installed of [false, true]) {
    const h = harness(installed ? ["runai_submit"] : []);
    h.loadSleep();
    await h.start();
    try {
      assert.equal("runai_job_ids" in h.tools.get("sleep").parameters.properties, installed);
      if (!installed) await assert.rejects(h.wait({ runai_job_ids: [id] }), /requires pi-runai/);
      else await assert.rejects(h.wait({ runai_job_ids: [" "] }), /empty job ID/);
    } finally { await h.stop(); }
  }
});

test("Run:ai completion interrupts an active sleep, with source and elapsed time", async () => {
  const h = harness();
  h.loadSleep();
  await h.start();
  try {
    const result = h.wait({ runai_job_ids: [id] });
    h.events.emit("runai:finished", { id, status: "COMPLETED" });
    const done = await result;
    assert.deepEqual(done.details.interruptedBy, { source: "runai", jobId: id });
    assert(done.details.interrupted_after_seconds < 2);
    assert.match(done.content[0].text, /runai job cluster\/project\/job exited/);
  } finally { await h.stop(); }
});

test("completion before the call is remembered and IDs are trimmed/deduplicated", async () => {
  const h = harness();
  h.loadSleep();
  h.events.emit("runai:finished", { id, status: "FAILED" });
  await h.start();
  try {
    const done = await h.wait({ runai_job_ids: [` ${id} `, id] });
    assert.equal(done.details.interruptedBy.jobId, id);
  } finally { await h.stop(); }
});

test("unrelated IDs, malformed events and other job sources cannot wake Run:ai sleep", async () => {
  const h = harness(["runai_submit", "jobs", "slurm_submit"]);
  h.loadSleep();
  await h.start();
  try {
    h.events.emit("runai:finished", null);
    h.events.emit("runai:finished", { id: 123 });
    h.events.emit("runai:finished", { id: "other/project/job" });
    h.events.emit("slurm:finished", { id });
    h.events.emit("background-tasks:finished", { id });
    const done = await h.wait({ seconds: 0.01, runai_job_ids: [id] });
    assert.equal(done.details.interruptedBy, undefined);
    assert.equal(done.content[0].text, "Inspect artifacts.");
  } finally { await h.stop(); }
});

test("background, Slurm and mixed waits retain their behavior", async () => {
  const h = harness(["runai_submit", "jobs", "slurm_submit"]);
  h.loadSleep();
  await h.start();
  try {
    for (const [field, source, event] of [
      ["background_job_ids", "background", "background-tasks:finished"],
      ["slurm_job_ids", "slurm", "slurm:finished"],
      ["runai_job_ids", "runai", "runai:finished"],
    ]) {
      const result = h.wait({ [field]: [source] });
      h.events.emit(event, { id: source });
      assert.deepEqual((await result).details.interruptedBy, { source, jobId: source });
    }
    const mixed = await h.wait({ background_job_ids: ["pending"], runai_job_ids: ["runai"] });
    assert.equal(mixed.details.interruptedBy.source, "runai");
  } finally { await h.stop(); }
});

test("persisted Run:ai terminal states wake immediately without receiving an event", async () => {
  for (const status of ["COMPLETED", "FAILED", "CANCELLED"]) {
    const h = harness();
    h.loadSleep();
    h.setBranch([stateEntry(status)]);
    await h.start();
    try { assert.equal((await h.wait({ runai_job_ids: [id] })).details.interruptedBy.jobId, id); }
    finally { await h.stop(); }
  }
});

test("nonterminal, malformed and unsupported persisted states do not imply completion", async () => {
  for (const status of ["PENDING", "RUNNING", "SUSPENDED", "UNKNOWN", "Preempted", "TIMEOUT"]) {
    const h = harness();
    h.loadSleep();
    h.setBranch([stateEntry(status)]);
    await h.start();
    try {
      assert.equal((await h.wait({ seconds: 0.001, runai_job_ids: [id] })).details.interruptedBy, undefined);
    } finally { await h.stop(); }
  }
  const h = harness();
  h.loadSleep();
  const entry = stateEntry("COMPLETED");
  entry.data.version = 99;
  h.setBranch([entry, { type: "custom", customType: "pi-runai-state", data: null }]);
  await h.start();
  try { assert.equal((await h.wait({ seconds: 0.001, runai_job_ids: [id] })).details.interruptedBy, undefined); }
  finally { await h.stop(); }
});

test("latest snapshot on the active branch wins and tree navigation clears old completion cache", async () => {
  const h = harness();
  h.loadSleep();
  h.setBranch([stateEntry("COMPLETED"), stateEntry("RUNNING")]);
  await h.start();
  try {
    assert.equal((await h.wait({ seconds: 0.001, runai_job_ids: [id] })).details.interruptedBy, undefined);
    h.events.emit("runai:finished", { id });
    assert.equal((await h.wait({ runai_job_ids: [id] })).details.interruptedBy.jobId, id);
    h.setBranch([stateEntry("RUNNING")]);
    await h.fire("session_tree");
    assert.equal((await h.wait({ seconds: 0.001, runai_job_ids: [id] })).details.interruptedBy, undefined);
  } finally { await h.stop(); }
});

test("abort and session shutdown reject active waits and clear completion memory", async () => {
  const h = harness();
  h.loadSleep();
  await h.start();
  const controller = new AbortController();
  const aborted = assert.rejects(h.wait({ runai_job_ids: [id] }, controller.signal), /Sleep aborted/);
  controller.abort();
  await aborted;
  const shutdown = assert.rejects(h.wait({ runai_job_ids: [id] }), /Sleep aborted/);
  h.events.emit("runai:finished", { id: "old" });
  await h.stop();
  await shutdown;
  await h.start();
  try {
    assert.equal((await h.wait({ seconds: 0.001, runai_job_ids: ["old"] })).details.interruptedBy, undefined);
  } finally { await h.stop(); }
});
