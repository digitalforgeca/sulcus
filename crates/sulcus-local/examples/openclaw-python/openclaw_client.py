#!/usr/bin/env python3
"""Minimal OpenClaw-style MCP example (Python).
Usage: python3 openclaw_client.py <path-to-sulcus-local-binary>
"""
import json
import os
import subprocess
import sys
import tempfile


def send_and_recv(proc, req):
    line = json.dumps(req) + "\n"
    proc.stdin.write(line.encode())
    proc.stdin.flush()
    out = proc.stdout.readline()
    if not out:
        raise RuntimeError('sulcus-local closed stdout')
    return json.loads(out.decode())


def main(bin_path):
    tmpdir = tempfile.mkdtemp(prefix='sulcus-')
    db_path = os.path.join(tmpdir, 'memory.db')
    # create empty DB file so sqlite/sqlx can open it
    open(db_path, 'a').close()
    try:
        os.chmod(db_path, 0o666)
    except Exception:
        pass
    env = os.environ.copy()
    env['SULCUS_DB_PATH'] = db_path

    proc = subprocess.Popen([bin_path, 'serve'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)

    # describe_tools
    print('tools/list ->', send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 't0', 'method': 'tools/list' })['result']['tools'])

    # upsert/get via tools/call
    nid = '00000000-0000-0000-0000-000000000123'
    send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 'u1', 'method': 'tools/call', 'params': { 'name': 'upsert_node', 'arguments': { 'id': nid, 'label': 'py-node', 'pointer_summary': 'py-node', 'current_heat': 0.12, 'base_utility': 0.0, 'is_pinned': False } } })
    got = send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 'g1', 'method': 'tools/call', 'params': { 'name': 'get_node', 'arguments': { 'node_id': nid } } })
    got_inner = json.loads(got['result']['content'][0]['text'])
    print('get_node pointer_summary=', got_inner['node']['pointer_summary'])

    # add_memory + resources/read
    send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 'm1', 'method': 'tools/call', 'params': { 'name': 'add_memory', 'arguments': { 'content': 'py test memory' } } })
    res = send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 'r1', 'method': 'resources/read', 'params': { 'uri': 'memory://active_index', 'limit': 10 } })
    contents = res['result']['contents']
    active_text = contents[0]['text']
    active = json.loads(active_text)
    print('active_index len=', len(active))

    # summarize
    s = send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 's1', 'method': 'tools/call', 'params': { 'name': 'summarize', 'arguments': { 'text': 'Python test. Next sentence.', 'max_chars': 80 } } })
    s_inner = json.loads(s['result']['content'][0]['text'])
    print('summary=', s_inner['summary'])

    # record/list ops
    send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 'op1', 'method': 'tools/call', 'params': { 'name': 'record_memory_op', 'arguments': { 'op_type': 'PY_TEST', 'payload': { 'a': 1 } } } })
    ops = send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 'op2', 'method': 'tools/call', 'params': { 'name': 'list_memory_ops', 'arguments': {} } })
    print('ops count=', len(json.loads(ops['result']['content'][0]['text'])))

    # server cursor / last_seq
    send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 'sc1', 'method': 'tools/call', 'params': { 'name': 'set_server_cursor', 'arguments': { 'cursor': 'c-py' } } })
    sc = send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 'sc2', 'method': 'tools/call', 'params': { 'name': 'get_server_cursor', 'arguments': {} } })
    sc_inner = json.loads(sc['result']['content'][0]['text'])
    print('server_cursor=', sc_inner['cursor'])

    send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 'ls1', 'method': 'tools/call', 'params': { 'name': 'set_last_seq', 'arguments': { 'seq': 999 } } })
    ls = send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 'ls2', 'method': 'tools/call', 'params': { 'name': 'get_last_seq', 'arguments': {} } })
    ls_inner = json.loads(ls['result']['content'][0]['text'])
    print('last_seq=', ls_inner['seq'])

    send_and_recv(proc, { 'jsonrpc': '2.0', 'id': 'tick1', 'method': 'tools/call', 'params': { 'name': 'tick', 'arguments': {} } })

    print('OPENCLAW-OK')
    proc.kill()


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 openclaw_client.py <path-to-sulcus-local-binary>')
        sys.exit(2)
    main(sys.argv[1])
