"""Authenticated forward proxy enforcing per-session destination policy."""

import asyncio
import base64
import hmac
import ipaddress
import json
import os
import socket
from urllib.parse import urlparse

TOKEN = os.environ.get("BROWSER_RUNTIME_TOKEN", "")
TEST_LOCAL = os.environ.get("BROWSER_TEST_LOCAL", "") == "true"
POLICIES: dict[str, set[str]] = {}


def destination_allowed(policy: set[str], host: str, port: int) -> bool:
    host = host.lower().rstrip(".")
    if port == 443:
        return host in policy
    if TEST_LOCAL and port in (80, 8080):
        return host in policy or f"{host}:{port}" in policy
    return f"{host}:{port}" in policy


def log_blocked(session_id: str, host: str, port: int) -> None:
    print(
        json.dumps(
            {
                "event": "browser_egress_blocked",
                "sessionId": session_id,
                "destination": f"{host}:{port}",
            }
        ),
        flush=True,
    )


async def reply(writer: asyncio.StreamWriter, status: str, body: bytes = b"", extra_headers: str = ""):
    writer.write(f"HTTP/1.1 {status}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n{extra_headers}\r\n".encode() + body)
    await writer.drain()


def authorized(headers: dict[str, str]) -> str | None:
    raw = headers.get("proxy-authorization", "")
    try:
        user, secret = base64.b64decode(raw.split(" ", 1)[1]).decode().split(":", 1)
    except (IndexError, ValueError):
        return None
    if not TOKEN or not hmac.compare_digest(secret, TOKEN) or user not in POLICIES:
        return None
    return user


async def allowed(session_id: str, host: str, port: int) -> str | None:
    host = host.lower().rstrip(".")
    if not destination_allowed(POLICIES[session_id], host, port):
        return None
    if TEST_LOCAL and host in ("browser-test", "browser-test.local"):
        return host
    try:
        records = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
        addresses = [record[4][0] for record in records]
    except socket.gaierror:
        return None
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        return None
    return addresses[0]


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        while chunk := await reader.read(64 * 1024):
            writer.write(chunk)
            await writer.drain()
    except (ConnectionError, OSError):
        pass
    finally:
        writer.close()


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        line = await asyncio.wait_for(reader.readline(), 10)
        if len(line) > 8192:
            return
        parts = line.decode("latin1").strip().split(" ")
        if len(parts) != 3:
            await reply(writer, "400 Bad Request")
            return
        method, target, _ = parts
        headers: dict[str, str] = {}
        while True:
            raw = await asyncio.wait_for(reader.readline(), 10)
            if raw in (b"\r\n", b"\n", b""):
                break
            if len(raw) > 8192 or len(headers) > 60:
                return
            key, _, value = raw.decode("latin1").partition(":")
            headers[key.lower()] = value.strip()

        if target == "/policy" and method in ("POST", "DELETE"):
            if not TOKEN or not hmac.compare_digest(headers.get("x-browser-token", ""), TOKEN):
                await reply(writer, "401 Unauthorized")
                return
            size = int(headers.get("content-length", "0"))
            if size > 4096:
                await reply(writer, "413 Payload Too Large")
                return
            payload = json.loads(await reader.readexactly(size))
            session_id = str(payload["sessionId"])
            if method == "POST":
                POLICIES[session_id] = set(payload["allowedDomains"])
            else:
                POLICIES.pop(session_id, None)
            await reply(writer, "200 OK", b"{}")
            return

        session_id = authorized(headers)
        if not session_id:
            await reply(writer, "407 Proxy Authentication Required", extra_headers='Proxy-Authenticate: Basic realm="Tactia Browser"\r\n')
            return
        if method == "CONNECT":
            host, _, port_text = target.rpartition(":")
            port = int(port_text or "443")
            if not 1 <= port <= 65535:
                await reply(writer, "403 Forbidden")
                return
            address = await allowed(session_id, host, port)
            if not address:
                log_blocked(session_id, host, port)
                await reply(writer, "403 Forbidden")
                return
            remote_reader, remote_writer = await asyncio.open_connection(address, port)
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await writer.drain()
        else:
            parsed = urlparse(target)
            host = parsed.hostname or ""
            port = parsed.port or 80
            if parsed.scheme != "http" or not TEST_LOCAL or port not in (80, 8080):
                await reply(writer, "403 Forbidden")
                return
            address = await allowed(session_id, host, port)
            if not address:
                await reply(writer, "403 Forbidden")
                return
            remote_reader, remote_writer = await asyncio.open_connection(address, port)
            path = parsed.path or "/"
            if parsed.query:
                path += "?" + parsed.query
            remote_writer.write(f"{method} {path} HTTP/1.1\r\n".encode())
            for key, value in headers.items():
                if key not in ("proxy-authorization", "proxy-connection", "connection"):
                    remote_writer.write(f"{key}: {value}\r\n".encode("latin1"))
            remote_writer.write(b"Connection: close\r\n\r\n")
            await remote_writer.drain()

        tasks = [asyncio.create_task(pipe(reader, remote_writer)), asyncio.create_task(pipe(remote_reader, writer))]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in tasks:
            task.cancel()
    except (ValueError, KeyError, OSError, asyncio.TimeoutError, asyncio.IncompleteReadError):
        await reply(writer, "400 Bad Request")
    finally:
        writer.close()


async def main():
    server = await asyncio.start_server(handle, "0.0.0.0", 8888)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
