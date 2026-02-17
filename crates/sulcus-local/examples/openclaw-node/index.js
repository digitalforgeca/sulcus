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

  // 1) tools/list
  const describe = await send({ jsonrpc: '2.0', id: 't0', method: 'tools/list' });
  console.log('tools/list OK');

  // 2) upsert_node + get_node via tools/call
  const nid = '00000000-0000-0000-0000-000000000123';
  await send({ jsonrpc: '2.0', id: 'u1', method: 'tools/call', params: { name: 'upsert_node', arguments: { id: nid, label: 'node-x', pointer_summary: 'node-x', current_heat: 0.42, base_utility: 0.0, is_pinned: false } } });
  const got = await send({ jsonrpc: '2.0', id: 'g1', method: 'tools/call', params: { name: 'get_node', arguments: { node_id: nid } } });
  const gotInner = JSON.parse(got.result.content[0].text);
  console.log('get_node pointer_summary=', gotInner.node.pointer_summary);

  // 3) add_memory -> resources/read
  const add = await send({ jsonrpc: '2.0', id: 'm1', method: 'tools/call', params: { name: 'add_memory', arguments: { content: 'openclaw test memory' } } });
  const activeResp = await send({ jsonrpc: '2.0', id: 'r1', method: 'resources/read', params: { uri: 'memory://active_index', limit: 10 } });
  const activeText = activeResp.result.contents[0].text;
  const active = JSON.parse(activeText);
  console.log('active_index length=', active.length);

  // 4) summarize
  const summ = await send({ jsonrpc: '2.0', id: 's1', method: 'tools/call', params: { name: 'summarize', arguments: { text: 'This is a test. Second sentence.', max_chars: 80 } } });
  const summInner = JSON.parse(summ.result.content[0].text);
  console.log('summary=', summInner.summary);

  // 5) list_hot_nodes
  const hot = await send({ jsonrpc: '2.0', id: 'h1', method: 'tools/call', params: { name: 'list_hot_nodes', arguments: { limit: 5 } } });
  const hotInner = JSON.parse(hot.result.content[0].text);
  console.log('hot[0]=', hotInner[0] && hotInner[0].pointer_summary);

  // 6) record_memory_op + list_memory_ops
  await send({ jsonrpc: '2.0', id: 'op1', method: 'tools/call', params: { name: 'record_memory_op', arguments: { op_type: 'OC_TEST', payload: { foo: 'bar' } } } });
  const ops = await send({ jsonrpc: '2.0', id: 'op2', method: 'tools/call', params: { name: 'list_memory_ops', arguments: {} } });
  const opsInner = JSON.parse(ops.result.content[0].text);
  console.log('ops count=', opsInner.length);

  // 7) set_active_index
  await send({ jsonrpc: '2.0', id: 'ai1', method: 'tools/call', params: { name: 'set_active_index', arguments: { node_id: nid, heat: 99.0 } } });

  // 8) server_cursor / last_seq (set/get)
  await send({ jsonrpc: '2.0', id: 'sc1', method: 'tools/call', params: { name: 'set_server_cursor', arguments: { cursor: 'cursor-123' } } });
  const sc = await send({ jsonrpc: '2.0', id: 'sc2', method: 'tools/call', params: { name: 'get_server_cursor', arguments: {} } });
  const scInner = JSON.parse(sc.result.content[0].text);
  console.log('server_cursor=', scInner.cursor);

  await send({ jsonrpc: '2.0', id: 'ls1', method: 'tools/call', params: { name: 'set_last_seq', arguments: { seq: 777 } } });
  const ls = await send({ jsonrpc: '2.0', id: 'ls2', method: 'tools/call', params: { name: 'get_last_seq', arguments: {} } });
  const lsInner = JSON.parse(ls.result.content[0].text);
  console.log('last_seq=', lsInner.seq);

  // 9) tick
  await send({ jsonrpc: '2.0', id: 'tick1', method: 'tools/call', params: { name: 'tick', arguments: {} } });

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
