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
    print('describe_tools ->', send_and_recv(proc, { 'id': 't0', 'method': 'describe_tools' })['result']['name'])

    # upsert/get
    nid = '00000000-0000-0000-0000-000000000123'
    send_and_recv(proc, { 'id': 'u1', 'method': 'upsert_node', 'params': { 'id': nid, 'summary': 'py-node', 'heat': 12.0 } })
    got = send_and_recv(proc, { 'id': 'g1', 'method': 'get_node', 'params': { 'node_id': nid } })
    print('get_node summary=', got['result']['node']['summary'])

    # add_memory + resource
    send_and_recv(proc, { 'id': 'm1', 'method': 'add_memory', 'params': { 'content': 'py test memory' } })
    res = send_and_recv(proc, { 'id': 'r1', 'method': 'resource', 'params': { 'resource': 'memory://active_index', 'limit': 10 } })
    print('active_index len=', len(res['result']))

    # summarize
    s = send_and_recv(proc, { 'id': 's1', 'method': 'summarize', 'params': { 'text': 'Python test. Next sentence.', 'max_chars': 80 } })
    print('summary=', s['result']['summary'])

    # record/list ops
    send_and_recv(proc, { 'id': 'op1', 'method': 'record_memory_op', 'params': { 'op_type': 'PY_TEST', 'payload': { 'a': 1 } } })
    ops = send_and_recv(proc, { 'id': 'op2', 'method': 'list_memory_ops' })
    print('ops count=', len(ops['result']))

    # server cursor / last_seq
    send_and_recv(proc, { 'id': 'sc1', 'method': 'set_server_cursor', 'params': { 'cursor': 'c-py' } })
    sc = send_and_recv(proc, { 'id': 'sc2', 'method': 'get_server_cursor' })
    print('server_cursor=', sc['result']['cursor'])

    send_and_recv(proc, { 'id': 'ls1', 'method': 'set_last_seq', 'params': { 'seq': 999 } })
    ls = send_and_recv(proc, { 'id': 'ls2', 'method': 'get_last_seq' })
    print('last_seq=', ls['result']['seq'])

    send_and_recv(proc, { 'id': 'tick1', 'method': 'tick' })

    print('OPENCLAW-OK')
    proc.kill()


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 openclaw_client.py <path-to-sulcus-local-binary>')
        sys.exit(2)
    main(sys.argv[1])
