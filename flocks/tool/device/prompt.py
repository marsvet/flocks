"""Build the "已接入安全设备" section injected into the Agent system prompt.

Gives the Agent a structured view of:
  机房 (Machine Room) → 设备 (Device) → 可用工具 (Available Tools)

so it knows which tool name corresponds to which physical device when
multiple instances of the same device type are connected.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from flocks.utils.log import Log

from .models import DeviceGroup, DeviceIntegration
from .store import list_devices, list_groups

log = Log.create(service="tool.device.prompt")


async def build_device_context_section() -> Optional[str]:
    """Return a Markdown block describing the device asset context.

    Returns None when no devices are registered, so the caller can skip injection.
    """
    try:
        groups = await list_groups()
        devices = await list_devices()
    except Exception as exc:
        log.warn("tool.device.prompt.load_failed", {"error": str(exc)})
        return None

    if not devices:
        return None

    tool_map = _build_tool_map()
    group_map: Dict[str, DeviceGroup] = {g.id: g for g in groups}

    by_group: Dict[str, List[DeviceIntegration]] = {}
    for device in devices:
        by_group.setdefault(device.group_id, []).append(device)

    lines: List[str] = [
        "<DeviceAssetContext>",
        "## 已接入安全设备",
        "",
        "以下是当前机房中已接入的安全设备及其可用工具。",
        "调用工具时必须通过 `device_id` 参数指定目标设备，工具将自动使用该设备的凭据，例如：",
        '`tdp_event_list(action="list", device_id="<device_id>")`',
        "",
    ]

    for group_id, group_devices in by_group.items():
        group = group_map.get(group_id)
        group_name = group.name if group else group_id
        lines.append(f"### 机房: {group_name}")
        lines.append("")

        for d in group_devices:
            status = "✅ 已启用" if d.enabled else "❌ 已禁用"
            tools = tool_map.get(d.storage_key, [])

            lines.append(f"**{d.name}** | device_id: `{d.id}` | {status}")
            if d.enabled and tools:
                tool_str = " ".join(f"`{t}`" for t in sorted(tools))
                lines.append(f"  可用工具: {tool_str}")
                lines.append(f"  调用方式: 调用上述工具时附带 `device_id=\"{d.id}\"` 参数以指定本设备")
            elif not d.enabled:
                lines.append("  可用工具: (已禁用，不可调用)")
            else:
                lines.append("  可用工具: (未发现已注册工具)")
            lines.append("")

    lines.append("</DeviceAssetContext>")
    return "\n".join(lines)


def _build_tool_map() -> Dict[str, List[str]]:
    """Return {storage_key: [enabled_tool_name, ...]} from the live ToolRegistry."""
    result: Dict[str, List[str]] = {}
    try:
        from flocks.tool.registry import ToolRegistry

        for tool in ToolRegistry.list_tools():
            if tool.provider and tool.enabled:
                result.setdefault(tool.provider, []).append(tool.name)
    except Exception as exc:
        log.warn("tool.device.prompt.tool_map_failed", {"error": str(exc)})
    return result
