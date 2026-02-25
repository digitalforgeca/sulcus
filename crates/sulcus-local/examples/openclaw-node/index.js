// Minimal OpenClaw-style MCP example (Node.js)
// Usage: node index.js <path-to-sulcus-local-binary>
// This script spawns `sulcus-local serve` as a sidecar and exercises the full MCP surface.

const { spawn } = require('child_process');

async function run(binPath) {
  const childEnv = { ...process.env };
  if (process.env.SULCUS_DATABASE_URL) {
    childEnv.SULCUS_DATABASE_URL = process.env.SULCUS_DATABASE_URL;
  }

  const child = spawn(binPath, ['serve'], {
    env: childEnv,
    stdio: ['ignore', 'inherit', 'inherit']
  });

  const http = require('http');

  let sessionId = null;
  const pendingMessages = [];
  let messageResolve = null;

  // Retry SSE connection until the server is ready (handles slow startup)
  function connectSSE(cb) {
    let activeReq = null;
    function attempt() {
      activeReq = http.get('http://127.0.0.1:4203/sse', (res) => {
        res.setEncoding('utf8');
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk;
          let parts = buf.split('\n\n');
          while (parts.length > 1) {
            const ev = parts.shift();
            buf = parts.join('\n\n');
            const lines = ev.split('\n');
            let event = null;
            let data = '';
            for (const line of lines) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trim();
            }
            if (event) cb(event, data);
          }
        });
      });
      activeReq.on('error', () => {
        // Server not ready yet — retry after 100ms
        setTimeout(attempt, 100);
      });
    }
    attempt();
    return { destroy: () => { if (activeReq) activeReq.destroy(); } };
  }

  const sseReq = connectSSE((event, data) => {
    if (event === 'endpoint') {
      const m = data.match(/sessionId=([a-f0-9\-]+)/);
      if (m) sessionId = m[1];
    }
    if (event === 'message') {
      if (messageResolve) {
        messageResolve(JSON.parse(data));
        messageResolve = null;
      } else {
        pendingMessages.push(JSON.parse(data));
      }
    }
  });

  async function send(req) {
    // wait for sessionId (up to 20s)
    for (let i = 0; i < 400 && !sessionId; i++) {
      await new Promise(r => setTimeout(r, 50));
    }
    if (!sessionId) throw new Error('SSE handshake failed');

    const post = JSON.stringify(req);
    await new Promise((resolve, reject) => {
      const r = http.request({ method: 'POST', host: '127.0.0.1', port: 4203, path: `/message?sessionId=${sessionId}`, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(post) } }, (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      });
      r.on('error', reject);
      r.write(post);
      r.end();
    });

    if (pendingMessages.length > 0) return pendingMessages.shift();
    return await new Promise((resolve) => { messageResolve = resolve; });
  }

  // 1) tools/list
  const describe = await send({ jsonrpc: '2.0', id: 't0', method: 'tools/list' });
  console.log('tools/list OK');

  // 2) active index resource smoke check
  const activeResp = await send({ jsonrpc: '2.0', id: 'r1', method: 'resources/read', params: { uri: 'memory://active_index', limit: 10 } });
  const activeText = activeResp.result.contents[0].text;
  const active = JSON.parse(activeText);
  console.log('active_index length=', active.length);

  // 3) metrics
  const metrics = await send({ jsonrpc: '2.0', id: 'mx1', method: 'tools/call', params: { name: 'metrics', arguments: {} } });
  const metricsInner = JSON.parse(metrics.result.content[0].text);
  console.log('metrics keys=', Object.keys(metricsInner || {}).length);

  // 4) record_memory_op + list_memory_ops
  await send({ jsonrpc: '2.0', id: 'op1', method: 'tools/call', params: { name: 'record_memory_op', arguments: { op_type: 'OC_TEST', payload: { foo: 'bar' } } } });
  const ops = await send({ jsonrpc: '2.0', id: 'op2', method: 'tools/call', params: { name: 'list_memory_ops', arguments: {} } });
  const opsInner = JSON.parse(ops.result.content[0].text);
  console.log('ops count=', opsInner.length);

  // 5) server_cursor / last_seq (set/get)
  await send({ jsonrpc: '2.0', id: 'sc1', method: 'tools/call', params: { name: 'set_server_cursor', arguments: { cursor: 'cursor-123' } } });
  const sc = await send({ jsonrpc: '2.0', id: 'sc2', method: 'tools/call', params: { name: 'get_server_cursor', arguments: {} } });
  const scInner = JSON.parse(sc.result.content[0].text);
  console.log('server_cursor=', scInner.cursor);

  await send({ jsonrpc: '2.0', id: 'ls1', method: 'tools/call', params: { name: 'set_last_seq', arguments: { seq: 777 } } });
  const ls = await send({ jsonrpc: '2.0', id: 'ls2', method: 'tools/call', params: { name: 'get_last_seq', arguments: {} } });
  const lsInner = JSON.parse(ls.result.content[0].text);
  console.log('last_seq=', lsInner.seq);

  // 6) tick
  await send({ jsonrpc: '2.0', id: 'tick1', method: 'tools/call', params: { name: 'tick', arguments: {} } });

  // done
  console.log('OPENCLAW-OK');
  sseReq.destroy();
  child.kill();
  process.exit(0);
}

if (require.main === module) {
  const bin = process.argv[2];
  if (!bin) {
    console.error('Usage: node index.js <path-to-sulcus-local-binary>');
    process.exit(2);
  }
  run(bin).catch(err => { console.error(err); process.exit(1); });
}
