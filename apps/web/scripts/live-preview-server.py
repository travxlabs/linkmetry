import json
import mimetypes
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

DIST = Path('/app/dist').resolve()
CLI = '/app/linkmetry-cli'

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?', 1)[0] == '/api/health':
            return self.json({'ok': True})
        if self.path.split('?', 1)[0] == '/api/storage-cards':
            return self.storage_cards()
        return self.static()

    def do_HEAD(self):
        return self.static(head=True)

    def storage_cards(self):
        try:
            result = subprocess.run([CLI, 'storage-cards'], check=True, capture_output=True, text=True, timeout=30)
            payload = json.loads(result.stdout)
            payload['generated_at'] = self.date_time_string()
            return self.json(payload)
        except Exception as exc:
            return self.json({'error': str(exc)}, status=500)

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
