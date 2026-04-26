import json
import mimetypes
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

DIST = Path('/app/dist').resolve()
CLI = '/app/linkmetry-cli'

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?', 1)[0] == '/api/health':
            return self.json({'ok': True})
        if self.path.split('?', 1)[0] == '/api/scan':
            return self.scan()
        if self.path.split('?', 1)[0] == '/api/storage-cards':
            return self.storage_cards()
        if self.path.split('?', 1)[0] == '/api/benchmark/auto':
            return self.auto_benchmark()
        if self.path.split('?', 1)[0] == '/api/benchmark':
            return self.benchmark()
        return self.static()

    def do_HEAD(self):
        return self.static(head=True)

    def scan(self):
        try:
            usb = self.run_cli('inspect')
            storage = self.run_cli('storage-cards')
            return self.json({
                'generated_at': self.date_time_string(),
                'platform': storage.get('platform') or usb.get('platform'),
                'usb': {'devices': usb.get('devices', [])},
                'storage': {
                    'devices': storage.get('devices', []),
                    'cards': storage.get('cards', []),
                },
            })
        except Exception as exc:
            return self.json({'error': str(exc)}, status=500)

    def storage_cards(self):
        try:
            payload = self.run_cli('storage-cards')
            payload['generated_at'] = self.date_time_string()
            return self.json(payload)
        except Exception as exc:
            return self.json({'error': str(exc)}, status=500)

    def benchmark(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            target = query.get('target', [''])[0]
            iterations = query.get('iterations', ['3'])[0]
            return self.run_benchmark(target, iterations)
        except Exception as exc:
            return self.json({'error': str(exc)}, status=500)

    def auto_benchmark(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            mount = query.get('mount', [''])[0]
            iterations = query.get('iterations', ['3'])[0]
            if not mount:
                return self.json({'error': 'Choose a drive/mount first.'}, status=400)
            target = self.find_test_file(mount)
            if not target:
                return self.json({'error': f'No large readable test file found under {mount}. Add or choose a large file manually.'}, status=404)
            return self.run_benchmark(target, iterations)
        except Exception as exc:
            return self.json({'error': str(exc)}, status=500)

    def run_benchmark(self, target, iterations):
        try:
            if not target:
                return self.json({'error': 'Choose a readable file path first.'}, status=400)
            if target.endswith('/'):
                return self.json({'error': 'Choose a specific large file, not a folder/mount point.'}, status=400)
            payload = self.run_cli_args(['diagnose-storage', '--iterations', iterations, target], timeout=180)
            payload['generated_at'] = self.date_time_string()
            return self.json(payload)
        except subprocess.CalledProcessError as exc:
            message = (exc.stderr or '').strip() or 'Benchmark command failed.'
            return self.json({'error': message}, status=500)

    def find_test_file(self, mount):
        mount_path = Path(mount).resolve()
        allowed_roots = [Path('/mnt').resolve(), Path('/home/brad/Videos').resolve(), Path('/home/brad/Documents').resolve()]
        if not any(str(mount_path).startswith(str(root)) for root in allowed_roots):
            return None
        if not mount_path.exists() or not mount_path.is_dir():
            return None

        best = None
        best_size = 0
        scanned = 0
        for root, dirs, files in os.walk(mount_path):
            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in {'node_modules', '.git', 'target'}]
            for name in files:
                scanned += 1
                if scanned > 2000:
                    break
                path = Path(root) / name
                try:
                    stat = path.stat()
                except OSError:
                    continue
                if stat.st_size >= 50 * 1024 * 1024 and stat.st_size > best_size:
                    best = path
                    best_size = stat.st_size
            if scanned > 2000:
                break
        return str(best) if best else None

    def run_cli(self, command):
        return self.run_cli_args([command])

    def run_cli_args(self, args, timeout=30):
        result = subprocess.run([CLI, *args], check=True, capture_output=True, text=True, timeout=timeout)
        return json.loads(result.stdout)

    def static(self, head=False):
        raw = self.path.split('?', 1)[0]
        path = unquote(raw).lstrip('/') or 'index.html'
        candidate = (DIST / path).resolve()
        if not str(candidate).startswith(str(DIST)) or not candidate.exists() or candidate.is_dir():
            candidate = DIST / 'index.html'
        ctype = mimetypes.guess_type(candidate.name)[0] or 'application/octet-stream'
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(candidate.stat().st_size))
        self.end_headers()
        if not head:
            self.wfile.write(candidate.read_bytes())

    def json(self, payload, status=200):
        body = json.dumps(payload, indent=2).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print('%s - - [%s] %s' % (self.client_address[0], self.log_date_time_string(), fmt % args), flush=True)

ThreadingHTTPServer(('0.0.0.0', 8000), Handler).serve_forever()
