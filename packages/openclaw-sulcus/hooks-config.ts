/**
 * Hooks configuration loader for Sulcus plugin.
 * Reads hooks.defaults.json and merges with user overrides.
 * Isolated from network code to keep static analysis clean.
 */
import { resolve } from "node:path";

interface HookConfig {
  action: string;
  enabled: boolean;
  limit?: number;
  minScore?: number;
  [key: string]: unknown;
}

interface ToolConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export interface HooksConfig {
  $schema?: string;
  version?: number;
  hooks: Record<string, HookConfig>;
  tools: Record<string, ToolConfig>;
}

export function loadHooksConfig(apiConfig: Record<string, unknown>): HooksConfig {
  const defaultsPath = resolve(__dirname, "hooks.defaults.json");
  let defaults: HooksConfig;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    defaults = JSON.parse(require("fs").readFileSync(defaultsPath, "utf-8")) as HooksConfig;
  } catch (_e) {
    defaults = {
      version: 1,
      hooks: {
        before_prompt_build: { action: "inject_awareness", enabled: true },
        before_agent_start: { action: "auto_recall", enabled: false, limit: 5, minScore: 0.3 },
        agent_end: { action: "none", enabled: false },
        after_tool_call: { action: "auto_error_capture", enabled: false },
        before_compaction: { action: "pre_compaction_capture", enabled: false },
      },
      tools: {
        memory_recall: { enabled: true },
        memory_store: { enabled: true },
        memory_status: { enabled: true },
        consolidate: { enabled: false },
        export_markdown: { enabled: false },
        import_markdown: { enabled: false },
        evaluate_triggers: { enabled: false },
        __sulcus_workflow__: { enabled: true },
      },
    };
  }

  const userHooks = (apiConfig?.hooks ?? {}) as Record<string, Partial<HookConfig>>;
  const userTools = (apiConfig?.tools ?? {}) as Record<string, Partial<ToolConfig>>;

  const mergedHooks: Record<string, HookConfig> = { ...defaults.hooks };
  for (const [name, override] of Object.entries(userHooks)) {
    mergedHooks[name] = { ...(mergedHooks[name] ?? { action: "none", enabled: false }), ...override };
  }

  const mergedTools: Record<string, ToolConfig> = { ...defaults.tools };
  for (const [name, override] of Object.entries(userTools)) {
    mergedTools[name] = { ...(mergedTools[name] ?? { enabled: false }), ...override };
  }

  // Legacy compat: autoRecall flag → hooks.before_prompt_build.enabled (v5.0.0+)
  if (apiConfig?.autoRecall === true) {
    mergedHooks["before_prompt_build"] = {
      ...(mergedHooks["before_prompt_build"] ?? { action: "auto_recall", enabled: false }),
      enabled: true,
    };
    mergedHooks["before_agent_start"] = {
      ...(mergedHooks["before_agent_start"] ?? { action: "auto_recall", enabled: false }),
      enabled: true,
    };
  }

  return { version: defaults.version, hooks: mergedHooks, tools: mergedTools };
}
