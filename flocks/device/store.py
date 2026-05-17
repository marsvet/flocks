"""Database access helpers for device_groups and device_integrations."""
from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, List, Optional

import aiosqlite

from flocks.storage.storage import Storage
from flocks.utils.log import Log

from .models import (
    DEFAULT_GROUP_ID,
    DEFAULT_GROUP_NAME,
    DeviceGroup,
    DeviceIntegration,
)
from .secrets import mask_for_display, resolve_for_runtime

log = Log.create(service="device.store")


# ---------------------------------------------------------------------------
# Key derivation
# ---------------------------------------------------------------------------

def storage_key_to_service_id(storage_key: str) -> str:
    """Strip version suffix: ``sangfor_af_v8_0_106`` → ``sangfor_af``."""
    return re.sub(r"_v[\w.]+$", "", storage_key, flags=re.IGNORECASE)


# ---------------------------------------------------------------------------
# Row → model converters
# ---------------------------------------------------------------------------

def row_to_device(row: aiosqlite.Row) -> DeviceIntegration:
    raw_fields: Dict[str, str] = json.loads(row["fields"] or "{}")
    display, has_value = mask_for_display(raw_fields)
    return DeviceIntegration(
        id=row["id"],
        group_id=row["group_id"] or DEFAULT_GROUP_ID,
        name=row["name"],
        storage_key=row["storage_key"],
        service_id=row["service_id"],
        enabled=bool(row["enabled"]),
        verify_ssl=bool(row["verify_ssl"]),
        fields=display,
        fields_set=has_value,
        status=row["status"] or "unknown",
        message=row["message"],
        latency_ms=row["latency_ms"],
        checked_at=row["checked_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def row_to_group(row: aiosqlite.Row) -> DeviceGroup:
    return DeviceGroup(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        sort_order=row["sort_order"] or 0,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ---------------------------------------------------------------------------
# DB queries
# ---------------------------------------------------------------------------

async def fetch_device(device_id: str) -> Optional[aiosqlite.Row]:
    async with Storage.connect(Storage.get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM device_integrations WHERE id = ?", (device_id,)
        ) as cur:
            return await cur.fetchone()


async def group_exists(group_id: str) -> bool:
    async with Storage.connect(Storage.get_db_path()) as db:
        async with db.execute(
            "SELECT 1 FROM device_groups WHERE id = ?", (group_id,)
        ) as cur:
            return (await cur.fetchone()) is not None


async def list_devices(group_id: Optional[str] = None) -> List[DeviceIntegration]:
    async with Storage.connect(Storage.get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        if group_id:
            cur = await db.execute(
                "SELECT * FROM device_integrations WHERE group_id = ? ORDER BY created_at DESC",
                (group_id,),
            )
        else:
            cur = await db.execute(
                "SELECT * FROM device_integrations ORDER BY created_at DESC"
            )
        rows = await cur.fetchall()
        await cur.close()
    return [row_to_device(r) for r in rows]


async def list_groups() -> List[DeviceGroup]:
    async with Storage.connect(Storage.get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM device_groups ORDER BY sort_order ASC, created_at ASC"
        ) as cur:
            rows = await cur.fetchall()
    return [row_to_group(r) for r in rows]


# ---------------------------------------------------------------------------
# Default group bootstrapping
# ---------------------------------------------------------------------------

async def ensure_default_group() -> None:
    """Create the default room on first run. Idempotent.

    Only inserts if the row is missing; user renames are preserved.
    """
    async with Storage.connect(Storage.get_db_path()) as db:
        async with db.execute(
            "SELECT 1 FROM device_groups WHERE id = ?", (DEFAULT_GROUP_ID,)
        ) as cur:
            if await cur.fetchone():
                return
        now = int(time.time() * 1000)
        await db.execute(
            """
            INSERT INTO device_groups (id, name, description, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, ?)
            """,
            (DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME, "默认机房，可重命名", now, now),
        )
        await db.commit()
    log.info("device.default_group.created", {"id": DEFAULT_GROUP_ID})


# ---------------------------------------------------------------------------
# Public runtime helper — used by Agent tools and future callers
# ---------------------------------------------------------------------------

async def get_device_credentials(device_id: str) -> Optional[Dict[str, Any]]:
    """Return plaintext credentials for *device_id*, or None if not found/disabled.

    This is the single safe entry-point for downstream code that needs to
    make outbound API calls on behalf of a device instance.
    """
    row = await fetch_device(device_id)
    if row is None or not bool(row["enabled"]):
        return None
    raw_fields: Dict[str, str] = json.loads(row["fields"] or "{}")
    return {
        "id": row["id"],
        "name": row["name"],
        "storage_key": row["storage_key"],
        "service_id": row["service_id"],
        "verify_ssl": bool(row["verify_ssl"]),
        "fields": resolve_for_runtime(raw_fields),
    }
