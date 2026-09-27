"""End-to-end local fixture check. Run in the runtime container with the test profile."""

import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = "http://127.0.0.1:8765/internal/browser/sessions"
TOKEN = os.environ["BROWSER_RUNTIME_TOKEN"]
SESSION = "smoke-session"


def call(method, suffix="", payload=None):
    request = Request(
        ROOT + suffix,
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={"x-browser-token": TOKEN, "content-type": "application/json"},
    )
    try:
        with urlopen(request, timeout=100) as response:
            body = response.read()
            return json.loads(body) if response.headers.get_content_type() == "application/json" else body
    except HTTPError as error:
        raise AssertionError(f"{method} {suffix}: {error.code} {error.read().decode()}") from error


def ref(state, label):
    matches = [key for key, value in state["refs"].items() if label.lower() in value.lower()]
    assert len(matches) == 1, f"Missing or ambiguous {label}: {state}"
    return matches[0]


def action(state, kind, label, value=None):
    payload = {"type": kind, "target": ref(state, label)}
    if value is not None:
        payload["value"] = value
    return call("POST", f"/{SESSION}/actions", payload)["state"]


def run():
    started = call("POST", "", {"sessionId": SESSION, "startUrl": "http://browser-test:8080/", "allowedDomains": ["browser-test"]})
    state = started["state"]
    print("START", state, flush=True)
    assert state.get("fingerprint"), state
    assert "Acesso ao ERP" in state.get("visibleText", ""), state
    state = action(state, "fill", "textbox Email", "financeiro@example.com")
    state = action(state, "fill", "textbox Senha", "browser-test-password")
    state = action(state, "click", "Entrar")
    assert "Dashboard" in state["text"], state
    assert any(item.get("name") == "Usuários" for item in state.get("navigationItems", [])), state
    state = action(state, "click", "Financeiro")
    assert "/financeiro" in state["url"], state
    state = action(state, "click", "Relatórios")
    state = action(state, "fill", "Date Data", "2026-09-24")
    state = action(state, "click", "Gerar relatório")
    state = call("POST", f"/{SESSION}/actions", {"type": "wait", "seconds": 1})["state"]
    assert "83.214,22" in state["text"], state
    download = call("POST", f"/{SESSION}/actions", {"type": "download", "target": ref(state, "Baixar CSV")})
    assert download["download"]["filename"] == "relatorio.csv", download
    contents = call("GET", f"/{SESSION}/downloads/relatorio.csv")
    assert b"83214.22" in contents, contents
    extracted = call("POST", f"/{SESSION}/extract")
    assert "83.214,22" in extracted["text"], extracted
    screenshot = call("POST", f"/{SESSION}/screenshot")
    assert screenshot["base64"] and screenshot["mimeType"] == "image/png"
    closed = call("DELETE", f"/{SESSION}")
    assert closed["storageState"] and closed["storageState"].get("cookies"), closed
    restored = call("POST", "", {"sessionId": SESSION, "startUrl": "http://browser-test:8080/", "allowedDomains": ["browser-test"], "storageState": closed["storageState"]})
    assert "Dashboard" in restored["state"]["text"], restored
    call("DELETE", f"/{SESSION}")
    print("SMOKE_OK", flush=True)


if __name__ == "__main__":
    try:
        run()
    except Exception:
        try:
            call("DELETE", f"/{SESSION}")
        except Exception:
            pass
        raise
