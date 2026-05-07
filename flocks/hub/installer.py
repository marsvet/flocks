"""Installer for bundled Hub plugins."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from flocks.hub import local
from flocks.hub.catalog import load_manifest
from flocks.hub.files import plugin_root
from flocks.hub.models import InstalledPluginRecord, PluginType
from flocks.hub.paths import get_bundled_hub_root
from flocks.hub.security import SKIP_NAMES, validate_package


_TOOL_TYPE_DIRS = {"api", "python", "mcp", "generated"}


def _copytree_skip_caches(src: Path, dst: Path) -> None:
    """``shutil.copytree`` wrapper that prunes ``SKIP_NAMES`` entries.

    Bundled flockshub trees can carry leftover ``__pycache__``/VCS dirs
    after dev runs; we strip them on install so downstream loaders see
    a clean payload (and so our own validate_package can stay strict).
    """
    shutil.copytree(
        src,
        dst,
        ignore=lambda _src, names: [n for n in names if n in SKIP_NAMES],
    )


def _resolve_install_destination(
    plugin_type: PluginType,
    plugin_id: str,
    src: Path,
    scope: str,
) -> Path:
    """Pick an install destination that mirrors the source's layout.

    The default ``local.install_dir`` returns ``<base>/<plugin_id>``,
    which is fine for skills/agents/workflows but loses the
    ``api/``/``python/`` group prefix that tool plugins can ship with
    inside flockshub (e.g. ``flockshub/plugins/tools/api/<id>/``).
    Stripping that prefix at install time would silently break
    :mod:`flocks.config.api_versioning`'s ``_provider.yaml`` discovery,
    which expects ``<plugins>/tools/api/<id>/_provider.yaml``.

    For ``plugin_type == "tool"`` we therefore preserve the source's
    immediate parent (when it is one of the recognised group dirs)
    and install to ``<base>/<group>/<plugin_id>/``. All other plugin
    types fall back to the standard layout.
    """
    if plugin_type != "tool":
        return local.install_dir(plugin_type, plugin_id, scope)

    try:
        bundled_root = get_bundled_hub_root().resolve()
        src_resolved = src.resolve()
        bundled_tools = bundled_root / "plugins" / "tools"
        if bundled_tools.is_dir() and (
            bundled_tools.resolve() in src_resolved.parents
            or src_resolved == bundled_tools.resolve()
        ):
            rel = src_resolved.relative_to(bundled_tools.resolve())
            if rel.parts and rel.parts[0] in _TOOL_TYPE_DIRS:
                return local.install_root(plugin_type, scope) / rel.parts[0] / plugin_id
    except (ValueError, OSError):
        pass

    return local.install_dir(plugin_type, plugin_id, scope)


def _copy_package(src: Path, dst: Path) -> None:
    parent = dst.parent
    parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=f".{dst.name}.", dir=str(parent)))
    try:
        for item in src.iterdir():
            if item.name == "manifest.json" or item.name in SKIP_NAMES:
                continue
            target = tmp / item.name
            if item.is_dir():
                _copytree_skip_caches(item, target)
            else:
                shutil.copy2(item, target)
        backup = None
        if dst.exists():
            backup = parent / f".{dst.name}.bak"
            if backup.exists():
                shutil.rmtree(backup)
            dst.replace(backup)
        tmp.replace(dst)
        if backup and backup.exists():
            shutil.rmtree(backup)
    except Exception:
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
        raise


async def _refresh_runtime(plugin_type: PluginType) -> None:
    if plugin_type == "skill":
        from flocks.skill.skill import Skill

        Skill.clear_cache()
        try:
            from flocks.agent.registry import Agent

            Agent.invalidate_cache()
        except Exception:
            pass
    elif plugin_type == "agent":
        from flocks.agent.registry import Agent

        Agent.invalidate_cache()
    elif plugin_type == "tool":
        from flocks.tool.registry import ToolRegistry

        ToolRegistry.init()
        ToolRegistry.refresh_plugin_tools()
    elif plugin_type == "workflow":
        try:
            from flocks.workflow.center import scan_skill_workflows

            await scan_skill_workflows()
        except Exception:
            pass


async def install_plugin(
    plugin_type: PluginType,
    plugin_id: str,
    *,
    scope: str = "global",
) -> InstalledPluginRecord:
    manifest = load_manifest(plugin_type, plugin_id)
    src = plugin_root(plugin_type, plugin_id)
    validate_package(src, manifest)
    dst = _resolve_install_destination(plugin_type, plugin_id, src, scope)
    _copy_package(src, dst)
    record = local.make_record(
        plugin_type=plugin_type,
        plugin_id=plugin_id,
        version=manifest.version,
        source=f"bundled:{manifest.source.path or ''}",
        install_path=dst,
        enabled=True,
        scope=scope,
    )
    local.save_installed_record(record)
    await _refresh_runtime(plugin_type)
    return record


async def update_plugin(plugin_type: PluginType, plugin_id: str, *, scope: str = "global") -> InstalledPluginRecord:
    return await install_plugin(plugin_type, plugin_id, scope=scope)


async def uninstall_plugin(plugin_type: PluginType, plugin_id: str) -> bool:
    record = local.get_record(plugin_type, plugin_id)
    install_path = Path(record.installPath) if record and record.installPath else local.infer_local_install(plugin_type, plugin_id)
    if install_path is None or not install_path.exists():
        local.remove_installed_record(plugin_type, plugin_id)
        return False
    project_root = local.install_root(plugin_type, "project").resolve()
    resolved_install_path = install_path.resolve()
    if resolved_install_path == project_root or project_root in resolved_install_path.parents:
        raise ValueError("Built-in project Hub plugins cannot be removed")
    if ".flocks/plugins" not in install_path.as_posix():
        raise ValueError("Only user-managed Hub plugin installs can be removed")
    shutil.rmtree(install_path)
    local.remove_installed_record(plugin_type, plugin_id)
    await _refresh_runtime(plugin_type)
    return True
