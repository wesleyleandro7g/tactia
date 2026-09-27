"""Deterministic local ERP used only by the browser automation acceptance test."""

from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

LOGIN = b"""<!doctype html><html lang='pt-br'><title>ERP de teste</title><body>
<h1>Acesso ao ERP</h1><form action='/login' method='post'>
<label>Email <input name='username' type='email' required></label>
<label>Senha <input name='password' type='password' required></label>
<button type='submit'>Entrar</button></form></body></html>"""

DASHBOARD = rb"""<!doctype html><html lang='pt-br'><title>ERP de teste</title><body>
<h1>Dashboard</h1>
<nav aria-label='Menu principal'>
<a href='#/inicio'>In&iacute;cio</a><a href='#/clientes'>Clientes</a><a href='#/usuarios'>Usu&aacute;rios</a>
<a href='#/produtos'>Produtos</a><a href='#/vendas'>Vendas</a><button id='financeiro'>Financeiro</button>
</nav>
<main id='screen'></main><section id='dense' aria-label='Conte&uacute;do denso'></section>
<script>
const dense=document.querySelector('#dense');
for(let i=0;i<320;i++){const button=document.createElement('button');button.textContent='A\u00e7\u00e3o secund\u00e1ria '+i;dense.appendChild(button)}
const screen=document.querySelector('#screen');
document.querySelector('#financeiro').onclick=()=>{history.pushState({},'', '/financeiro');screen.innerHTML='<h2>Financeiro</h2><button id="reports">Relat\u00f3rios</button>';document.querySelector('#reports').onclick=()=>{history.pushState({},'', '/relatorios');screen.innerHTML='<h2>Relat\u00f3rios</h2><label>Data <input type="date" id="date"></label><button id="generate">Gerar relat\u00f3rio</button><div id="result"></div>';document.querySelector('#generate').onclick=()=>{screen.querySelector('#result').textContent='Carregando...';setTimeout(()=>{screen.querySelector('#result').innerHTML='<p>Faturamento: R$ 83.214,22</p><a href="/report.csv" download="relatorio.csv">Baixar CSV</a>'},600)}}};
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def authenticated(self):
        jar = cookies.SimpleCookie()
        jar.load(self.headers.get("Cookie", ""))
        return jar.get("session") and jar["session"].value == "browser-test-session"

    def respond(self, status, body, content_type="text/html; charset=utf-8", cookie=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/report.csv" and self.authenticated():
            self.respond(200, b"data,faturamento\nontem,83214.22\n", "text/csv")
        elif self.authenticated():
            self.respond(200, DASHBOARD)
        else:
            self.respond(200, LOGIN)

    def do_POST(self):
        size = int(self.headers.get("Content-Length", "0"))
        values = parse_qs(self.rfile.read(size).decode())
        if self.path == "/login" and values.get("username") == ["financeiro@example.com"] and values.get("password") == ["browser-test-password"]:
            self.send_response(303)
            self.send_header("Location", "/")
            self.send_header("Set-Cookie", "session=browser-test-session; HttpOnly; SameSite=Lax; Path=/")
            self.end_headers()
        else:
            self.respond(401, b"Login inv\xc3\xa1lido")


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
