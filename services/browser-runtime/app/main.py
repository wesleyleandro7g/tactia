"""Private, stateful Browser Use adapter. Only the Tactia backend may call it."""

import asyncio
import hmac
import hashlib
import ipaddress
import json
import os
import shutil
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from browser_use import Browser, BrowserProfile
from browser_use.browser.events import SaveStorageStateEvent
from browser_use.browser.profile import ProxySettings
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field


TOKEN = os.environ.get("BROWSER_RUNTIME_TOKEN", "")
MAX_SESSIONS = int(os.environ.get("BROWSER_MAX_SESSIONS", "2"))
IDLE_SECONDS = int(os.environ.get("BROWSER_IDLE_SECONDS", "1800"))
TEST_LOCAL = os.environ.get("BROWSER_TEST_LOCAL", "") == "true"
app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)


def authorize(x_browser_token: str | None = Header(default=None)) -> None:
    if not TOKEN or not x_browser_token or not hmac.compare_digest(TOKEN, x_browser_token):
        raise HTTPException(401, "Unauthorized")


def check_url(url: str, allowed_domains: list[str]) -> None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme not in ("http", "https") or not host:
        raise HTTPException(400, "NETWORK_BLOCKED")
    if parsed.scheme == "http" and not TEST_LOCAL:
        raise HTTPException(400, "NETWORK_BLOCKED")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    destination = host if port == 443 or (TEST_LOCAL and port in (80, 8080)) else f"{host}:{port}"
    if destination not in allowed_domains:
        raise HTTPException(400, "NETWORK_BLOCKED")
    if TEST_LOCAL and host in ("browser-test", "browser-test.local"):
        return
    try:
        if not ipaddress.ip_address(host).is_global:
            raise HTTPException(400, "NETWORK_BLOCKED")
    except ValueError:
        pass  # DNS resolution and private-address checks happen in the egress proxy.


class StartInput(BaseModel):
    sessionId: str
    startUrl: str
    allowedDomains: list[str] = Field(min_length=1)
    storageState: dict | None = None


class NavigateInput(BaseModel):
    url: str


class ActionInput(BaseModel):
    type: str
    target: str | None = None
    value: str | None = None
    seconds: float | None = None


@dataclass
class Session:
    browser: Browser
    root: Path
    allowed_domains: list[str]
    state_path: Path
    refs: dict[str, int] = field(default_factory=dict)
    ref_labels: dict[str, str] = field(default_factory=dict)
    last_activity: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


sessions: dict[str, Session] = {}
sessions_lock = asyncio.Lock()


async def egress_policy(method: str, session_id: str, allowed_domains: list[str]):
    endpoint = os.environ.get("BROWSER_EGRESS_URL", "")
    if not endpoint:
        raise HTTPException(503, "EGRESS_PROXY_REQUIRED")
    body = json.dumps({"sessionId": session_id, "allowedDomains": allowed_domains}).encode()

    def send():
        request = Request(endpoint + "/policy", data=body, method=method, headers={"x-browser-token": TOKEN, "content-type": "application/json"})
        with urlopen(request, timeout=5) as response:
            response.read()

    await asyncio.to_thread(send)


def require_session(session_id: str) -> Session:
    session = sessions.get(session_id)
    if session is None:
        raise HTTPException(404, "SESSION_EXPIRED")
    session.last_activity = time.monotonic()
    return session


async def current_page(session: Session):
    page = await session.browser.get_current_page()
    if page is None:
        raise HTTPException(409, "PAGE_CRASHED")
    return page


async def wait_for_dom_stability(page, timeout_seconds: float = 3.0) -> None:
    """Wait until two consecutive lightweight DOM observations are equal."""
    deadline = time.monotonic() + timeout_seconds
    await asyncio.sleep(0.25)
    previous = None
    stable = 0
    while time.monotonic() < deadline:
        observation = await page.evaluate(
            "() => `${location.href}|${document.body?.innerText?.length || 0}|${document.querySelectorAll('*').length}`"
        )
        if observation == previous:
            stable += 1
            if stable >= 2:
                return
        else:
            stable = 0
            previous = observation
        await asyncio.sleep(0.2)


