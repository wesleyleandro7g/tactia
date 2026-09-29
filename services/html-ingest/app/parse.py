"""Extract structured rows from HTML using Scrapling's Selector (no fetchers)."""

from __future__ import annotations

import threading
from typing import Any
from urllib.parse import urljoin

from scrapling.core.storage import SQLiteStorageSystem
from scrapling.parser import Selector

from .errors import ExtractFailed
from .url_policy import UrlPolicyError, resolve_next_url


MAX_PAGES = 50
MAX_ROWS = 10_000
_ADAPTIVE_LOCK = threading.Lock()


def query(node: Any, selector: str, **kwargs: Any) -> Any:
    expression = selector.strip()
    if expression.startswith("/") or expression.startswith("("):
        return node.xpath(expression, **kwargs)
    return node.css(expression, **kwargs)


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    getter = getattr(value, "get", None)
    if callable(getter) and value is not getter:
        try:
            extracted = getter()
        except TypeError:
            extracted = None
        if extracted is not None and extracted is not value:
            return _as_text(extracted)
    if hasattr(value, "__iter__") and not isinstance(value, (str, bytes)):
        try:
            first = value[0]
        except (IndexError, KeyError, TypeError):
            first = None
        if first is not None:
            return _as_text(first)
    text = str(value).strip()
    return text or None


def _href_from(matched: Any, current_url: str) -> str | None:
    text = _as_text(matched)
    if text and ("/" in text or text.startswith("http") or text.startswith("?")):
        return urljoin(current_url, text)
    candidate = matched
    getter = getattr(matched, "get", None)
    if callable(getter):
        try:
            candidate = getter()
        except TypeError:
            candidate = matched
    if candidate is None:
        try:
            candidate = matched[0]
        except (IndexError, KeyError, TypeError):
            return None
    attrib = getattr(candidate, "attrib", None)
    if attrib is not None:
        href = attrib.get("href") if hasattr(attrib, "get") else None
        if href:
            return urljoin(current_url, str(href))
    return None


def _select_items(page: Selector, item_selector: str, adaptive: bool) -> Any:
    items = query(page, item_selector, auto_save=adaptive) if adaptive else query(page, item_selector)
    if items:
        return items
    if adaptive:
        return query(page, item_selector, adaptive=True)
    return items


def extract_rows_from_page(
    page: Selector,
    *,
    fields: dict[str, str],
    item_selector: str,
    id_field: str,
    adaptive: bool,
    warnings: list[str],
    remaining: int,
) -> tuple[list[dict[str, str | None]], int]:
    items = _select_items(page, item_selector, adaptive)
    if not items:
        warnings.append(f"Seletor não encontrou itens: {item_selector}")
        return [], remaining

    rows: list[dict[str, str | None]] = []
    for item in items:
        if remaining <= 0:
            break
        row: dict[str, str | None] = {}
        for name, selector in fields.items():
            row[name] = _as_text(query(item, selector))
        identity = row.get(id_field)
        if not identity:
            warnings.append(f"Item sem identificador ({id_field}); linha ignorada.")
            continue
        row["external_id"] = identity
        rows.append(row)
        remaining -= 1
    return rows, remaining


def parse_html(
    html: str,
    *,
    url: str,
    item_selector: str,
    id_field: str,
    fields: dict[str, str],
    adaptive: bool,
    storage_file: str | None,
    warnings: list[str],
    remaining: int,
) -> tuple[list[dict[str, str | None]], int]:
    use_adaptive = bool(adaptive and storage_file)
    if use_adaptive:
        with _ADAPTIVE_LOCK:
            return _parse_html_unlocked(
                html,
                url=url,
                item_selector=item_selector,
                id_field=id_field,
                fields=fields,
                adaptive=True,
                storage_file=storage_file,
                warnings=warnings,
                remaining=remaining,
            )
    return _parse_html_unlocked(
        html,
        url=url,
        item_selector=item_selector,
        id_field=id_field,
        fields=fields,
        adaptive=False,
        storage_file=None,
        warnings=warnings,
        remaining=remaining,
    )


def _parse_html_unlocked(
    html: str,
    *,
    url: str,
    item_selector: str,
    id_field: str,
    fields: dict[str, str],
    adaptive: bool,
    storage_file: str | None,
    warnings: list[str],
    remaining: int,
) -> tuple[list[dict[str, str | None]], int]:
    storage_args = {"storage_file": storage_file, "url": url} if storage_file else None
    page = Selector(
        html,
        url=url,
        adaptive=adaptive,
        storage=SQLiteStorageSystem,
        storage_args=storage_args,
    )
    return extract_rows_from_page(
        page,
        fields=fields,
        item_selector=item_selector,
        id_field=id_field,
        adaptive=adaptive,
        warnings=warnings,
        remaining=remaining,
    )


def require_extracted_rows(
    rows: list[dict[str, str | None]],
    warnings: list[str],
    *,
    allow_empty: bool,
) -> None:
    if rows or allow_empty:
        return
    raise ExtractFailed(warnings[0] if warnings else "Nenhum registro extraído.")


def next_page_url(
    html: str,
    *,
    url: str,
    next_selector: str,
    allowed: set[str],
    test_local: bool,
    adaptive: bool,
    storage_file: str | None,
) -> str | None:
    storage_args = {"storage_file": storage_file, "url": url} if storage_file else None
    page = Selector(
        html,
        url=url,
        adaptive=bool(adaptive and storage_file),
        storage=SQLiteStorageSystem,
        storage_args=storage_args,
    )
    matched = query(page, next_selector)
    href = _href_from(matched, url)
    if not href:
        return None
    try:
        return resolve_next_url(url, href, allowed, test_local=test_local)
    except UrlPolicyError:
        return None
