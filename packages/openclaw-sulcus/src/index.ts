import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { Type } from "@sinclair/typebox";

// Simple MCP Client for sulcus-local
class SulcusClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<string | number, (res: any) => void>();

  constructor(private binaryPath: string) {}

  async start() {
    this.child = spawn(this.binaryPath, ["stdio"], {
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
    const binaryPath = api.config?.binaryPath || "/Users/dv00003-00/dev/sulcus/target/release/sulcus-local";
    const client = new SulcusClient(binaryPath);

    api.logger.info(`memory-sulcus: registered (binary: ${binaryPath})`);

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
      start: () => client.start(),
      stop: () => client.stop()
    });
  }
};

export default sulcusPlugin;
