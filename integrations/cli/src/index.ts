#!/usr/bin/env node
/**
 * sulcus-cli — Terminal interface for Sulcus Thermodynamic Memory.
 *
 * Auth: SULCUS_API_KEY env var or ~/.sulcusrc config file.
 * Requires Node 18.3+ (parseArgs).
 */

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Sulcus, type Memory, type SulcusError as SulcusErrorType } from "sulcus";

// ---------------------------------------------------------------------------
// Config / Auth
// ---------------------------------------------------------------------------

function loadApiKey(): string {
  const fromEnv = process.env.SULCUS_API_KEY;
  if (fromEnv) return fromEnv;

  const rcPath = join(homedir(), ".sulcusrc");
  try {
    const raw = readFileSync(rcPath, "utf8");
    // Support JSON { "apiKey": "sk-..." } or plain key on first line
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.apiKey === "string" && parsed.apiKey) return parsed.apiKey;
    } catch {
      // plain text
    }
    const line = raw.trim().split("\n")[0].trim();
    if (line) return line;
  } catch {
    // file doesn't exist
  }

  fatal(
    "No API key found.\n" +
      "  Set SULCUS_API_KEY env var, or create ~/.sulcusrc with your key.\n" +
      "  Get a key at https://sulcus.ca"
  );
}

function getBaseUrl(): string | undefined {
  return process.env.SULCUS_BASE_URL ?? undefined;
}

function makeClient(): Sulcus {
  return new Sulcus({
    apiKey: loadApiKey(),
    baseUrl: getBaseUrl(),
  });
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function fatal(msg: string): never {
  console.error(`\x1b[31merror:\x1b[0m ${msg}`);
  process.exit(1);
  // TypeScript needs this unreachable throw to infer `never`
  throw new Error("unreachable");
}

function ok(msg: string): void {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

function formatMemory(m: Memory, verbose = false): string {
  const content = m.pointer_summary ?? m.label ?? "(no content)";
  const heat = (m.current_heat ?? m.heat ?? 0).toFixed(3);
  const pin = m.is_pinned ? " 📌" : "";
  const type = m.memory_type ?? "episodic";
  const ns = m.namespace ?? "default";
  if (verbose) {
    return (
      `  \x1b[36m${m.id}\x1b[0m${pin}\n` +
      `  Content : ${content}\n` +
      `  Type    : ${type}\n` +
      `  Heat    : ${heat}\n` +
      `  Namespace: ${ns}\n`
    );
  }
  return `\x1b[36m${m.id.slice(0, 8)}\x1b[0m${pin} [${type}] [heat:${heat}] ${content}`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdRemember(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      type: { type: "string", short: "t" },
      namespace: { type: "string", short: "n" },
      heat: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });

  const content = positionals[0];
  if (!content) fatal('Usage: sulcus remember "text" [--type episodic|semantic|preference|procedural] [--namespace ns]');

  const memoryType = (values.type as string | undefined) as
    | "episodic"
    | "semantic"
    | "preference"
    | "procedural"
    | undefined;

  const heatNum = values.heat ? parseFloat(values.heat as string) : undefined;

  const client = makeClient();
  const mem = await client.remember(content, {
    memoryType,
    namespace: values.namespace as string | undefined,
    heat: heatNum,
  });

  ok(`Stored memory \x1b[36m${mem.id}\x1b[0m`);
  console.log(formatMemory(mem, true));
}

async function cmdSearch(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      limit: { type: "string", short: "l" },
      type: { type: "string", short: "t" },
      namespace: { type: "string", short: "n" },
    },
    allowPositionals: true,
    strict: false,
  });

  const query = positionals[0];
  if (!query) fatal('Usage: sulcus search "query" [--limit 10] [--type episodic] [--namespace ns]');

  const client = makeClient();
  const results = await client.search(query, {
    limit: values.limit ? parseInt(values.limit as string, 10) : 10,
    memoryType: values.type as string | undefined,
    namespace: values.namespace as string | undefined,
  });

  if (results.length === 0) {
    console.log("No memories found.");
    return;
  }

  console.log(`\x1b[1mFound ${results.length} memor${results.length === 1 ? "y" : "ies"}:\x1b[0m\n`);
  results.forEach((m) => console.log(formatMemory(m)));
}

async function cmdList(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      page: { type: "string", short: "p" },
      "page-size": { type: "string" },
      type: { type: "string", short: "t" },
      namespace: { type: "string", short: "n" },
      pinned: { type: "boolean" },
      sort: { type: "string" },
      order: { type: "string" },
      verbose: { type: "boolean", short: "v" },
    },
    allowPositionals: false,
    strict: false,
  });

  const client = makeClient();
  const memories = await client.list({
    page: values.page ? parseInt(values.page as string, 10) : 1,
    pageSize: values["page-size"] ? parseInt(values["page-size"] as string, 10) : 25,
    memoryType: values.type as string | undefined,
    namespace: values.namespace as string | undefined,
    pinned: values.pinned as boolean | undefined,
    sort: values.sort as string | undefined,
    order: values.order as "asc" | "desc" | undefined,
  });

  if (memories.length === 0) {
    console.log("No memories found.");
    return;
  }

  const verbose = values.verbose as boolean | undefined;
  console.log(`\x1b[1m${memories.length} memor${memories.length === 1 ? "y" : "ies"}:\x1b[0m\n`);
  memories.forEach((m) => {
    console.log(formatMemory(m, verbose));
  });
}

