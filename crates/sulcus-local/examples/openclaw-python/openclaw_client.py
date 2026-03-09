#!/usr/bin/env python3
"""Minimal OpenClaw-style MCP example (Python).
Usage: python3 openclaw_client.py <path-to-sulcus-local-binary>
"""
import json
import os
import subprocess
import sys


def send_and_recv(proc, req):
    line = json.dumps(req) + "\n"
    proc.stdin.write(line.encode())
    proc.stdin.flush()
    out = proc.stdout.readline()
    if not out:
        raise RuntimeError('sulcus-local closed stdout')
    return json.loads(out.decode())


def main(bin_path):
    env = os.environ.copy()
    if 'SULCUS_DATABASE_URL' in env and not env['SULCUS_DATABASE_URL'].strip():
        del env['SULCUS_DATABASE_URL']

    proc = subprocess.Popen([bin_path, 'serve'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)

    # connect to SSE
    import http.client
    import time
    res = None
    conn = None
    for _ in range(200):
        try:
            conn = http.client.HTTPConnection('127.0.0.1', 4203, timeout=2)
            conn.request('GET', '/sse')
            res = conn.getresponse()
            if res.status == 200:
                break
        except Exception:
            pass
        time.sleep(0.1)

    if res is None or res.status != 200:
        raise RuntimeError('failed to connect to SSE endpoint')
    buf = ''
    session_id = None

    def read_sse_event():
        nonlocal buf
        while True:
            line = res.readline().decode()
            if not line:
                return None, None
            if line.strip() == '':
                # end of event
                parts = buf.split('\n')
                ev = None
                data = ''
                for p in parts:
                    if p.startswith('event:'):
                        ev = p[6:].strip()
                    elif p.startswith('data:'):
                        if data:
                            data += '\n'
                        data += p[5:].strip()
                buf = ''
                return ev, data
            else:
                buf += line

    # wait for endpoint
    for _ in range(400):
        ev, data = read_sse_event()
        if ev == 'endpoint':
            if 'sessionId=' in data:
                session_id = data.split('sessionId=')[-1]
                break
    if not session_id:
        raise RuntimeError('failed to get session id from SSE')

    def post_and_wait(req_json):
        conn2 = http.client.HTTPConnection('127.0.0.1', 4203, timeout=5)
        body = json.dumps(req_json)
        conn2.request('POST', f'/message?sessionId={session_id}', body, headers={ 'Content-Type': 'application/json' })
        conn2.getresponse().read()
        # read next SSE message which contains the MCP response
        while True:
            ev, data = read_sse_event()
            if ev == 'message':
                return json.loads(data)

    # describe_tools
    print('tools/list ->', post_and_wait({ 'jsonrpc': '2.0', 'id': 't0', 'method': 'tools/list' })['result']['tools'])

    # active index resource smoke check
    res2 = post_and_wait({ 'jsonrpc': '2.0', 'id': 'r1', 'method': 'resources/read', 'params': { 'uri': 'memory://active_index', 'limit': 10 } })
    contents = res2['result']['contents']
    active_text = contents[0]['text']
    active = json.loads(active_text)
    print('active_index len=', len(active))

    # metrics
    m = post_and_wait({ 'jsonrpc': '2.0', 'id': 'mx1', 'method': 'tools/call', 'params': { 'name': 'metrics', 'arguments': {} } })
    m_inner = json.loads(m['result']['content'][0]['text'])
    print('metrics keys=', len(m_inner.keys()))

    # record/list ops
    post_and_wait({ 'jsonrpc': '2.0', 'id': 'op1', 'method': 'tools/call', 'params': { 'name': 'record_memory_op', 'arguments': { 'op_type': 'PY_TEST', 'payload': { 'a': 1 } } } })
    ops = post_and_wait({ 'jsonrpc': '2.0', 'id': 'op2', 'method': 'tools/call', 'params': { 'name': 'list_memory_ops', 'arguments': {} } })
    print('ops count=', len(json.loads(ops['result']['content'][0]['text'])))

    # search_memory smoke check
    sm = post_and_wait({ 'jsonrpc': '2.0', 'id': 'sm1', 'method': 'tools/call', 'params': { 'name': 'search_memory', 'arguments': { 'query': 'test' } } })
    print('search_memory ok=', sm['result']['content'][0]['text'] is not None)

    post_and_wait({ 'jsonrpc': '2.0', 'id': 'tick1', 'method': 'tools/call', 'params': { 'name': 'tick', 'arguments': {} } })

    print('OPENCLAW-OK')
    proc.kill()


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 openclaw_client.py <path-to-sulcus-local-binary>')
        sys.exit(2)
    main(sys.argv[1])
