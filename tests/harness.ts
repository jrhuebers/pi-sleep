import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import sleep from "../index.js";

export function harness(companions: string[] = ["runai_submit"]) {
  const handlers = new Map<string, Function[]>();
  const tools = new Map<string, any>(companions.map(name => [name, { name }]));
  const events = new EventEmitter();
  const root = mkdtempSync(join(tmpdir(), "sleep-harness-"));
  let entries: any[] = [];
  const rows = new Map<string, string>();
  const commands: string[][] = [];
  const api = {
    events,
    on(name: string, fn: Function) { handlers.set(name, [...(handlers.get(name) ?? []), fn]); },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    getAllTools() { return [...tools.values()]; },
    appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data: structuredClone(data) }); },
    sendMessage() {},
    async exec(_cli: string, args: string[]) {
      commands.push(args);
      let stdout = "";
      if (args[0] === "config") stdout = "Project: project\nCluster: cluster";
      else if (args[0] === "list") stdout = "NAME STATUS AGE\n" + [...rows].map(([name, state]) => `${name} ${state} 1m`).join("\n");
      else if (args[0] === "submit") { rows.set(args[args.indexOf("--name") + 1], "Pending"); stdout = "Submitted"; }
      else if (args[0] === "delete") rows.delete(args[2]);
      return { stdout, stderr: "", code: 0, killed: false };
    },
  } as unknown as ExtensionAPI;
  const ctx = { cwd: root, hasUI: false, sessionManager: { getBranch: () => entries } };
  async function fire(name: string) { for (const handler of handlers.get(name) ?? []) await handler({}, ctx); }
  return {
    api, tools, events, rows, commands, ctx,
    capture: {
      create(_cwd: string, name: string) {
        const file = join(root, `${name}-${randomBytes(8).toString("hex")}.out`);
        writeFileSync(file, "", { mode: 0o600 });
        return file;
      },
      async follow() {},
      async finish(job: { logPath?: string }) { if (job.logPath) appendFileSync(job.logPath, "mock log\n"); },
      stopAll() {}, stopJob() {},
    },
    loadSleep: () => sleep(api),
    setBranch: (value: any[]) => { entries = value; },
    getBranch: () => entries,
    fire,
    start: () => fire("session_start"),
    async stop() { await fire("session_shutdown"); rmSync(root, { recursive: true, force: true }); },
    call(name: string, params: unknown, signal?: AbortSignal) {
      return tools.get(name).execute("test", params, signal, undefined, ctx);
    },
    wait(params: Record<string, unknown> = {}, signal: AbortSignal = AbortSignal.timeout(2000)) {
      return tools.get("sleep").execute("sleep-test", { seconds: 60, message: "Inspect artifacts.", ...params }, signal, undefined, ctx);
    },
  };
}

export function stateEntry(lastState: string, id = "cluster/project/job") {
  return { type: "custom", customType: "pi-runai-state", data: { version: 1, jobs: [{
    id, name: "job", project: "project", cluster: "cluster", interactive: false,
    submittedAt: "2026-01-01T00:00:00Z", lastState,
  }] } };
}

export async function flush() {
  for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
}
