"""Private, token-gated HTML extract API for Tactia connectors."""

from __future__ import annotations

import asyncio
import hmac
import os
import re
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .errors import ExtractFailed
from .http_client import session_from_env
from .parse import MAX_PAGES, MAX_ROWS, next_page_url, parse_html, require_extracted_rows
from .url_policy import UrlPolicyError, allowed_host_set, assert_url_allowed


TOKEN = os.environ.get("HTML_INGEST_TOKEN", "")
TEST_LOCAL = os.environ.get("HTML_INGEST_TEST_LOCAL", "") == "true"
ADAPTIVE_DIR = Path(os.environ.get("HTML_INGEST_ADAPTIVE_DIR", "/data/adaptive"))
SAFE_ID = re.compile(r"^[a-zA-Z0-9_-]+$")
SAFE_RESOURCE = re.compile(r"^[a-zA-Z0-9_.-]+$")

app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)


def authorize(x_html_ingest_token: str | None = Header(default=None)) -> None:
    if not TOKEN or not x_html_ingest_token or not hmac.compare_digest(TOKEN, x_html_ingest_token):
        raise HTTPException(401, "Unauthorized")


class PaginationModel(BaseModel):
    nextSelector: str
    maxPages: int = Field(default=20, ge=1, le=MAX_PAGES)


class ResourceModel(BaseModel):
    key: str
    startUrl: str
    itemSelector: str
    idField: str
    fields: dict[str, str]
    pagination: PaginationModel | None = None
    allowEmpty: bool = False


class LoginModel(BaseModel):
    url: str
    usernameField: str
    passwordField: str


class CredentialsModel(BaseModel):
    username: str | None = None
    password: str | None = None
    cookie: str | None = None
    authorization: str | None = None


class ExtractInput(BaseModel):
    tenantId: str
    dataSourceId: str
    allowedHosts: list[str] = Field(min_length=1)
    resource: ResourceModel
    login: LoginModel | None = None
    credentials: CredentialsModel = Field(default_factory=CredentialsModel)
    adaptive: bool = True
    allowEmpty: bool = False
    limit: int | None = Field(default=None, ge=1, le=MAX_ROWS)
    offset: int = Field(default=0, ge=0)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def _storage_file(tenant_id: str, data_source_id: str, resource_key: str) -> Path:
    if not SAFE_ID.match(tenant_id) or not SAFE_ID.match(data_source_id):
        raise HTTPException(400, "Identificadores inválidos.")
    if not SAFE_RESOURCE.match(resource_key) or ".." in resource_key:
        raise HTTPException(400, "Identificadores inválidos.")
    directory = ADAPTIVE_DIR / tenant_id
    directory.mkdir(parents=True, exist_ok=True)
    safe_key = re.sub(r"[^a-zA-Z0-9_-]", "_", resource_key)
    return directory / f"{data_source_id}__{safe_key}.sqlite"


def _extract_sync(payload: ExtractInput) -> dict[str, object]:
    allowed = allowed_host_set(payload.allowedHosts)
    if not allowed:
        raise UrlPolicyError("Informe ao menos um host autorizado.")
    resolve_dns = not bool(os.environ.get("HTML_INGEST_EGRESS_URL", "").strip())
    assert_url_allowed(payload.resource.startUrl, allowed, test_local=TEST_LOCAL, resolve_dns=resolve_dns)
    if payload.login:
        assert_url_allowed(payload.login.url, allowed, test_local=TEST_LOCAL, resolve_dns=resolve_dns)

    offset = min(payload.offset, MAX_ROWS)
    take = min(payload.limit or MAX_ROWS, MAX_ROWS)
    if offset >= MAX_ROWS or take <= 0:
        return {"resource": payload.resource.key, "rows": [], "warnings": []}
    remaining = min(offset + take, MAX_ROWS)
    warnings: list[str] = []
    collected: list[dict[str, str | None]] = []
    allow_empty = payload.allowEmpty or payload.resource.allowEmpty
    headers = {
        key: value
        for key, value in {
            "Cookie": payload.credentials.cookie,
            "Authorization": payload.credentials.authorization,
        }.items()
        if value
    }
    login = (
        {
            "url": payload.login.url,
            "usernameField": payload.login.usernameField,
            "passwordField": payload.login.passwordField,
        }
        if payload.login
        else None
    )
    credentials = {
        "username": payload.credentials.username or "",
        "password": payload.credentials.password or "",
    }
    storage = (
        str(_storage_file(payload.tenantId, payload.dataSourceId, payload.resource.key))
        if payload.adaptive
        else None
    )
    session = session_from_env(allowed=allowed, test_local=TEST_LOCAL, headers=headers)
    with session:
        if login:
            session.login(
                login["url"],
                username_field=login["usernameField"],
                password_field=login["passwordField"],
                username=credentials["username"],
                password=credentials["password"],
            )
        page = session.get(payload.resource.startUrl)
        max_pages = payload.resource.pagination.maxPages if payload.resource.pagination else 1
        max_pages = max(1, min(max_pages, MAX_PAGES))
        for index in range(max_pages):
            extracted, remaining = parse_html(
                page.html,
                url=page.url,
                item_selector=payload.resource.itemSelector,
                id_field=payload.resource.idField,
                fields=payload.resource.fields,
                adaptive=bool(payload.adaptive and storage),
                storage_file=storage,
                warnings=warnings,
                remaining=remaining,
            )
            if index == 0:
                require_extracted_rows(extracted, warnings, allow_empty=allow_empty)
            collected.extend(extracted)
            if remaining <= 0 or not payload.resource.pagination:
                break
            nxt = next_page_url(
                page.html,
                url=page.url,
                next_selector=payload.resource.pagination.nextSelector,
                allowed=allowed,
                test_local=TEST_LOCAL,
                adaptive=bool(payload.adaptive and storage),
                storage_file=storage,
            )
            if not nxt:
                break
            page = session.get(nxt)

    rows = collected[offset : offset + take]
    return {"resource": payload.resource.key, "rows": rows, "warnings": warnings}


@app.post("/internal/html/extract", dependencies=[Depends(authorize)])
async def extract(payload: ExtractInput) -> dict[str, object]:
    try:
        return await asyncio.to_thread(_extract_sync, payload)
    except UrlPolicyError as error:
        raise HTTPException(400, str(error)) from error
    except ExtractFailed as error:
        raise HTTPException(422, str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(502, "Falha ao extrair o portal autorizado.") from error
