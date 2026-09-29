from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import sys
import threading
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.errors import ExtractFailed
from app import main as ingest_main


FIXTURE = (Path(__file__).parent / "fixtures" / "products.html").read_bytes()


class ExtractSyncTest(unittest.TestCase):
    def setUp(self) -> None:
        os.environ.pop("HTML_INGEST_EGRESS_URL", None)
        ingest_main.TEST_LOCAL = True

    def tearDown(self) -> None:
        server = getattr(self, "_server", None)
        if server is not None:
            server.shutdown()

    def _serve(self, handler_cls: type[BaseHTTPRequestHandler]) -> str:
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self._server = server
        host, port = server.server_address[:2]
        return f"http://{host}:{port}"

    def test_empty_selector_fails_closed(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(FIXTURE)

            def log_message(self, format: str, *args: object) -> None:
                return

        origin = self._serve(Handler)
        port = urlparse(origin).port
        payload = ingest_main.ExtractInput(
            tenantId="tenant1",
            dataSourceId="source1",
            allowedHosts=[f"127.0.0.1:{port}"],
            resource={
                "key": "products",
                "startUrl": f"{origin}/produtos",
                "itemSelector": "tr.ausente",
                "idField": "sku",
                "fields": {"sku": "td.sku::text"},
            },
        )
        with self.assertRaises(ExtractFailed):
            ingest_main._extract_sync(payload)

    def test_allow_empty_returns_zero_rows(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(FIXTURE)

            def log_message(self, format: str, *args: object) -> None:
                return

        origin = self._serve(Handler)
        port = urlparse(origin).port
        payload = ingest_main.ExtractInput(
            tenantId="tenant1",
            dataSourceId="source1",
            allowedHosts=[f"127.0.0.1:{port}"],
            resource={
                "key": "products",
                "startUrl": f"{origin}/produtos",
                "itemSelector": "tr.ausente",
                "idField": "sku",
                "fields": {"sku": "td.sku::text"},
                "allowEmpty": True,
            },
        )
        result = ingest_main._extract_sync(payload)
        self.assertEqual(result["rows"], [])
        self.assertTrue(result["warnings"])

    def test_offset_fetches_past_the_first_limit_rows(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(FIXTURE)

            def log_message(self, format: str, *args: object) -> None:
                return

        origin = self._serve(Handler)
        port = urlparse(origin).port
        payload = ingest_main.ExtractInput(
            tenantId="tenant1",
            dataSourceId="source1",
            allowedHosts=[f"127.0.0.1:{port}"],
            resource={
                "key": "products",
                "startUrl": f"{origin}/produtos",
                "itemSelector": "tr.produto",
                "idField": "sku",
                "fields": {"sku": "td.sku::text", "name": "td.nome::text"},
            },
            limit=1,
            offset=1,
        )
        result = ingest_main._extract_sync(payload)
        rows = result["rows"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["sku"], "SKU-2")


if __name__ == "__main__":
    unittest.main()
