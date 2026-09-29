"""Allowlist and SSRF checks for authorized portal URLs."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlparse


class UrlPolicyError(ValueError):
    """Raised when a URL is not allowed for this extract."""


def normalize_host(value: str) -> str:
    return value.strip().lower().rstrip(".")


def allowed_host_set(hosts: list[str]) -> set[str]:
    return {normalize_host(host) for host in hosts if normalize_host(host)}


def _host_allowed(hostname: str, port: int | None, scheme: str, allowed: set[str]) -> bool:
    host = normalize_host(hostname)
    default_port = 443 if scheme == "https" else 80
    explicit_port = port if port is not None else default_port
    if host in allowed:
        return explicit_port in (80, 443) or f"{host}:{explicit_port}" in allowed
    return f"{host}:{explicit_port}" in allowed


def parse_allowed_url(url: str, allowed: set[str], *, test_local: bool) -> tuple[str, int, str]:
    """Return (hostname, port, scheme) after allowlist checks. Does not resolve DNS."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme not in ("http", "https") or not host:
        raise UrlPolicyError("URL inválida.")
    if parsed.scheme == "http" and not test_local:
        raise UrlPolicyError("Somente HTTPS é permitido neste ambiente.")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if not _host_allowed(host, parsed.port, parsed.scheme, allowed):
        raise UrlPolicyError(f"Host não autorizado: {host}.")
    return host, port, parsed.scheme


def reject_non_public_literal(host: str, *, test_local: bool) -> None:
    """Block private/loopback/link-local IP literals. Hostnames are left to DNS/egress."""
    if not host:
        raise UrlPolicyError("URL inválida.")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        return
    if not test_local and not literal.is_global:
        raise UrlPolicyError("Destino não é um endereço público.")


def resolve_pinned_ip(host: str, *, test_local: bool) -> str:
    """Resolve once and return the IP that must be used for the TCP connection."""
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        reject_non_public_literal(host, test_local=test_local)
        return str(literal)
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise UrlPolicyError(f"Não foi possível resolver o host {host}.") from error
    if not infos:
        raise UrlPolicyError(f"Não foi possível resolver o host {host}.")
    addresses = [ipaddress.ip_address(info[4][0]) for info in infos]
    if test_local:
        return str(addresses[0])
    if any(not address.is_global for address in addresses):
        raise UrlPolicyError("O host resolve para um endereço não público.")
    return str(addresses[0])


def inspect_destination(
    url: str,
    allowed: set[str],
    *,
    test_local: bool,
    pin_dns: bool,
) -> tuple[str, int, str, str]:
    """Allowlist + optional single DNS lookup. Returns hostname, port, scheme, pinned IP."""
    host, port, scheme = parse_allowed_url(url, allowed, test_local=test_local)
    reject_non_public_literal(host, test_local=test_local)
    pinned = resolve_pinned_ip(host, test_local=test_local) if pin_dns else ""
    return host, port, scheme, pinned


def assert_url_allowed(url: str, allowed: set[str], *, test_local: bool, resolve_dns: bool = False) -> str:
    inspect_destination(url, allowed, test_local=test_local, pin_dns=resolve_dns)
    return url


def resolve_next_url(current_url: str, href: str, allowed: set[str], *, test_local: bool) -> str | None:
    candidate = (href or "").strip()
    if not candidate or candidate.startswith("#") or candidate.lower().startswith("javascript:"):
        return None
    joined = urljoin(current_url, candidate)
    assert_url_allowed(joined, allowed, test_local=test_local, resolve_dns=False)
    return joined
