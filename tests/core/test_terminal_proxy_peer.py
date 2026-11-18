import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

import pytest

ROOT = Path(__file__).resolve().parents[2]


def test_public_frontend_proxy_reports_actual_peer_instead_of_caller_supplied_header(tmp_path):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js required')

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            content = json.dumps({'peer': self.headers.get('x-forwarded-for')}).encode()
            self.send_response(200); self.send_header('Content-Length', str(len(content))); self.end_headers(); self.wfile.write(content)

        def log_message(self, *_):
            pass

    backend = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=backend.serve_forever, daemon=True); thread.start()
    script = tmp_path / 'frontend/scripts/serve-public.mjs'
    script.parent.mkdir(parents=True)
    shutil.copy2(ROOT / 'frontend/scripts/serve-public.mjs', script)
    dist = tmp_path / 'frontend/dist'; dist.mkdir(); (dist / 'index.html').write_text('fixture')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
    process = subprocess.Popen([node, str(script), '--host', '127.0.0.1', '--port', str(port)],
                               env={**os.environ, 'BACKEND_TARGET': f'http://127.0.0.1:{backend.server_port}'},
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                request = Request(f'http://127.0.0.1:{port}/api/peer', headers={'X-Forwarded-For': '203.0.113.99'})
                with urlopen(request, timeout=2) as response:
                    assert json.loads(response.read())['peer'] == '127.0.0.1'
                break
            except OSError:
                assert time.monotonic() < deadline
                time.sleep(.1)
    finally:
        process.terminate(); process.wait(timeout=5)
        backend.shutdown(); backend.server_close(); thread.join(timeout=5)
