"""Secret-management helpers for device integrations.

All sensitive credential values are stored in ``.secret.json`` via
SecretManager (file mode 0600). The SQL ``fields`` column holds an
opaque ``{secret:device_<uuid>_<key>}`` placeholder instead.
"""
from __future__ import annotations

from typing import Dict, Optional, Tuple

from flocks.utils.log import Log

log = Log.create(service="device.secrets")

#: Used as fallback when a plugin's ``_provider.yaml`` has no credential schema.
_FALLBACK_SECRET_KEYS = frozenset(
    {"api_key", "secret", "password", "token", "client_secret", "access_token"}
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _device_secret_id(device_id: str, field_key: str) -> str:
    """``device_<uuid>_<field_key>`` — unique, device-scoped secret name."""
    return f"device_{device_id}_{field_key}"


def _secret_keys_for(storage_key: str) -> frozenset[str]:
    """Return the field keys that must be stored in ``.secret.json``.

    Reads ``_provider.yaml`` credential schema; falls back to the
    hard-coded sensitive-name list for legacy/missing schemas.
    """
    try:
        from flocks.server.routes.provider import (
            _build_api_service_credential_schema,
            _load_api_service_metadata_data,
        )
        meta = _load_api_service_metadata_data(storage_key) or {}
        schema = _build_api_service_credential_schema(storage_key, meta)
        return frozenset(f.key for f in schema if f.storage == "secret")
    except Exception:
        return _FALLBACK_SECRET_KEYS


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def persist_fields(
    device_id: str,
    storage_key: str,
    incoming: Dict[str, str],
    prior_db_fields: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Write secrets to SecretManager; return the ``fields`` dict for SQL.

    Rules:
    - **Sensitive field, non-empty value** → write to SecretManager,
      store ``{secret:device_<id>_<key>}`` placeholder in result.
    - **Sensitive field, empty/missing value** → keep existing placeholder
      ("leave blank = keep current" UX).
    - **Non-sensitive field** → store plaintext in result.
    - Keys absent from ``incoming`` inherit from ``prior_db_fields``.
    """
    from flocks.security import get_secret_manager

    secret_keys = _secret_keys_for(storage_key)
    secrets = get_secret_manager()
    result = dict(prior_db_fields or {})

    for key, value in (incoming or {}).items():
        if key in secret_keys:
            if not value or not value.strip():
                continue  # keep existing placeholder
            secret_id = _device_secret_id(device_id, key)
            try:
                secrets.set(secret_id, value)
            except Exception as exc:
                log.warn("device.secret.set_error", {"id": secret_id, "error": str(exc)})
                continue
            result[key] = f"{{secret:{secret_id}}}"
        else:
            result[key] = value

    return result


def delete_secrets(device_id: str, db_fields: Dict[str, str]) -> None:
    """Remove all SecretManager entries owned by this device. Idempotent."""
    from flocks.security import get_secret_manager

    secrets = get_secret_manager()
    prefix = f"device_{device_id}_"
    for raw in db_fields.values():
        if isinstance(raw, str) and raw.startswith("{secret:") and raw.endswith("}"):
            secret_id = raw[len("{secret:"):-1]
            if secret_id.startswith(prefix):
                try:
                    secrets.delete(secret_id)
                except Exception as exc:
                    log.warn("device.secret.delete_error", {"id": secret_id, "error": str(exc)})


def mask_for_display(db_fields: Dict[str, str]) -> Tuple[Dict[str, str], Dict[str, bool]]:
    """Return ``(display_fields, fields_set)`` safe to expose to the frontend.

    Sensitive placeholders are resolved and masked (e.g. ``sk-***abc``).
    Plaintext values pass through unchanged.
    ``fields_set[key]`` is True when a value is actually configured.
    """
    from flocks.security import get_secret_manager
    from flocks.security.secrets import SecretManager

    secrets = get_secret_manager()
    display: Dict[str, str] = {}
    has_value: Dict[str, bool] = {}

    for key, raw in db_fields.items():
        if isinstance(raw, str) and raw.startswith("{secret:") and raw.endswith("}"):
            secret_id = raw[len("{secret:"):-1]
            real = secrets.get(secret_id) or ""
            display[key] = SecretManager.mask(real) if real else ""
            has_value[key] = bool(real)
        else:
            display[key] = raw if isinstance(raw, str) else ""
            has_value[key] = bool(display[key])

    return display, has_value


def resolve_for_runtime(db_fields: Dict[str, str]) -> Dict[str, str]:
    """Resolve ``{secret:…}`` placeholders to plaintext.

    Call ONLY at the moment of making an outbound API request.
    Never store or return the result through a public interface.
    """
    from flocks.security import get_secret_manager

    secrets = get_secret_manager()
    return {
        key: (secrets.get(raw[len("{secret:"):-1]) or "")
             if isinstance(raw, str) and raw.startswith("{secret:") and raw.endswith("}")
             else (raw if isinstance(raw, str) else "")
        for key, raw in db_fields.items()
    }