async function cmdForget(argv: string[]): Promise<void> {
  const id = argv[0];
  if (!id) fatal("Usage: sulcus forget <id>");

  const client = makeClient();
  await client.forget(id);
  ok(`Deleted memory ${id}`);
}

async function cmdPin(argv: string[], unpin = false): Promise<void> {
  const id = argv[0];
  if (!id) fatal(`Usage: sulcus ${unpin ? "unpin" : "pin"} <id>`);

  const client = makeClient();
  const mem = unpin ? await client.unpin(id) : await client.pin(id);
  ok(`${unpin ? "Unpinned" : "Pinned"} memory ${id}`);
  console.log(formatMemory(mem, true));
}

async function cmdWhoami(): Promise<void> {
  const client = makeClient();
  const info = await client.whoami();

  console.log("\x1b[1mOrganization\x1b[0m");
  console.log(`  Tenant ID : \x1b[36m${info.tenant_id}\x1b[0m`);
  console.log(`  Org Name  : ${info.org_name ?? "(none)"}`);
  console.log(`  Plan      : ${info.plan_tier}`);
  console.log(`  Ops Limit : ${info.ops_limit}`);
  console.log(`  Nodes Limit: ${info.nodes_limit}`);
  if (info.max_seats !== null) {
    console.log(`  Seats     : ${info.seats_used} / ${info.max_seats}`);
  }
  console.log(`  Features  : ${info.features}`);
}

async function cmdExport(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      format: { type: "string", short: "f" },
      namespace: { type: "string", short: "n" },
    },
    allowPositionals: false,
    strict: false,
  });

  const format = (values.format as string | undefined) ?? "json";
  if (format !== "json" && format !== "csv") {
    fatal(`Unknown format: ${format}. Use json or csv.`);
  }

  const client = makeClient();

  // Paginate all memories
  let page = 1;
  const all: Memory[] = [];
  while (true) {
    const batch = await client.list({
      page,
      pageSize: 100,
      namespace: values.namespace as string | undefined,
    });
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  if (format === "json") {
    console.log(JSON.stringify(all, null, 2));
  } else {
    // CSV
    const header = "id,memory_type,current_heat,is_pinned,namespace,pointer_summary";
    const rows = all.map((m) => {
      const content = (m.pointer_summary ?? m.label ?? "").replace(/"/g, '""');
      return `${m.id},${m.memory_type},${m.current_heat ?? m.heat ?? 0},${m.is_pinned},${m.namespace},"${content}"`;
    });
    console.log([header, ...rows].join("\n"));
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
\x1b[1msulcus\x1b[0m — Thermodynamic Memory CLI

\x1b[1mUsage:\x1b[0m
  sulcus <command> [options]

\x1b[1mCommands:\x1b[0m
  remember "text"   Store a new memory
    --type, -t      Memory type: episodic|semantic|preference|procedural
    --namespace, -n Namespace (default: "default")
    --heat          Initial heat 0–1 (default: 0.8)

  search "query"    Search memories by text
    --limit, -l     Max results (default: 10)
    --type, -t      Filter by type
    --namespace, -n Filter by namespace

  list              List memories with pagination
    --page, -p      Page number (default: 1)
    --page-size     Results per page (default: 25)
    --type, -t      Filter by type
    --namespace, -n Filter by namespace
    --pinned        Only pinned memories
    --sort          Sort field (default: current_heat)
    --order         asc|desc (default: desc)
    --verbose, -v   Expanded output

  forget <id>       Permanently delete a memory

  pin <id>          Pin a memory (prevents heat decay)
  unpin <id>        Unpin a memory (resumes heat decay)

  whoami            Show org/tenant info

  export            Dump all memories to stdout
    --format, -f    json|csv (default: json)
    --namespace, -n Filter by namespace

\x1b[1mAuth:\x1b[0m
  Set \x1b[36mSULCUS_API_KEY\x1b[0m env var, or create \x1b[36m~/.sulcusrc\x1b[0m with your API key.
  Optional: set \x1b[36mSULCUS_BASE_URL\x1b[0m to target a self-hosted server.

\x1b[1mExamples:\x1b[0m
  sulcus remember "User prefers dark mode" --type preference
  sulcus search "dark mode" --limit 5
  sulcus list --pinned
  sulcus export --format csv > memories.csv
`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case "remember":
        await cmdRemember(rest);
        break;
      case "search":
        await cmdSearch(rest);
        break;
      case "list":
        await cmdList(rest);
        break;
      case "forget":
        await cmdForget(rest);
        break;
      case "pin":
        await cmdPin(rest, false);
        break;
      case "unpin":
        await cmdPin(rest, true);
        break;
      case "whoami":
        await cmdWhoami();
        break;
      case "export":
        await cmdExport(rest);
        break;
      default:
        console.error(`\x1b[31merror:\x1b[0m Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status) {
      fatal(`API error ${e.status}: ${e.message ?? "(unknown)"}`);
    }
    fatal(e.message ?? String(err));
  }
}

main();
