from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.errors import ExtractFailed
from app.http_client import HttpSession
from app.url_policy import UrlPolicyError


FIXTURE = (Path(__file__).parent / "fixtures" / "products.html").read_bytes()


def serve(handler_cls: type[BaseHTTPRequestHandler]) -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    return server, f"http://{host}:{port}"


class HttpClientTest(unittest.TestCase):
    def tearDown(self) -> None:
        server = getattr(self, "_server", None)
        if server is not None:
            server.shutdown()

    def test_get_pins_and_returns_html(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(FIXTURE)

            def log_message(self, format: str, *args: object) -> None:
                return

        self._server, origin = serve(Handler)
        port = urlparse(origin).port
        allowed = {f"127.0.0.1:{port}"}
        with HttpSession(allowed=allowed, test_local=True) as session:
            page = session.get(f"{origin}/produtos")
        self.assertEqual(page.status, 200)
        self.assertIn("SKU-1", page.html)

    def test_validates_each_redirect_before_the_next_request(self):
        hits: list[str] = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                hits.append(self.path)
                if self.path == "/start":
                    self.send_response(302)
                    self.send_header("Location", "/final")
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"<html>ok</html>")

            def log_message(self, format: str, *args: object) -> None:
                return

        self._server, origin = serve(Handler)
        port = urlparse(origin).port
        allowed = {f"127.0.0.1:{port}"}
        with HttpSession(allowed=allowed, test_local=True) as session:
            page = session.get(f"{origin}/start")
        self.assertEqual(hits, ["/start", "/final"])
        self.assertTrue(page.url.endswith("/final"))
        self.assertIn("ok", page.html)

    def test_rejects_offsite_redirect_without_following(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(302)
                self.send_header("Location", "http://evil.example/phish")
                self.end_headers()

            def log_message(self, format: str, *args: object) -> None:
                return

        self._server, origin = serve(Handler)
        port = urlparse(origin).port
        allowed = {f"127.0.0.1:{port}"}
        with HttpSession(allowed=allowed, test_local=True) as session:
            with self.assertRaises(UrlPolicyError):
                session.get(f"{origin}/start")

    def test_http_error_is_extract_failed(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b"no")

            def log_message(self, format: str, *args: object) -> None:
                return

        self._server, origin = serve(Handler)
        port = urlparse(origin).port
        allowed = {f"127.0.0.1:{port}"}
        with HttpSession(allowed=allowed, test_local=True) as session:
            with self.assertRaises(ExtractFailed):
                session.get(f"{origin}/login")

    def test_production_without_egress_fails_closed(self):
        with self.assertRaises(UrlPolicyError):
            HttpSession(allowed={"portal.cliente.com.br"}, test_local=False).__enter__()


if __name__ == "__main__":
    unittest.main()
