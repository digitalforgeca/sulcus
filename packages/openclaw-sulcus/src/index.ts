import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { resolve as resolvePath, dirname } from "node:path";
import { Type } from "@sinclair/typebox";

// --- Minimal INI helpers (no extra deps) ---
type IniData = Record<string, Record<string, string>>;

async function readIni(filePath: string): Promise<IniData> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return {};
  }
  const result: IniData = {};
  let section = "__root__";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) { section = secMatch[1]; result[section] ??= {}; continue; }
    const kvMatch = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (kvMatch) { result[section] ??= {}; result[section][kvMatch[1].trim()] = kvMatch[2].trim(); }
  }
  return result;
}

async function writeIni(filePath: string, data: IniData): Promise<void> {
  const lines: string[] = [];
  for (const [section, kvs] of Object.entries(data)) {
    if (section === "__root__") {
      for (const [k, v] of Object.entries(kvs)) lines.push(`${k} = ${v}`);
      if (Object.keys(kvs).length) lines.push("");
      continue;
    }
    lines.push(`[${section}]`);
    for (const [k, v] of Object.entries(kvs)) lines.push(`${k} = ${v}`);
    lines.push("");
  }
  await writeFile(filePath, lines.join("\n"), "utf8");
}

// Simple MCP Client for sulcus-local
class SulcusClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<string | number, (res: any) => void>();

  constructor(private binaryPath: string) {}

  async start(configPath?: string) {
    const args = configPath ? ["--config", configPath, "stdio"] : ["stdio"];
    this.child = spawn(this.binaryPath, args, {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, RUST_LOG: "info" }
    });

    const rl = createInterface({ input: this.child.stdout! });
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id && this.pending.has(msg.id)) {
          const resolve = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          resolve(msg);
        }
      } catch (e) {}
    });
  }

  async call(method: string, params: any = {}): Promise<any> {
    if (!this.child) await this.start();
    const id = this.nextId++;
    const request = { jsonrpc: "2.0", id, method: "tools/call", params: { name: method, arguments: params } };
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Sulcus timeout: ${method}`)), 10000);
      this.pending.set(id, (res) => {
        clearTimeout(timeout);
        if (res.error) reject(new Error(res.error.message));
        else {
            // MCP result format
            try {
                const content = JSON.parse(res.result.content[0].text);
                resolve(content);
            } catch(e) {
                resolve(res.result);
            }
        }
      });
      this.child!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  stop() {
    if (this.child) this.child.kill();
  }
}

const sulcusPlugin = {
  id: "memory-sulcus",
  name: "Sulcus vMMU",
  description: "Sulcus-backed vMMU memory for OpenClaw",
  kind: "memory" as const,

  register(api: any) {
    const binaryPath = api.config?.binaryPath || "sulcus-local";
    const client = new SulcusClient(binaryPath);

    api.logger.info(`memory-sulcus: registered (binary: ${binaryPath})`);

    // Resolve ini path: check explicit config, then standard locations
    const iniPath: string = api.config?.iniPath
      || resolvePath(process.env.HOME || "~", ".config/sulcus/sulcus.ini");

    // Determine server URL from config or from the ini file at startup
    async function getServerUrl(): Promise<string> {
      if (api.config?.serverUrl) return api.config.serverUrl as string;
      const ini = await readIni(iniPath);
      let url = ini["sulcus"]?.["server_url"] ?? "https://sulcus.dforge.ca";
      if (url === "http://localhost:3000") {
        api.logger.warn(`memory-sulcus: falling back to localhost:3000 for serverUrl`);
      }
      return url;
    }

    api.registerCommand({
      name: "join",
      description: "Join a Sulcus collective using an invitation token and persist the returned API key",
      args: [
        { name: "token", description: "Invitation token issued by the collective admin", required: true }
      ],
      async handler(args: string[]) {
        const token = args[0];
        if (!token) throw new Error("Usage: openclaw sulcus join <token>");

        const serverUrl = await getServerUrl();
        api.logger.info(`memory-sulcus: joining collective at ${serverUrl}`);

        const res = await fetch(`${serverUrl}/api/v1/admin/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invitation_token: token }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Join failed (${res.status}): ${body}`);
        }

        const data = await res.json() as { api_key: string; tenant_id: string };
        if (!data.api_key) throw new Error("Server response missing api_key");

        // Persist to sulcus.ini
        const ini = await readIni(iniPath);
        ini["sulcus"] ??= {};
        ini["sulcus"]["server_url"] = serverUrl;
        ini["sulcus"]["server_api_key"] = data.api_key;
        await writeIni(iniPath, ini);

        // Propagate into live config so the running process uses the new key immediately
        if (api.config) api.config.serverApiKey = data.api_key;

        api.logger.info(`memory-sulcus: join successful, tenant=${data.tenant_id}`);
        return {
          content: [{
            type: "text",
            text: `Joined collective (tenant: ${data.tenant_id}).\nAPI key saved to ${iniPath}.\nRestart sulcus-local to apply sync credentials.`
          }]
        };
      }
    });

    api.registerTool({
      name: "memory_recall",
      label: "Memory Recall",
      description: "Search Sulcus memory for relevant context",
      parameters: Type.Object({
        query: Type.String(),
        limit: Type.Optional(Type.Number({ default: 5 }))
      }),
      async execute(_id: string, params: any) {
        const res = await client.call("search_memory", { query: params.query, limit: params.limit });
        return {
          content: [{ type: "text", text: JSON.stringify(res.results, null, 2) }],
          details: res
        };
      }
    }, { name: "memory_recall" });

    api.registerTool({
      name: "memory_store",
      label: "Memory Store",
      description: "Record information in Sulcus memory",
      parameters: Type.Object({
        content: Type.String(),
        fold_name: Type.Optional(Type.String({ default: "default" }))
      }),
      async execute(_id: string, params: any) {
        const res = await client.call("record_memory", params);
        return {
          content: [{ type: "text", text: `Stored memory ${res.node_id}` }],
          details: res
        };
      }
    }, { name: "memory_store" });

    api.on("before_agent_start", async (event: any) => {
      api.logger.info(`memory-sulcus: before_agent_start hook triggered for agent ${event.agentId}`);
      if (!event.prompt) return;
      try {
        api.logger.debug(`memory-sulcus: building context for prompt: ${event.prompt.substring(0, 50)}...`);
        const res = await client.call("build_context", { prompt: event.prompt, token_budget: 2000 });
        if (res.context) {
          api.logger.info(`memory-sulcus: context build successful, injecting ${res.token_estimate} tokens`);
          return { prependContext: res.context };
        }
      } catch (e) {
        api.logger.warn(`memory-sulcus: context build failed: ${e}`);
      }
    });

    api.on("agent_end", async (event: any) => {
      api.logger.info(`memory-sulcus: agent_end hook triggered for agent ${event.agentId}`);
      if (!event.success || !event.messages) return;
      const lastUserMsg = [...event.messages].reverse().find((m: any) => m.role === "user");
      if (lastUserMsg) {
        const text = typeof lastUserMsg.content === "string" ? lastUserMsg.content : JSON.stringify(lastUserMsg.content);
        if (text.length > 20) {
            api.logger.debug(`memory-sulcus: recording user message: ${text.substring(0, 50)}...`);
            await client.call("record_memory", { content: `user: ${text}` });
        }
      }
      const lastAssistantMsg = [...event.messages].reverse().find((m: any) => m.role === "assistant");
      if (lastAssistantMsg) {
        const text = typeof lastAssistantMsg.content === "string" ? lastAssistantMsg.content : JSON.stringify(lastAssistantMsg.content);
        if (text.length > 20) {
            api.logger.debug(`memory-sulcus: recording assistant message: ${text.substring(0, 50)}...`);
            await client.call("record_memory", { content: `assistant: ${text}` });
        }
      }
    });

    api.registerService({
      id: "memory-sulcus",
      start: () => client.start(iniPath),
      stop: () => client.stop()
    });
  }
};

export default sulcusPlugin;
