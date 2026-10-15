import { EventEmitter } from "node:events";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import sleep from "../index.js";

export function harness(companions: string[] = ["runai_submit"]) {
  const handlers = new Map<string, Function[]>();
  const tools = new Map<string, any>(companions.map(name => [name, { name }]));
  const events = new EventEmitter();
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
  const ctx = { hasUI: false, sessionManager: { getBranch: () => entries } };
  async function fire(name: string) { for (const handler of handlers.get(name) ?? []) await handler({}, ctx); }
  return {
    api, tools, events, rows, commands, ctx,
    loadSleep: () => sleep(api),
    setBranch: (value: any[]) => { entries = value; },
    getBranch: () => entries,
    fire,
    start: () => fire("session_start"),
    stop: () => fire("session_shutdown"),
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
