import json
import shutil
import subprocess
import threading
import time
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
PS = shutil.which('powershell.exe')
pytestmark = pytest.mark.skipif(not PS, reason='Windows PowerShell required')


def probe(tmp_path, replies, timeout=2000, delay=0.2):
    lock = threading.Lock()
    counts = {'active': 0, 'peak': 0}
    ports = []
    with ExitStack() as stack:
        for status, body in replies:
            def handler_for(code, payload):
                class Handler(BaseHTTPRequestHandler):
                    def do_GET(self):
                        with lock:
                            counts['active'] += 1
                            counts['peak'] = max(counts['peak'], counts['active'])
                        try:
                            time.sleep(delay)
                            data = payload.encode()
                            self.send_response(code)
                            self.send_header('Content-Length', str(len(data)))
                            self.end_headers()
                            self.wfile.write(data)
                        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                            pass
                        finally:
                            with lock:
                                counts['active'] -= 1

                    def log_message(self, *_args):
                        pass
                return Handler

            server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(status, body))
            stack.callback(server.server_close)
            stack.callback(server.shutdown)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            ports.append(server.server_port)
        script = tmp_path / 'probe.ps1'
        script.write_text('''param([string]$Root,[string]$Ports,[int]$Timeout)
$ErrorActionPreference='Stop'
$null = . (Join-Path $Root 'scripts/mes-service-control.ps1') -Action Status -IgnorePortListeners -NoOpen -StateFile (Join-Path $PSScriptRoot 'missing.json')
$backendPort,$frontendPort,$limsSimulatorPort,$upperComputerSimulatorPort = @($Ports.Split(',') | ForEach-Object { [int]$_ })
$clock=[Diagnostics.Stopwatch]::StartNew()
$health=Get-MesServiceHealth -TimeoutMilliseconds $Timeout
@{health=$health;milliseconds=$clock.Elapsed.TotalMilliseconds} | ConvertTo-Json -Compress
''', encoding='utf-8-sig')
        result = subprocess.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script),
            '-Root', str(ROOT), '-Ports', ','.join(map(str, ports)), '-Timeout', str(timeout)],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=15)
        assert result.returncode == 0, result.stdout + result.stderr
        return json.loads(result.stdout), counts['peak']


@pytest.mark.parametrize('replies,expected', [
    ([(204, ''), (202, 'web'), (200, '{"connected":true}'),
      (200, '{"connected":true,"config":{"auto_mode":true}}')], [True, True, True, True]),
    ([(200, 'api'), (200, 'web'), (200, '{"connected":false}'),
      (200, '{"connected":true,"config":{"auto_mode":false,"autoMode":true}}')], [True, True, False, False]),
    ([(503, 'down'), (404, 'missing'), (201, '{"connected":true}'),
      (200, '{"connected":true,"config":{"autoMode":true}}')], [False, False, True, True]),
    ([(200, 'api'), (200, 'web'), (200, 'invalid-json'),
      (200, '{"connected":false,"config":{"auto_mode":true}}')], [True, True, False, False]),
])
def test_startup_probes_overlap_and_preserve_each_service_readiness_rule(tmp_path, replies, expected):
    result, peak = probe(tmp_path, replies)
    assert peak == 4
    assert [result['health'][key] for key in ('backend', 'frontend', 'lims', 'upperComputer')] == expected


def test_unavailable_services_share_one_timeout_instead_of_four(tmp_path):
    replies = [(200, '{}')] * 4
    result, peak = probe(tmp_path, replies, timeout=400, delay=3)
    assert peak == 4
    assert not any(result['health'].values())
    assert result['milliseconds'] < 1800
