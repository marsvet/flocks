"""Synchronise LLM tool visibility with device enabled/disabled state.

Rule (per storage_key):
  ≥1 enabled device instance sharing a storage_key  →  api_services[storage_key].enabled = True
  0  enabled device instances for a storage_key      →  api_services[storage_key].enabled = False

Using per-storage-key logic means two instances of the same product type
(different storage_keys) are enabled/disabled independently.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict

from flocks.storage.storage import Storage
from flocks.utils.log import Log

log = Log.create(service="tool.device.sync")


async def sync_service_tool_state(service_id: str) -> None:
    """Sync tool visibility for every storage_key that belongs to *service_id*.

    For each distinct storage_key under the service, enable it if at least one
    device instance with that storage_key is enabled; disable it otherwise.
    """
    try:
        from flocks.config.config_writer import ConfigWriter
        from flocks.tool.registry import ToolRegistry

        # Aggregate enabled state per storage_key
        key_enabled: Dict[str, bool] = defaultdict(bool)
        async with Storage.connect(Storage.get_db_path()) as db:
            async with db.execute(
                "SELECT storage_key, enabled FROM device_integrations WHERE service_id = ?",
                (service_id,),
            ) as cur:
                rows = await cur.fetchall()

        for row in rows:
            sk, enabled = row[0], bool(row[1])
            # OR logic within each storage_key group
            key_enabled[sk] = key_enabled[sk] or enabled

        for sk, should_enable in key_enabled.items():
            existing = ConfigWriter.get_api_service_raw(sk)
            entry = existing if isinstance(existing, dict) else {}
            entry["enabled"] = should_enable
            ConfigWriter.set_api_service(sk, entry)

        ToolRegistry._sync_api_service_states()

        log.info("tool.device.sync", {
            "service_id": service_id,
            "storage_keys": {k: v for k, v in key_enabled.items()},
        })
    except Exception as exc:
        log.warn("tool.device.sync.failed", {"service_id": service_id, "error": str(exc)})
