from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.url_policy import UrlPolicyError, allowed_host_set, assert_url_allowed, resolve_next_url


class UrlPolicyTest(unittest.TestCase):
    def test_https_host_on_allowlist(self):
        allowed = allowed_host_set(["portal.cliente.com.br"])
        self.assertEqual(
            assert_url_allowed("https://portal.cliente.com.br/produtos", allowed, test_local=True),
            "https://portal.cliente.com.br/produtos",
        )

    def test_rejects_host_outside_allowlist(self):
        allowed = allowed_host_set(["portal.cliente.com.br"])
        with self.assertRaises(UrlPolicyError):
            assert_url_allowed("https://evil.example/x", allowed, test_local=True)

    def test_rejects_http_unless_test_local(self):
        allowed = allowed_host_set(["portal.cliente.com.br"])
        with self.assertRaises(UrlPolicyError):
            assert_url_allowed("http://portal.cliente.com.br/x", allowed, test_local=False)

    def test_rejects_private_ip_destination(self):
        allowed = allowed_host_set(["127.0.0.1"])
        with self.assertRaises(UrlPolicyError):
            assert_url_allowed("https://127.0.0.1/secret", allowed, test_local=False)

    def test_resolve_next_stays_on_allowlist(self):
        allowed = allowed_host_set(["portal.cliente.com.br"])
        nxt = resolve_next_url(
            "https://portal.cliente.com.br/produtos",
            "/produtos?page=2",
            allowed,
            test_local=True,
        )
        self.assertEqual(nxt, "https://portal.cliente.com.br/produtos?page=2")

    def test_resolve_next_rejects_offsite(self):
        allowed = allowed_host_set(["portal.cliente.com.br"])
        with self.assertRaises(UrlPolicyError):
            resolve_next_url(
                "https://portal.cliente.com.br/produtos",
                "https://evil.example/phish",
                allowed,
                test_local=True,
            )


if __name__ == "__main__":
    unittest.main()