async def snapshot(session: Session) -> dict:
    state = await session.browser.get_browser_state_summary(include_screenshot=False)
    page = await current_page(session)
    visible_text = await page.evaluate("() => document.body?.innerText?.slice(0, 12000) || ''")
    session.refs.clear()
    session.ref_labels.clear()
    lines = []
    elements = []
    navigation_items = []
    navigation_roles = {"navigation", "menu", "menuitem", "tab", "link"}
    for index, node in state.dom_state.selector_map.items():
        ref = f"@e{index}"
        session.refs[ref] = node.backend_node_id
        ax = node.ax_node
        attributes = node.attributes or {}
        role = str(getattr(ax, "role", None) or attributes.get("role") or node.node_name.lower())
        name = str(getattr(ax, "name", None) or attributes.get("aria-label") or attributes.get("placeholder") or node.get_all_children_text(1) or "")
        if not name and node.node_name.lower() in ("input", "textarea", "select"):
            name = " ".join(
                str(value)
                for value in (
                    attributes.get("name"),
                    attributes.get("id"),
                    attributes.get("autocomplete"),
                    attributes.get("type"),
                )
                if value
            )
        name = " ".join(name.split())[:180]
        href = str(attributes.get("href") or "")[:500]
        session.ref_labels[ref] = f"{role} {name}".strip()
        element = {"ref": ref, "role": role, "name": name}
        if href:
            element["href"] = href
        elements.append(element)
        lines.append(f'{ref} {role} "{name}"')
        if role.lower() in navigation_roles or node.node_name.lower() in ("nav", "a"):
            navigation_items.append(element)
    visible = str(visible_text)[:12000]
    fingerprint_source = state.url + "\n" + visible + "\n" + "\n".join(session.ref_labels.values())
    return {
        "url": state.url,
        "title": state.title,
        # Keep visible text first for old clients that still apply a single cutoff.
        "text": "Visible text:\n" + visible + "\nElements:\n" + "\n".join(lines[:250]),
        "visibleText": visible,
        "elements": elements[:250],
        "navigationItems": navigation_items[:100],
        "fingerprint": hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest()[:24],
        "tabs": [{"id": getattr(tab, "target_id", ""), "url": getattr(tab, "url", "")} for tab in state.tabs],
        "refs": session.ref_labels,
    }


@app.get("/health")
async def health():
    return {"healthy": True, "activeSessions": len(sessions)}


@app.post("/internal/browser/sessions", dependencies=[Depends(authorize)])
async def start(input: StartInput):
    check_url(input.startUrl, input.allowedDomains)
    async with sessions_lock:
        if input.sessionId in sessions:
            raise HTTPException(409, "SESSION_EXISTS")
        if len(sessions) >= MAX_SESSIONS:
            raise HTTPException(429, "CAPACITY_EXCEEDED")
        root = Path(tempfile.mkdtemp(prefix="tactia-browser-"))
        state_path = root / "storage-state.json"
        if input.storageState is not None:
            state_path.write_text(json.dumps(input.storageState), encoding="utf-8")
            state_path.chmod(0o600)
        browser = None
        try:
            await egress_policy("POST", input.sessionId, input.allowedDomains)
            browser = Browser(browser_profile=BrowserProfile(
                headless=True,
                executable_path="/usr/bin/chromium",
                user_data_dir=root / "profile",
                downloads_path=root / "downloads",
                storage_state=str(state_path),
                allowed_domains=input.allowedDomains,
                block_ip_addresses=not TEST_LOCAL,
                enable_default_extensions=False,
                proxy=ProxySettings(server=os.environ["BROWSER_EGRESS_URL"], username=input.sessionId, password=TOKEN),
            ))
            await browser.start()
            page = await browser.get_current_page()
            if page is None:
                page = await browser.new_page()
            await page.goto(input.startUrl)
            await wait_for_dom_stability(page)
        except Exception:
            try:
                if browser is not None:
                    await browser.kill()
            finally:
                try:
                    await egress_policy("DELETE", input.sessionId, input.allowedDomains)
                finally:
                    shutil.rmtree(root, ignore_errors=True)
            raise
        sessions[input.sessionId] = Session(browser, root, input.allowedDomains, state_path)
    return {"sessionId": input.sessionId, "state": await snapshot(sessions[input.sessionId])}


@app.post("/internal/browser/sessions/{session_id}/navigate", dependencies=[Depends(authorize)])
async def navigate(session_id: str, input: NavigateInput):
    session = require_session(session_id)
    check_url(input.url, session.allowed_domains)
    async with session.lock:
        page = await current_page(session)
        await page.goto(input.url)
        await wait_for_dom_stability(page)
        return {"success": True, "state": await snapshot(session)}


