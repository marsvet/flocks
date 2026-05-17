"""Server startup hook for the device subsystem.

Call order:
  1. ensure_default_group — FK target must exist before device rows are inserted.
  2. migrate_from_config  — idempotent migration from legacy flocks.json.
  3. sync all service_ids  — re-apply enabled/disabled state to ToolRegistry.
"""
from __future__ import annotations

from flocks.storage.storage import Storage
from flocks.utils.log import Log

from .migration import migrate_from_config
from .store import ensure_default_group
from .sync import sync_service_tool_state

log = Log.create(service="device.startup")


async def device_startup() -> None:
    await ensure_default_group()
    await migrate_from_config()
    await _sync_all_service_ids()


async def _sync_all_service_ids() -> None:
    try:
        async with Storage.connect(Storage.get_db_path()) as db:
            cur = await db.execute("SELECT DISTINCT service_id FROM device_integrations")
            service_ids = [r[0] for r in await cur.fetchall()]
        for sid in service_ids:
            await sync_service_tool_state(sid)
        if service_ids:
            log.info("device.startup.tool_sync", {"service_ids": service_ids})
    except Exception as exc:
        log.warn("device.startup.tool_sync.failed", {"error": str(exc)})
