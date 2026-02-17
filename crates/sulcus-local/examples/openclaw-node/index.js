// Minimal OpenClaw-style MCP example (Node.js)
// Usage: node index.js <path-to-sulcus-local-binary>
// This script spawns `sulcus-local serve` as a sidecar and exercises the full MCP surface.

const { spawn } = require('child_process');
const readline = require('readline');
const os = require('os');
const fs = require('fs');

async function run(binPath) {
  const tmp = fs.mkdtempSync(`${os.tmpdir()}/sulcus-`);
  const dbPath = `${tmp}/memory.db`;
  // create an empty DB file so the binary can open it via sqlx/SQLite
  fs.writeFileSync(dbPath, '');
  try { fs.chmodSync(dbPath, 0o666); } catch (e) { /* best-effort */ }

  const child = spawn(binPath, ['serve'], {
    env: { ...process.env, SULCUS_DB_PATH: dbPath },
    stdio: ['pipe', 'pipe', 'inherit']
  });

  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const lines = rl[Symbol.asyncIterator]();

  async function send(req) {
    child.stdin.write(JSON.stringify(req) + '\n');
    const { value, done } = await lines.next();
    if (done) throw new Error('sulcus-local closed stdout');
    try {
      return JSON.parse(value);
    } catch (e) {
      throw new Error(`invalid json from sulcus-local: ${value}`);
    }
  }

  // 1) describe_tools
  const describe = await send({ id: 't0', method: 'describe_tools' });
  console.log('describe_tools OK');

  // 2) upsert_node + get_node
  const nid = '00000000-0000-0000-0000-000000000123';
  await send({ id: 'u1', method: 'upsert_node', params: { id: nid, label: 'node-x', pointer_summary: 'node-x', current_heat: 0.42, base_utility: 0.0, is_pinned: false } });
  const got = await send({ id: 'g1', method: 'get_node', params: { node_id: nid } });
  console.log('get_node pointer_summary=', got.result.node.pointer_summary);

  // 3) add_memory -> active_index
  const add = await send({ id: 'm1', method: 'add_memory', params: { content: 'openclaw test memory' } });
  const active = await send({ id: 'r1', method: 'resource', params: { resource: 'memory://active_index', limit: 10 } });
  console.log('active_index length=', active.result.length);

  // 4) summarize
  const summ = await send({ id: 's1', method: 'summarize', params: { text: 'This is a test. Second sentence.', max_chars: 80 } });
  console.log('summary=', summ.result.summary);

  // 5) list_hot_nodes
  const hot = await send({ id: 'h1', method: 'list_hot_nodes', params: { limit: 5 } });
  console.log('hot[0]=', hot.result[0] && hot.result[0].pointer_summary);

  // 6) record_memory_op + list_memory_ops
  await send({ id: 'op1', method: 'record_memory_op', params: { op_type: 'OC_TEST', payload: { foo: 'bar' } } });
  const ops = await send({ id: 'op2', method: 'list_memory_ops' });
  console.log('ops count=', ops.result.length);

  // 7) set_active_index
  await send({ id: 'ai1', method: 'set_active_index', params: { node_id: nid, heat: 99.0 } });

  // 8) server_cursor / last_seq (set/get)
  await send({ id: 'sc1', method: 'set_server_cursor', params: { cursor: 'cursor-123' } });
  const sc = await send({ id: 'sc2', method: 'get_server_cursor' });
  console.log('server_cursor=', sc.result.cursor);

  await send({ id: 'ls1', method: 'set_last_seq', params: { seq: 777 } });
  const ls = await send({ id: 'ls2', method: 'get_last_seq' });
  console.log('last_seq=', ls.result.seq);

  // 9) tick
  await send({ id: 'tick1', method: 'tick' });

  // done
  console.log('OPENCLAW-OK');
  child.kill();
  rl.close();
}

if (require.main === module) {
  const bin = process.argv[2];
  if (!bin) {
    console.error('Usage: node index.js <path-to-sulcus-local-binary>');
    process.exit(2);
  }
  run(bin).catch(err => { console.error(err); process.exit(1); });
}