@app.post("/internal/browser/sessions/{session_id}/snapshot", dependencies=[Depends(authorize)])
async def get_snapshot(session_id: str):
    session = require_session(session_id)
    async with session.lock:
        return await snapshot(session)


@app.post("/internal/browser/sessions/{session_id}/actions", dependencies=[Depends(authorize)])
async def action(session_id: str, input: ActionInput):
    session = require_session(session_id)
    async with session.lock:
        page = await current_page(session)
        if input.type == "wait":
            await asyncio.sleep(min(max(input.seconds or 1, 0), 10))
        elif input.type == "press":
            await page.press(input.value or "")
        elif input.type == "scroll":
            await page.evaluate("() => window.scrollBy(0, window.innerHeight)")
        else:
            previous_downloads = {item.name for item in (session.root / "downloads").glob("*")} if input.type == "download" else set()
            node_id = session.refs.get(input.target or "")
            if node_id is None:
                raise HTTPException(409, "ELEMENT_NOT_FOUND")
            element = await page.get_element(node_id)
            if input.type in ("click", "download"):
                await element.click()
            elif input.type == "fill":
                await element.fill(input.value or "")
            elif input.type == "select":
                await element.select_option(input.value or "")
            elif input.type == "check":
                await element.check()
            elif input.type == "hover":
                await element.hover()
            else:
                raise HTTPException(400, "UNSUPPORTED_ACTION")
            if input.type in ("click", "download", "fill", "select", "check"):
                await wait_for_dom_stability(page)
        session.refs.clear()
        session.ref_labels.clear()
        if input.type == "download":
            for _ in range(60):
                files = [item for item in (session.root / "downloads").glob("*") if item.is_file() and item.name not in previous_downloads and not item.name.endswith(".crdownload")]
                if files:
                    latest = max(files, key=lambda item: item.stat().st_mtime)
                    return {"success": True, "download": {"filename": latest.name, "size": latest.stat().st_size}, "state": await snapshot(session)}
                await asyncio.sleep(0.5)
            raise HTTPException(408, "DOWNLOAD_TIMEOUT")
        return {"success": True, "state": await snapshot(session)}


@app.get("/internal/browser/sessions/{session_id}/downloads/{filename}", dependencies=[Depends(authorize)])
async def download(session_id: str, filename: str):
    from fastapi.responses import FileResponse

    session = require_session(session_id)
    if filename != Path(filename).name:
        raise HTTPException(400, "INVALID_FILENAME")
    path = session.root / "downloads" / filename
    if not path.is_file():
        raise HTTPException(404, "DOWNLOAD_NOT_FOUND")
    return FileResponse(path, filename=filename)


@app.post("/internal/browser/sessions/{session_id}/screenshot", dependencies=[Depends(authorize)])
async def screenshot(session_id: str):
    session = require_session(session_id)
    async with session.lock:
        encoded = await (await current_page(session)).screenshot(format="png")
        return {"mimeType": "image/png", "base64": encoded}


@app.post("/internal/browser/sessions/{session_id}/extract", dependencies=[Depends(authorize)])
async def extract(session_id: str):
    session = require_session(session_id)
    async with session.lock:
        text = await (await current_page(session)).evaluate("() => document.body.innerText.slice(0, 30000)")
        return {"text": str(text)[:30000]}


@app.delete("/internal/browser/sessions/{session_id}", dependencies=[Depends(authorize)])
async def close(session_id: str):
    session = sessions.pop(session_id, None)
    if session is None:
        return {"closed": True, "storageState": None}
    async with session.lock:
        try:
            event = session.browser.event_bus.dispatch(SaveStorageStateEvent(path=str(session.state_path)))
            await event
            await event.event_result(raise_if_any=True, raise_if_none=False)
            state = json.loads(session.state_path.read_text(encoding="utf-8")) if session.state_path.exists() else None
        finally:
            try:
                await session.browser.kill()
            finally:
                try:
                    await egress_policy("DELETE", session_id, session.allowed_domains)
                finally:
                    shutil.rmtree(session.root, ignore_errors=True)
    return {"closed": True, "storageState": state}


@app.on_event("startup")
async def start_cleanup():
    async def cleanup():
        while True:
            await asyncio.sleep(30)
            for session_id, session in list(sessions.items()):
                if time.monotonic() - session.last_activity > IDLE_SECONDS:
                    await close(session_id)
    asyncio.create_task(cleanup())
