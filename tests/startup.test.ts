import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const binary = process.env.PI_SMOKE_BIN;
const runai = process.env.PI_RUNAI_EXTENSION;

test("actual Pi startup exposes Run:ai-aware sleep without model credentials", {
  skip: !(binary && runai) && "Set PI_SMOKE_BIN and PI_RUNAI_EXTENSION for actual Pi startup",
}, () => {
  const root = mkdtempSync(join(tmpdir(), "pi-sleep-startup-"));
  try {
    const probe = join(root, "probe.ts");
    writeFileSync(probe, `export default function(pi) {
      pi.registerCommand("sleep-runai-smoke", { handler: async () => {
        const tools = pi.getAllTools();
        for (const name of ["runai_submit", "runai_track", "runai_jobs", "runai_logs", "runai_cancel", "sleep"]) {
          if (!tools.some(tool => tool.name === name)) throw new Error("Missing tool " + name);
        }
        const sleep = tools.find(tool => tool.name === "sleep");
        if (!sleep.parameters.properties.runai_job_ids) throw new Error("Missing runai_job_ids");
        if (sleep.parameters.properties.slurm_job_ids) throw new Error("Unexpected Slurm schema");
        console.error("SLEEP_RUNAI_STARTUP_OK");
      }});
    }`);
    const sleep = resolve(dirname(fileURLToPath(import.meta.url)), "../index.ts");
    for (const extensions of [[sleep, resolve(runai!)], [resolve(runai!), sleep]]) {
      const result = spawnSync(resolve(binary!), [
        "--mode", "rpc", "--no-session", "--offline", "--no-approve", "--no-extensions",
        "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
        ...extensions.flatMap(path => ["-e", path]), "-e", probe,
      ], {
        cwd: root,
        env: {
          PATH: process.env.PATH, HOME: root,
          PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1",
        },
        input: JSON.stringify({ id: "smoke", type: "prompt", message: "/sleep-runai-smoke" }) + "\n",
        encoding: "utf8", timeout: 30000,
      });
      assert.equal(result.status, 0, result.stderr || String(result.error));
      assert.match(result.stderr, /SLEEP_RUNAI_STARTUP_OK/);
      const records = result.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
      const response = records.find(record => record.type === "response" && record.id === "smoke");
      assert.equal(response?.success, true, JSON.stringify(records));
      assert(!records.some(record => record.type === "message_start"), "No model call should run");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
