#!/usr/bin/env python3
# 가디언즈 파일 수신기 — 업데이트 때 EXE·ZIP·확장 파일을 /opt/guardians/downloads 로 받는 임시 통로
# 사용(서버): sudo python3 /opt/guardians/deploy/recv.py <토큰> [포트=8088]   (받기 끝나면 자동 종료)
#   보내는 쪽: POST /up/<토큰>/<파일명> 로 조각을 순서대로, 마지막에 POST /done/<토큰>/<파일명>
import http.server, sys, os, re
TOKEN = sys.argv[1]; PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8088
DL = '/opt/guardians/downloads'; os.makedirs(DL, exist_ok=True)
SAFE = re.compile(r'^[A-Za-z0-9._-]+$')
class H(http.server.BaseHTTPRequestHandler):
    def _ok(self, msg): self.send_response(200); self.end_headers(); self.wfile.write(msg.encode())
    def do_POST(self):
        p = self.path.split('/')
        if len(p) < 4 or p[2] != TOKEN or not SAFE.match(p[3]): self.send_response(404); self.end_headers(); return
        n = int(self.headers.get('Content-Length', '0')); data = self.rfile.read(n); part = os.path.join(DL, p[3] + '.part'); final = os.path.join(DL, p[3])
        if p[1] == 'reset': open(part, 'wb').close(); self._ok('OK 0')
        elif p[1] == 'up': open(part, 'ab').write(data); self._ok('OK %d' % os.path.getsize(part))
        elif p[1] == 'done': os.replace(part, final); self._ok('DONE %d' % os.path.getsize(final))
        elif p[1] == 'quit': self._ok('BYE'); sys.exit(0)
        else: self.send_response(404); self.end_headers()
    def log_message(self, *a): pass
print('RECV_READY port', PORT, flush=True)
http.server.HTTPServer(('0.0.0.0', PORT), H).serve_forever()
