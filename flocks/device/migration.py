"""One-time, idempotent migration: flocks.json api_services → device_integrations.

For each ``api_services`` entry that:
  * declares ``integration_type: device`` in its ``_provider.yaml``;
  * has at least one non-empty credential value;
  * has not been migrated before (per ``device.migration.done`` storage marker);

…create a corresponding row in ``device_integrations``, re-isolating its
secrets under the new ``device_<uuid>_<field>`` namespace.

The per-storage_key marker ensures the migration is skipped on subsequent
restarts and is unaffected by the user deleting a previously migrated device.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any, Dict

from flocks.storage.storage import Storage
from flocks.utils.log import Log

from .models import DEFAULT_GROUP_ID
from .secrets import persist_fields
from .store import storage_key_to_service_id

log = Log.create(service="device.migration")


async def migrate_from_config() -> None:
    """Migrate legacy device API configurations from ``flocks.json`` to SQL."""
    try:
        from flocks.config.config_writer import ConfigWriter
        from flocks.security import get_secret_manager
        from flocks.server.routes.provider import (
            _build_api_service_credential_schema,
            _get_api_service_secret_candidates,
            _load_api_service_metadata_data,
        )
    except Exception as exc:
        log.warn("device.migrate.import_error", {"error": str(exc)})
        return

    raw_services: Dict[str, Any] = ConfigWriter.list_api_services_raw()
    if not raw_services:
        return

    marker: Dict[str, Any] = await Storage.get("device.migration.done") or {}
    if not isinstance(marker, dict):
        marker = {}

    secrets = get_secret_manager()
    new_marker = dict(marker)

    for storage_key, raw_cfg in raw_services.items():
        if not isinstance(raw_cfg, dict):
            continue

        try:
            meta = _load_api_service_metadata_data(storage_key) or {}
        except Exception:
            continue

        if meta.get("integration_type") != "device":
            continue

        if marker.get(storage_key):
            log.info("device.migrate.skip", {"storage_key": storage_key, "reason": "already done"})
            continue

        # --- Extract plain-text values from config + secret store ---
        schema = _build_api_service_credential_schema(storage_key, meta)
        plain_values: Dict[str, str] = {}

        for field in schema:
            if field.storage == "config":
                # Look for the value under the canonical key, the config_key, or camelCase variants
                for candidate in (field.config_key, field.key, "baseUrl" if field.key == "base_url" else None):
                    if candidate and isinstance(raw_cfg.get(candidate), str) and raw_cfg[candidate]:
                        plain_values[field.key] = raw_cfg[candidate]
                        break
            else:
                for secret_id in _get_api_service_secret_candidates(
                    storage_key, raw_cfg, field_name=field.key
                ):
                    val = secrets.get(secret_id)
                    if val:
                        plain_values[field.key] = val
                        break

        # Legacy fallbacks for plugins without a formal schema
        for legacy_key, field_name in [("base_url", "base_url"), ("baseUrl", "base_url"), ("username", "username")]:
            if field_name not in plain_values and isinstance(raw_cfg.get(legacy_key), str) and raw_cfg[legacy_key]:
                plain_values[field_name] = raw_cfg[legacy_key]

        if not any(v for v in plain_values.values()):
            new_marker[storage_key] = int(time.time() * 1000)
            log.info("device.migrate.skip", {"storage_key": storage_key, "reason": "no credentials"})
            continue

        # --- Create device row ---
        service_name = meta.get("name") or storage_key.replace("_", " ").title()
        device_id = str(uuid.uuid4())
        now = int(time.time() * 1000)

        # Re-scope secrets to the new device_<uuid>_<field> namespace
        db_fields = persist_fields(device_id, storage_key, plain_values, prior_db_fields=None)

        try:
            async with Storage.connect(Storage.get_db_path()) as db:
                await db.execute(
                    """
                    INSERT INTO device_integrations
                        (id, group_id, name, storage_key, service_id, enabled, verify_ssl,
                         fields, status, message, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', '从 flocks.json 自动迁移', ?, ?)
                    """,
                    (
                        device_id,
                        DEFAULT_GROUP_ID,
                        f"{service_name}（迁移）",
                        storage_key,
                        storage_key_to_service_id(storage_key),
                        int(bool(raw_cfg.get("enabled", False))),
                        int(bool(raw_cfg.get("verify_ssl") or raw_cfg.get("verifySsl") or False)),
                        json.dumps(db_fields),
                        now,
                        now,
                    ),
                )
                await db.commit()
            new_marker[storage_key] = now
            log.info("device.migrate.created", {"storage_key": storage_key, "id": device_id})
        except Exception as exc:
            log.warn("device.migrate.insert_error", {"storage_key": storage_key, "error": str(exc)})

    if new_marker != marker:
        try:
            await Storage.set("device.migration.done", new_marker)
        except Exception as exc:
            log.warn("device.migrate.marker_error", {"error": str(exc)})
