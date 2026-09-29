"""HTTPS client with allowlist, IP pinning, and hop-by-hop redirect checks.

Does not use Scrapling fetchers, curl_cffi, or Playwright. Automatic redirect
following is disabled: each Location is allowlisted (and, without egress, pinned)
before the next TCP connection.
"""

from __future__ import annotations

import base64
import http.client
import json
import os
import socket
import ssl
import uuid
from dataclasses import dataclass
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

from .errors import ExtractFailed
from .url_policy import UrlPolicyError, inspect_destination, parse_allowed_url, reject_non_public_literal

MAX_REDIRECTS = 5
MAX_BODY_BYTES = 10 * 1024 * 1024
REQUEST_TIMEOUT = 30
USER_AGENT = "Tactia-html-ingest/1.0"


@dataclass(frozen=True)
class FetchedPage:
    url: str
    html: str
    status: int


def _path_query(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path or "/"
    if parsed.query:
        return f"{path}?{parsed.query}"
    return path


def _basic_proxy_auth(session_id: str, token: str) -> str:
    raw = f"{session_id}:{token}".encode()
    return "Basic " + base64.b64encode(raw).decode("ascii")


def _cookie_from_set_cookie(value: str) -> tuple[str, str] | None:
    first = value.split(";", 1)[0]
    if "=" not in first:
        return None
    name, _, cookie_value = first.partition("=")
    name = name.strip()
    if not name:
        return None
    return name, cookie_value.strip()


class HttpSession:
    def __init__(
        self,
        *,
        allowed: set[str],
        test_local: bool,
        headers: dict[str, str] | None = None,
        egress_url: str = "",
        egress_token: str = "",
    ) -> None:
        self.allowed = allowed
        self.test_local = test_local
        self.base_headers = {key: value for key, value in (headers or {}).items() if value}
        self.egress_url = egress_url.rstrip("/")
        self.egress_token = egress_token
        self.session_id = uuid.uuid4().hex
        self._cookies: dict[str, str] = {}
        self._conns: list[http.client.HTTPConnection] = []

    def __enter__(self) -> HttpSession:
        if self.egress_url:
            if not self.egress_token:
                raise UrlPolicyError("Token de egress ausente.")
            self._egress_policy("POST")
        elif not self.test_local:
            raise UrlPolicyError("Egress obrigatório fora de HTML_INGEST_TEST_LOCAL.")
        return self

    def __exit__(self, *exc: object) -> None:
        for conn in self._conns:
            try:
                conn.close()
            except OSError:
                pass
        self._conns.clear()
        if self.egress_url:
            try:
                self._egress_policy("DELETE")
            except (UrlPolicyError, OSError, TimeoutError):
                pass

    def login(
        self,
        url: str,
        *,
        username_field: str,
        password_field: str,
        username: str,
        password: str,
    ) -> FetchedPage:
        body = urlencode({username_field: username, password_field: password}).encode("utf-8")
        return self.request(
            "POST",
            url,
            body=body,
            extra_headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    def get(self, url: str) -> FetchedPage:
        return self.request("GET", url)

    def request(
        self,
        method: str,
        url: str,
        *,
        body: bytes | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> FetchedPage:
        current_url = url
        current_method = method.upper()
        current_body = body
        for _ in range(MAX_REDIRECTS + 1):
            host, port, scheme, pinned_ip = inspect_destination(
                current_url,
                self.allowed,
                test_local=self.test_local,
                pin_dns=not self.egress_url,
            )
            conn = self._open(host, port, scheme, pinned_ip)
            headers = self._request_headers(extra_headers)
            conn.request(current_method, _path_query(current_url), body=current_body, headers=headers)
            response = conn.getresponse()
            self._store_cookies(response)
            status = response.status
            location = response.getheader("Location")
            if 300 <= status < 400 and location:
                response.read()
                conn.close()
                current_url = urljoin(current_url, location.strip())
                parse_allowed_url(current_url, self.allowed, test_local=self.test_local)
                reject_non_public_literal(urlparse(current_url).hostname or "", test_local=self.test_local)
                if status in (301, 302, 303):
                    current_method = "GET"
                    current_body = None
                continue
            payload = response.read(MAX_BODY_BYTES + 1)
            conn.close()
            if status >= 400:
                raise ExtractFailed(f"HTTP {status} em {current_url}")
            if len(payload) > MAX_BODY_BYTES:
                raise ExtractFailed("Resposta HTML excede o limite.")
            html = payload.decode("utf-8", errors="replace")
            return FetchedPage(url=current_url, html=html, status=status)
        raise UrlPolicyError("Muitos redirecionamentos.")

    def _request_headers(self, extra: dict[str, str] | None) -> dict[str, str]:
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Connection": "close",
            **self.base_headers,
            **(extra or {}),
        }
        cookie_parts: list[str] = []
        if headers.get("Cookie"):
            cookie_parts.append(headers["Cookie"])
        if self._cookies:
            cookie_parts.append("; ".join(f"{name}={value}" for name, value in self._cookies.items()))
        if cookie_parts:
            headers["Cookie"] = "; ".join(cookie_parts)
        return headers

    def _store_cookies(self, response: http.client.HTTPResponse) -> None:
        raw_headers = getattr(response.headers, "get_all", None)
        values = raw_headers("Set-Cookie") if callable(raw_headers) else None
        if not values:
            single = response.getheader("Set-Cookie")
            values = [single] if single else []
        for item in values:
            parsed = _cookie_from_set_cookie(item)
            if parsed:
                self._cookies[parsed[0]] = parsed[1]

    def _open(self, host: str, port: int, scheme: str, pinned_ip: str) -> http.client.HTTPConnection:
        if self.egress_url:
            return self._open_via_egress(host, port, scheme)
        if not pinned_ip:
            raise UrlPolicyError(f"Não foi possível resolver o host {host}.")
        sock = socket.create_connection((pinned_ip, port), REQUEST_TIMEOUT)
        return self._wrap_socket(sock, host, port, scheme)

    def _open_via_egress(self, host: str, port: int, scheme: str) -> http.client.HTTPConnection:
        proxy = urlparse(self.egress_url)
        if proxy.scheme not in ("http", "https") or not proxy.hostname:
            raise UrlPolicyError("URL de egress inválida.")
        proxy_port = proxy.port or (443 if proxy.scheme == "https" else 80)
        tunnel = http.client.HTTPConnection(proxy.hostname, proxy_port, timeout=REQUEST_TIMEOUT)
        tunnel.set_tunnel(
            host,
            port=port,
            headers={"Proxy-Authorization": _basic_proxy_auth(self.session_id, self.egress_token)},
        )
        try:
            tunnel.connect()
        except OSError as error:
            raise UrlPolicyError("Egress recusou ou não alcançou o destino.") from error
        self._conns.append(tunnel)
        if tunnel.sock is None:
            raise UrlPolicyError("Egress não estabeleceu o túnel.")
        sock = tunnel.sock
        tunnel.sock = None
        return self._wrap_socket(sock, host, port, scheme)

    def _wrap_socket(
        self,
        sock: socket.socket,
        host: str,
        port: int,
        scheme: str,
    ) -> http.client.HTTPConnection:
        if scheme == "https":
            context = ssl.create_default_context()
            try:
                tls = context.wrap_socket(sock, server_hostname=host)
            except ssl.SSLError as error:
                sock.close()
                raise UrlPolicyError("Falha no TLS com o destino autorizado.") from error
            conn = http.client.HTTPSConnection(host, port, timeout=REQUEST_TIMEOUT, context=context)
            conn.sock = tls
        else:
            if not self.test_local:
                sock.close()
                raise UrlPolicyError("Somente HTTPS é permitido neste ambiente.")
            conn = http.client.HTTPConnection(host, port, timeout=REQUEST_TIMEOUT)
            conn.sock = sock
        self._conns.append(conn)
        return conn

    def _egress_policy(self, method: str) -> None:
        body = json.dumps({"sessionId": self.session_id, "allowedDomains": sorted(self.allowed)}).encode()
        request = Request(
            f"{self.egress_url}/policy",
            data=body,
            method=method,
            headers={"x-browser-token": self.egress_token, "content-type": "application/json"},
        )
        try:
            with urlopen(request, timeout=5) as response:
                response.read()
        except OSError as error:
            raise UrlPolicyError("Não foi possível registrar a política de egress.") from error


def session_from_env(
    *,
    allowed: set[str],
    test_local: bool,
    headers: dict[str, str],
) -> HttpSession:
    return HttpSession(
        allowed=allowed,
        test_local=test_local,
        headers=headers,
        egress_url=os.environ.get("HTML_INGEST_EGRESS_URL", ""),
        egress_token=os.environ.get("HTML_INGEST_EGRESS_TOKEN")
        or os.environ.get("BROWSER_RUNTIME_TOKEN", ""),
    )
