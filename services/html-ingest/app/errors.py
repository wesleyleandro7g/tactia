"""Typed failures for the HTML ingest sidecar."""


class ExtractFailed(ValueError):
    """Login, HTTP, layout or selector failed; do not treat as an empty success."""
