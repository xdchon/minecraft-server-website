import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

import logging
import threading
import time
from .cloudflare_dns import CloudflareDNS


from docker.errors import DockerException

from ..config import settings
from ..docker_client import get_docker_client
from ..models import (
    CommandRequest,
    CommandResponse,
    ServerActionResponse,
    ServerCreateRequest,
    ServerCreateResponse,
    ServerInfo,
    ServerSettings,
    ServerSettingsResponse,
    WhitelistActionRequest,
    WhitelistResponse,
    ModInstallRequest,
    ModInstallResponse,
    ModListResponse,
    ModpackInstallRequest,
    ModpackInstallResponse,
    ModConfigFileInfo,
    ModConfigFileResponse,
    ModConfigListResponse,
    ModConfigUpdateRequest,
)
from .branding_service import BrandingError, branding_paths, ensure_branding_assets
from .modrinth_service import ModrinthError, ModrinthService


class ServiceError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


PROPERTY_MAP = {
    "motd": "motd",
    "max_players": "max-players",
    "difficulty": "difficulty",
    "gamemode": "gamemode",
    "view_distance": "view-distance",
    "simulation_distance": "simulation-distance",
    "online_mode": "online-mode",
    "whitelist": "white-list",
    "pvp": "pvp",
    "hardcore": "hardcore",
    "allow_nether": "allow-nether",
    "allow_end": "allow-end",
    "allow_flight": "allow-flight",
    "spawn_protection": "spawn-protection",
    "level_seed": "level-seed",
    "level_type": "level-type",
    "spawn_animals": "spawn-animals",
    "spawn_monsters": "spawn-monsters",
    "spawn_npcs": "spawn-npcs",
    "op_permission_level": "op-permission-level",
    "player_idle_timeout": "player-idle-timeout",
    "max_tick_time": "max-tick-time",
    "entity_broadcast_range_percentage": "entity-broadcast-range-percentage",
    "server_port": "server-port",
    "server_ip": "server-ip",
    "broadcast_console_to_ops": "broadcast-console-to-ops",
    "broadcast_rcon_to_ops": "broadcast-rcon-to-ops",
    "enable_query": "enable-query",
    "query_port": "query.port",
    "resource_pack": "resource-pack",
    "resource_pack_sha1": "resource-pack-sha1",
    "enable_command_block": "enable-command-block",
}

BOOL_FIELDS = {
    "online_mode",
    "whitelist",
    "pvp",
    "allow_flight",
    "enable_command_block",
    "hardcore",
    "allow_nether",
    "allow_end",
    "spawn_animals",
    "spawn_monsters",
    "spawn_npcs",
    "broadcast_console_to_ops",
    "broadcast_rcon_to_ops",
    "enable_query",
}
INT_FIELDS = {
    "max_players",
    "view_distance",
    "simulation_distance",
    "spawn_protection",
    "op_permission_level",
    "player_idle_timeout",
    "max_tick_time",
    "entity_broadcast_range_percentage",
    "server_port",
    "query_port",
}

MOD_CONFIG_EXTENSIONS = {
    ".cfg",
    ".conf",
    ".json",
    ".json5",
    ".properties",
    ".toml",
    ".txt",
    ".yaml",
    ".yml",
}
MOD_CONFIG_MAX_BYTES = 512 * 1024



class MinecraftService:
    def __init__(self, modrinth: Optional[ModrinthService] = None) -> None:
        self.modrinth = modrinth or ModrinthService()
        self.log = logging.getLogger("mc-manager")

        self.dns = None
        self._dns_thread_started = False
        if settings.auto_dns_enabled:
            try:
                self.dns = CloudflareDNS(
                    api_token=settings.cf_api_token,
                    zone_id=settings.cf_zone_id,
                    zone_name=settings.cf_zone_name,
                )
            except Exception as exc:
                self.log.warning(
                    "AUTO_DNS_ENABLED is true but Cloudflare DNS is misconfigured (%s); continuing without DNS automation.",
                    exc,
                )
                self.dns = None
    def _sanitize_name(self, name: str) -> str:
        cleaned = re.sub(r"[^a-zA-Z0-9-]+", "-", name).strip("-").lower()
        return cleaned or "server"
    def _server_fqdn(self, dns_name: str) -> str:
        return f"{dns_name}.{settings.mc_parent_domain}".strip(".")

    def _provision_dns_for(self, dns_name: str, port: int) -> None:
        if not self.dns:
            return
        fqdn = self._server_fqdn(dns_name)
        result = self.dns.upsert_minecraft_srv(fqdn, port)
        self.log.info("DNS SRV %s: %s -> %s", result, fqdn, port)

    def _remove_dns_for(self, dns_name: str) -> None:
        if not self.dns:
            return
        fqdn = self._server_fqdn(dns_name)
        deleted = self.dns.delete_minecraft_srv(fqdn)
        self.log.info("DNS SRV deleted=%s for %s", deleted, fqdn)

    def reconcile_dns_once(self) -> None:
        """
        Self-heal: for all managed containers, ensure SRV points at the right port.
        """
        if not self.dns:
            return
        try:
            docker_client = get_docker_client()
            containers = docker_client.containers.list(
                all=True,
                filters={"label": f"{settings.managed_label}={settings.managed_label_value}"},
            )
        except DockerException as exc:
            self.log.warning("DNS reconcile skipped: Docker unavailable: %s", exc)
            return

        for c in containers:
            labels = c.labels or {}
            dns_name = labels.get("mc.dns_name") or self._sanitize_name(labels.get("mc.server_name", c.name))

            # Extract current host port
            ports = c.attrs.get("NetworkSettings", {}).get("Ports") or {}
            host_port = None
            for bindings in ports.values():
                if bindings and bindings[0].get("HostPort", "").isdigit():
                    host_port = int(bindings[0]["HostPort"])
                    break
            if host_port is None:
                continue

            try:
                self._provision_dns_for(dns_name, host_port)
            except Exception as exc:
                self.log.warning("DNS reconcile failed for %s:%s (%s)", dns_name, host_port, exc)

    def start_dns_reconciler(self) -> None:
        if not self.dns or self._dns_thread_started:
            return
        self._dns_thread_started = True

        def loop() -> None:
            while True:
                try:
                    self.reconcile_dns_once()
                except Exception as exc:
                    self.log.warning("DNS reconcile loop error: %s", exc)
                time.sleep(settings.dns_reconcile_interval_seconds)

        t = threading.Thread(target=loop, daemon=True, name="dns-reconciler")
        t.start()
        self.log.info("DNS reconciler started (interval=%ss)", settings.dns_reconcile_interval_seconds)

    def list_servers(self) -> list[ServerInfo]:
        try:
            docker_client = get_docker_client()
            containers = docker_client.containers.list(
                all=True,
                filters={"label": f"{settings.managed_label}={settings.managed_label_value}"},
            )
        except DockerException as exc:
            raise ServiceError(503, f"Docker unavailable: {exc}") from exc
        return [self._container_to_info(container) for container in containers]

    def create_server(self, request: ServerCreateRequest) -> ServerCreateResponse:
        enable_rcon, rcon_password = self._resolve_rcon(request)

        server_id = uuid.uuid4().hex
        display_name = request.name.strip()
        if not display_name:
            raise ServiceError(400, "name cannot be blank")
        safe_name = self._sanitize_name(display_name)
        memory_mb = request.memory_mb or settings.default_memory_mb

        self._ensure_data_root()
        local_dir = self._server_dir(settings.data_root, server_id)
        host_dir = self._server_dir(settings.host_data_root, server_id)

        try:
            os.makedirs(local_dir, exist_ok=False)
            self._enforce_open_access(local_dir)
            self._apply_branding_icon(local_dir)
        except FileExistsError as exc:
            raise ServiceError(409, "Server data directory already exists") from exc
        except OSError as exc:
            raise ServiceError(500, f"Failed to create server directory: {exc}") from exc

        container = None
        try:
            if request.port is not None:
                raise ServiceError(400, "Server port is assigned automatically")
            port = self._select_port(None)
            labels = self._labels(
                server_id,
                display_name,
                host_dir,
                local_dir,
                enable_rcon,
                memory_mb,
                request.version,
                request.server_type.upper() if request.server_type else None,
            )
            dns_name = safe_name
            labels["mc.dns_name"] = dns_name
            env = self._build_env(request, memory_mb, enable_rcon, rcon_password, port)
            docker_client = get_docker_client()
            container = docker_client.containers.run(
                settings.minecraft_image,
                name=f"mc_{safe_name}_{server_id[:6]}",
                detach=True,
                ports={f"{port}/tcp": port},
                volumes={host_dir: {"bind": "/data", "mode": "rw"}},
                environment=env,
                labels=labels,
                mem_limit=f"{memory_mb}m",
            )
            container.reload()

            # Auto-provision SRV DNS so players can join by hostname immediately
            try:
                self._provision_dns_for(dns_name, port)
            except Exception as exc:
                # Don’t require manual action: reconciler will retry automatically
                self.log.warning(
                    "DNS provision failed for %s:%s (%s). Will retry.", dns_name, port, exc
                )
        except DockerException as exc:
            if container is not None:
                try:
                    container.remove(force=True)
                except DockerException:
                    pass
            shutil.rmtree(local_dir, ignore_errors=True)
            raise ServiceError(500, f"Failed to create server: {exc}") from exc

        server_info = self._container_to_info(container)
        return ServerCreateResponse(message="server created", server=server_info)

    def start_server(self, server_id: str) -> ServerActionResponse:
        container = self._get_container_by_server_id(server_id)
        container = self._ensure_autopause_env(container, server_id)
        local_dir = self._get_local_dir(container, server_id)
        self._validate_local_dir(local_dir)
        self._require_local_dir_exists(local_dir)
        self._assert_data_mount_matches(container, server_id)
        self._enforce_open_access(local_dir)
        self._apply_branding_icon(local_dir)
        try:
            container.start()
        except DockerException as exc:
            raise ServiceError(500, f"Failed to start server: {exc}") from exc
        return ServerActionResponse(server_id=server_id, status="started")

    def stop_server(self, server_id: str) -> ServerActionResponse:
        container = self._get_container_by_server_id(server_id)
        try:
            container.stop()
        except DockerException as exc:
            raise ServiceError(500, f"Failed to stop server: {exc}") from exc
        return ServerActionResponse(server_id=server_id, status="stopped")

    def restart_server(self, server_id: str) -> ServerActionResponse:
        container = self._get_container_by_server_id(server_id)
        container = self._ensure_autopause_env(container, server_id)
        local_dir = self._get_local_dir(container, server_id)
        self._validate_local_dir(local_dir)
        self._require_local_dir_exists(local_dir)
        self._assert_data_mount_matches(container, server_id)
        self._enforce_open_access(local_dir)
        self._apply_branding_icon(local_dir)
        try:
            container.restart()
        except DockerException as exc:
            raise ServiceError(500, f"Failed to restart server: {exc}") from exc
        return ServerActionResponse(server_id=server_id, status="restarted")

    def delete_server(self, server_id: str, retain_data: bool) -> ServerActionResponse:
        container = self._get_container_by_server_id(server_id)
        labels = container.labels or {}
        dns_name = labels.get("mc.dns_name") or self._sanitize_name(
            labels.get("mc.server_name", container.name)
        )
        try:
            self._remove_dns_for(dns_name)
        except Exception as exc:
            self.log.warning("DNS delete failed for %s (%s).", dns_name, exc)

        local_dir = self._get_local_dir(container, server_id)
        try:
            container.remove(force=True)
        except DockerException as exc:
            raise ServiceError(500, f"Failed to delete server: {exc}") from exc

        if not retain_data:
            self._validate_local_dir(local_dir)
            self._safe_remove_dir(local_dir)

        return ServerActionResponse(server_id=server_id, status="deleted")

    def get_logs(
        self, server_id: str, follow: bool, tail: Optional[int]
    ) -> Iterable[bytes] | bytes:
        container = self._get_container_by_server_id(server_id)
        try:
            kwargs = {"stream": follow, "follow": follow}
            if tail is not None:
                kwargs["tail"] = tail
            return container.logs(**kwargs)
        except DockerException as exc:
            raise ServiceError(500, f"Failed to fetch logs: {exc}") from exc

    def send_command(self, server_id: str, request: CommandRequest) -> CommandResponse:
        container = self._get_container_by_server_id(server_id)
        container.reload()
        if container.status != "running":
            raise ServiceError(409, "Server must be running to accept commands")
        if not self._is_rcon_enabled(container):
            raise ServiceError(409, "RCON is disabled for this server")
        try:
            result = container.exec_run(["rcon-cli", request.command], stdout=True, stderr=True)
        except DockerException as exc:
            raise ServiceError(500, f"Failed to send command: {exc}") from exc

        output = result.output.decode("utf-8", errors="replace") if result.output else ""
        if result.exit_code != 0:
            raise ServiceError(500, f"Command failed: {output.strip()}")
        return CommandResponse(server_id=server_id, exit_code=result.exit_code, output=output)

    def get_settings(self, server_id: str) -> ServerSettingsResponse:
        container = self._get_container_by_server_id(server_id)
        local_dir = self._get_local_dir(container, server_id)
        self._validate_local_dir(local_dir)
        self._require_local_dir_exists(local_dir)
        self._assert_data_mount_matches(container, server_id)
        properties = self._read_server_properties(local_dir)
        settings_payload = self._properties_to_settings(properties)
        return ServerSettingsResponse(server_id=server_id, settings=settings_payload)

    def update_settings(
        self, server_id: str, request: ServerSettings, restart: bool
    ) -> ServerSettingsResponse:
        container = self._get_container_by_server_id(server_id)
        local_dir = self._get_local_dir(container, server_id)
        self._validate_local_dir(local_dir)
        self._require_local_dir_exists(local_dir)
        self._assert_data_mount_matches(container, server_id)

        if request.server_port is not None:
            raise ServiceError(400, "Server port is managed automatically")
        if request.server_ip is not None:
            raise ServiceError(400, "Server IP cannot be set")
        if request.enable_query is not None or request.query_port is not None:
            raise ServiceError(400, "Query settings are not configurable")

        updates = self._settings_to_properties(request)
        updates["white-list"] = "false"
        updates["enforce-whitelist"] = "false"
        if not updates:
            raise ServiceError(400, "No settings provided")

        try:
            self._write_server_properties(local_dir, updates)
        except OSError as exc:
            raise ServiceError(500, f"Failed to update server settings: {exc}") from exc

        if restart:
            try:
                container.restart()
            except DockerException as exc:
                raise ServiceError(500, f"Failed to restart server: {exc}") from exc

        return self.get_settings(server_id)

    def get_whitelist(self, server_id: str) -> WhitelistResponse:
        container = self._get_container_by_server_id(server_id)
        local_dir = self._get_local_dir(container, server_id)
        self._validate_local_dir(local_dir)
        self._require_local_dir_exists(local_dir)
        self._assert_data_mount_matches(container, server_id)
        path = os.path.join(local_dir, "whitelist.json")
        names: list[str] = []
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
                if isinstance(data, list):
                    for entry in data:
                        if isinstance(entry, dict) and "name" in entry:
                            names.append(str(entry["name"]))
            except (OSError, json.JSONDecodeError) as exc:
                raise ServiceError(500, f"Failed to read whitelist: {exc}") from exc
        return WhitelistResponse(server_id=server_id, names=sorted(set(names)))

    def update_whitelist(
        self, server_id: str, request: WhitelistActionRequest
    ) -> WhitelistResponse:
        action = request.action.lower().strip()
        if action not in {"add", "remove"}:
            raise ServiceError(400, "Invalid whitelist action")

        container = self._get_container_by_server_id(server_id)
        container.reload()
        if container.status != "running":
            raise ServiceError(409, "Server must be running to change whitelist")
        if not self._is_rcon_enabled(container):
            raise ServiceError(409, "RCON must be enabled to manage whitelist")

        command = f"whitelist {action} {request.name}"
        self._exec_rcon(container, command)
        self._exec_rcon(container, "whitelist reload")
        return self.get_whitelist(server_id)

    def list_mods(self, server_id: str) -> ModListResponse:
        container = self._get_container_by_server_id(server_id)
        local_dir = self._get_local_dir(container, server_id)
        self._validate_local_dir(local_dir)
        self._require_local_dir_exists(local_dir)
        self._assert_data_mount_matches(container, server_id)
        mods_dir = os.path.join(local_dir, "mods")
        if not os.path.exists(mods_dir):
            return ModListResponse(server_id=server_id, mods=[])
        mods = [
            name
            for name in os.listdir(mods_dir)
            if name.lower().endswith(".jar") and os.path.isfile(os.path.join(mods_dir, name))
        ]
        return ModListResponse(server_id=server_id, mods=sorted(mods))

    def install_mod(
        self, server_id: str, request: ModInstallRequest, restart: bool
    ) -> ModInstallResponse:
        container = self._get_container_by_server_id(server_id)
        local_dir = self._get_local_dir(container, server_id)
        self._validate_local_dir(local_dir)
        self._require_local_dir_exists(local_dir)
        self._assert_data_mount_matches(container, server_id)
        self._ensure_modded(container)

        try:
            version_data = self._resolve_mod_version(request)
            versions = [version_data] + self._collect_required_dependencies(
                version_data,
                loader=request.loader,
                game_version=request.game_version,
                visited_version_ids=set(),
                visited_project_ids={request.project_id},
            )
        except ModrinthError as exc:
            raise ServiceError(exc.status_code, exc.message) from exc

        mods_dir = os.path.join(local_dir, "mods")
        os.makedirs(mods_dir, exist_ok=True)
        main_filename: str | None = None
        for idx, entry in enumerate(versions):
            file_info = self._select_mod_file(entry)
            filename = file_info.get("filename")
            url = file_info.get("url")
            if not filename or not url:
                raise ServiceError(500, "Modrinth version is missing a file URL")
            if idx == 0:
                main_filename = filename
            if not filename.lower().endswith(".jar"):
                raise ServiceError(400, f"Unsupported mod file type: {filename}")

            dest_path = os.path.join(mods_dir, filename)
            if os.path.exists(dest_path):
                continue

            try:
                self._download_file(url, dest_path)
            except ModrinthError as exc:
                raise ServiceError(exc.status_code, exc.message) from exc
            except OSError as exc:
                raise ServiceError(500, f"Failed to save mod file: {exc}") from exc

        if not main_filename:
            raise ServiceError(500, "Unable to determine mod filename")

        if restart:
            try:
                container.restart()
            except DockerException as exc:
                raise ServiceError(500, f"Failed to restart server: {exc}") from exc

        return ModInstallResponse(server_id=server_id, filename=main_filename)

    def install_modpack(
        self,
        server_id: str,
        request: ModpackInstallRequest,
        restart: bool,
    ) -> ModpackInstallResponse:
        container = self._get_container_by_server_id(server_id)
        local_dir = self._get_local_dir(container, server_id)
        self._validate_local_dir(local_dir)
        self._require_local_dir_exists(local_dir)
        self._assert_data_mount_matches(container, server_id)
        self._ensure_modded(container)

        try:
            version_data = self._resolve_modpack_version(request)
        except ModrinthError as exc:
            raise ServiceError(exc.status_code, exc.message) from exc

        file_info = self._select_modpack_file(version_data)
        filename = file_info.get("filename")
        url = file_info.get("url")
        if not filename or not url:
            raise ServiceError(500, "Modrinth modpack version is missing a file URL")
        if not filename.lower().endswith(".mrpack"):
            raise ServiceError(400, f"Unsupported modpack file type: {filename}")

        import tempfile
        import zipfile

        installed_files = 0
        skipped_files = 0
        overrides_applied = 0
        modpack_name = request.project_id
        resolved_version_id = version_data.get("id") or request.version_id or ""

        try:
            with tempfile.TemporaryDirectory(prefix="temptcraft-modpack-") as tmpdir:
                mrpack_path = os.path.join(tmpdir, filename)
                try:
                    self._download_file(url, mrpack_path)
                except ModrinthError:
                    raise
                except OSError as exc:
                    raise ServiceError(500, f"Failed to save modpack file: {exc}") from exc

                with zipfile.ZipFile(mrpack_path, "r") as archive:
                    index = self._read_modpack_index(archive)
                    modpack_name = str(index.get("name") or modpack_name)
                    self._assert_modpack_compatible(container, index)
                    installed_files, skipped_files = self._install_modpack_files(
                        local_dir,
                        index.get("files") or [],
                        overwrite=bool(request.overwrite),
                    )
                    overrides_applied = self._extract_modpack_overrides(
                        local_dir, archive, overwrite=bool(request.overwrite)
                    )
        except zipfile.BadZipFile as exc:
            raise ServiceError(400, f"Modpack archive is invalid: {exc}") from exc
        except ModrinthError as exc:
            raise ServiceError(exc.status_code, exc.message) from exc

        if restart:
            try:
                container.restart()
            except DockerException as exc:
                raise ServiceError(500, f"Failed to restart server: {exc}") from exc

        return ModpackInstallResponse(
            server_id=server_id,
            project_id=request.project_id,
            version_id=str(resolved_version_id),
            modpack_name=modpack_name,
            installed_files=installed_files,
            skipped_files=skipped_files,
            overrides_applied=overrides_applied,
        )

    def remove_mod(
        self, server_id: str, filename: str, restart: bool
    ) -> ModListResponse:
        container = self._get_container_by_server_id(server_id)
        local_dir = self._get_local_dir(container, server_id)
        self._validate_local_dir(local_dir)
        self._require_local_dir_exists(local_dir)
        self._assert_data_mount_matches(container, server_id)
        self._ensure_modded(container)

        safe_name = os.path.basename(filename)
        if safe_name != filename or not safe_name.lower().endswith(".jar"):
            raise ServiceError(400, "Invalid mod filename")

        mods_dir = os.path.join(local_dir, "mods")
        target = os.path.join(mods_dir, safe_name)
        if not os.path.exists(target):
            raise ServiceError(404, "Mod not found")
        try:
            os.remove(target)
        except OSError as exc:
            raise ServiceError(500, f"Failed to remove mod: {exc}") from exc

        if restart:
            try:
                container.restart()
            except DockerException as exc:
                raise ServiceError(500, f"Failed to restart server: {exc}") from exc

        return self.list_mods(server_id)

    def list_mod_config_files(self, server_id: str) -> ModConfigListResponse:
        container = self._get_container_by_server_id(server_id)
        local_dir = self._get_local_dir(container, server_id)
        self._validate_local_dir(local_dir)
        self._require_local_dir_exists(local_dir)
        self._assert_data_mount_matches(container, server_id)
        self._ensure_modded(container)

        config_dir = os.path.join(local_dir, "config")
        if not os.path.isdir(config_dir):
            return ModConfigListResponse(server_id=server_id, files=[])

        root_real = os.path.realpath(config_dir)
        files: list[ModConfigFileInfo] = []
        for dirpath, dirnames, filenames in os.walk(config_dir):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for name in filenames:
                if name.startswith("."):
                    continue
                ext = os.path.splitext(name)[1].lower()
                if ext not in MOD_CONFIG_EXTENSIONS:
                    continue
                full_path = os.path.join(dirpath, name)
                if not os.path.isfile(full_path):
                    continue
                full_real = os.path.realpath(full_path)
                if not full_real.startswith(root_real + os.sep):
                    continue
                try:
                    stat = os.stat(full_real)
                except OSError:
                    continue
                rel_path = os.path.relpath(full_real, root_real).replace(os.sep, "/")
                modified_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
                files.append(
                    ModConfigFileInfo(
                        path=rel_path,
                        size_bytes=int(stat.st_size),
                        modified_at=modified_at,
                    )
                )

        files.sort(key=lambda item: item.path.lower())
        return ModConfigListResponse(server_id=server_id, files=files)

    def get_mod_config_file(self, server_id: str, file_path: str) -> ModConfigFileResponse:
        container = self._get_container_by_server_id(server_id)
        local_dir = self._get_local_dir(container, server_id)
        self._validate_local_dir(local_dir)
        self._require_local_dir_exists(local_dir)
        self._assert_data_mount_matches(container, server_id)
        self._ensure_modded(container)

        config_dir = os.path.join(local_dir, "config")
        if not os.path.isdir(config_dir):
            raise ServiceError(409, "Config folder not found. Start the server once to generate configs.")
        full_path = self._resolve_mod_config_path(config_dir, file_path)
        if not os.path.isfile(full_path):
            raise ServiceError(404, "Config file not found")

        try:
            size = os.path.getsize(full_path)
        except OSError as exc:
            raise ServiceError(500, f"Failed to read config file: {exc}") from exc
        if size > MOD_CONFIG_MAX_BYTES:
            raise ServiceError(413, f"Config file too large to edit (>{MOD_CONFIG_MAX_BYTES} bytes)")

        try:
            with open(full_path, "rb") as handle:
                data = handle.read()
        except OSError as exc:
            raise ServiceError(500, f"Failed to read config file: {exc}") from exc

        if b"\x00" in data:
            raise ServiceError(400, "Config file appears to be binary")
        content = data.decode("utf-8", errors="replace")
        rel_path = os.path.relpath(os.path.realpath(full_path), os.path.realpath(config_dir)).replace(os.sep, "/")
        return ModConfigFileResponse(server_id=server_id, path=rel_path, content=content)

    def update_mod_config_file(
        self,
        server_id: str,
        file_path: str,
        request: ModConfigUpdateRequest,
        restart: bool,
    ) -> ModConfigFileResponse:
        container = self._get_container_by_server_id(server_id)
        local_dir = self._get_local_dir(container, server_id)
        self._validate_local_dir(local_dir)
        self._require_local_dir_exists(local_dir)
        self._assert_data_mount_matches(container, server_id)
        self._ensure_modded(container)

        config_dir = os.path.join(local_dir, "config")
        if not os.path.isdir(config_dir):
            raise ServiceError(409, "Config folder not found. Start the server once to generate configs.")
        full_path = self._resolve_mod_config_path(config_dir, file_path)
        if not os.path.isfile(full_path):
            raise ServiceError(404, "Config file not found")

        content = request.content or ""
        encoded = content.encode("utf-8")
        if len(encoded) > MOD_CONFIG_MAX_BYTES:
            raise ServiceError(413, f"Config content too large (>{MOD_CONFIG_MAX_BYTES} bytes)")

        try:
            with open(full_path, "w", encoding="utf-8") as handle:
                handle.write(content)
        except OSError as exc:
            raise ServiceError(500, f"Failed to save config file: {exc}") from exc

        if restart:
            try:
                container.restart()
            except DockerException as exc:
                raise ServiceError(500, f"Failed to restart server: {exc}") from exc

        return self.get_mod_config_file(server_id, file_path)

    def _ensure_data_root(self) -> None:
        try:
            os.makedirs(settings.data_root, exist_ok=True)
        except OSError as exc:
            raise ServiceError(500, f"Failed to create data root: {exc}") from exc

    def _server_dir(self, root: str, server_id: str) -> str:
        return os.path.join(root, server_id)

    def _safe_remove_dir(self, path: str) -> None:
        root = os.path.realpath(settings.data_root)
        target = os.path.realpath(path)
        if target == root or not target.startswith(root + os.sep):
            raise ServiceError(400, "Refusing to delete path outside data root")
        if not os.path.exists(target):
            return
        try:
            shutil.rmtree(target)
        except OSError as exc:
            raise ServiceError(500, f"Failed to delete server data: {exc}") from exc

    def _sanitize_name(self, name: str) -> str:
        cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", name).strip("-_").lower()
        return cleaned or "server"

    def _labels(
        self,
        server_id: str,
        name: str,
        host_dir: str,
        local_dir: str,
        enable_rcon: bool,
        memory_mb: int,
        version: Optional[str],
        server_type: Optional[str],
    ) -> Dict[str, str]:
        modded = self._is_modded(server_type)
        return {
            settings.managed_label: settings.managed_label_value,
            "mc.server_id": server_id,
            "mc.server_name": name,
            "mc.server_dir": host_dir,
            "mc.server_dir_local": local_dir,
            "mc.rcon_enabled": "true" if enable_rcon else "false",
            "mc.memory_mb": str(memory_mb),
            "mc.version": version or "",
            "mc.server_type": server_type or "",
            "mc.modded": "true" if modded else "false",
        }

    def _select_port(self, requested: Optional[int]) -> int:
        used_ports = self._get_used_ports()
        if requested is not None:
            if requested in used_ports:
                raise ServiceError(409, f"Port {requested} is already in use")
            return requested

        start = settings.port_range_start
        end = settings.port_range_end
        if start < 1 or end > 65535:
            raise ServiceError(500, "Configured port range is out of bounds")
        if end < start:
            raise ServiceError(500, "Invalid port range configuration")
        for port in range(start, end + 1):
            if port not in used_ports:
                return port
        raise ServiceError(409, "No available ports in the configured range")

    def _get_used_ports(self) -> set[int]:
        used: set[int] = set()
        try:
            docker_client = get_docker_client()
            containers = docker_client.containers.list(all=True)
        except DockerException as exc:
            raise ServiceError(503, f"Docker unavailable: {exc}") from exc

        for container in containers:
            ports = container.attrs.get("NetworkSettings", {}).get("Ports") or {}
            for bindings in ports.values():
                if not bindings:
                    continue
                for binding in bindings:
                    host_port = binding.get("HostPort")
                    if host_port and host_port.isdigit():
                        used.add(int(host_port))
        return used

    def _build_env(
        self,
        request: ServerCreateRequest,
        memory_mb: int,
        enable_rcon: bool,
        rcon_password: Optional[str],
        server_port: int,
    ) -> Dict[str, str]:
        env = dict(request.env)
        env["EULA"] = "TRUE" if request.eula else "FALSE"
        env.pop("SERVER_IP", None)
        env.pop("ENABLE_QUERY", None)
        env.pop("QUERY_PORT", None)
        if request.version:
            env["VERSION"] = request.version
        if request.server_type:
            env["TYPE"] = request.server_type.upper()
        env["MEMORY"] = f"{memory_mb}M"
        env["SERVER_PORT"] = str(server_port)
        env["WHITELIST"] = "FALSE"
        env["ENFORCE_WHITELIST"] = "FALSE"
        if settings.autopause_enabled:
            env["ENABLE_AUTOPAUSE"] = "TRUE"
            env["AUTOPAUSE_TIMEOUT_EST"] = str(settings.autopause_timeout_seconds)
            env["AUTOPAUSE_TIMEOUT_INIT"] = str(settings.autopause_timeout_seconds)
            env["AUTOPAUSE_PERIOD"] = str(settings.autopause_period_seconds)
        else:
            env["ENABLE_AUTOPAUSE"] = "FALSE"
        if enable_rcon:
            env["ENABLE_RCON"] = "TRUE"
            env["RCON_PASSWORD"] = rcon_password or ""
        return env

    def _enforce_open_access(self, local_dir: str) -> None:
        try:
            self._write_server_properties(
                local_dir,
                {"white-list": "false", "enforce-whitelist": "false"},
            )
        except OSError as exc:
            raise ServiceError(500, f"Failed to enforce open access: {exc}") from exc

    def _apply_branding_icon(self, local_dir: str) -> None:
        try:
            ensure_branding_assets()
            icon_src = branding_paths().server_icon_path
        except BrandingError as exc:
            self.log.warning("Branding unavailable: %s", exc.message)
            return

        if not os.path.exists(icon_src):
            return
        dest = os.path.join(local_dir, "server-icon.png")
        try:
            shutil.copyfile(icon_src, dest)
        except OSError as exc:
            self.log.warning("Failed to write server icon: %s", exc)

    def apply_branding_to_all_servers(self) -> int:
        try:
            ensure_branding_assets()
            icon_src = branding_paths().server_icon_path
        except BrandingError as exc:
            raise ServiceError(exc.status_code, exc.message) from exc

        if not os.path.exists(icon_src):
            return 0

        try:
            docker_client = get_docker_client()
            containers = docker_client.containers.list(
                all=True,
                filters={"label": f"{settings.managed_label}={settings.managed_label_value}"},
            )
        except DockerException as exc:
            raise ServiceError(503, f"Docker unavailable: {exc}") from exc

        updated = 0
        for container in containers:
            labels = container.labels or {}
            server_id = labels.get("mc.server_id") or ""
            if not server_id:
                continue
            local_dir = self._get_local_dir(container, server_id)
            try:
                self._validate_local_dir(local_dir)
            except ServiceError:
                continue
            dest = os.path.join(local_dir, "server-icon.png")
            try:
                shutil.copyfile(icon_src, dest)
                updated += 1
            except OSError:
                continue

        return updated

    def _resolve_rcon(self, request: ServerCreateRequest) -> tuple[bool, Optional[str]]:
        if request.enable_rcon is None:
            enable_rcon = settings.default_enable_rcon
        else:
            enable_rcon = request.enable_rcon
        rcon_password = request.rcon_password or settings.default_rcon_password
        if enable_rcon and not rcon_password:
            rcon_password = uuid.uuid4().hex
        return enable_rcon, rcon_password

    def _is_rcon_enabled(self, container) -> bool:
        labels = container.labels or {}
        label_value = labels.get("mc.rcon_enabled")
        if label_value is not None:
            return label_value.lower() == "true"

        env_list = container.attrs.get("Config", {}).get("Env") or []
        env_map = {}
        for item in env_list:
            if "=" in item:
                key, value = item.split("=", 1)
                env_map[key] = value
        return env_map.get("ENABLE_RCON", "").upper() == "TRUE"

    def _is_modded(self, server_type: Optional[str]) -> bool:
        if not server_type:
            return False
        return server_type.upper() in {"FORGE", "FABRIC"}

    def _ensure_modded(self, container) -> None:
        labels = container.labels or {}
        modded_label = labels.get("mc.modded")
        if modded_label is not None:
            if modded_label.lower() == "true":
                return
        env_map = self._container_env_dict(container)
        server_type = env_map.get("TYPE")
        if server_type and self._is_modded(server_type):
            return
        raise ServiceError(409, "Mods require a Fabric or Forge server")

    def _get_container_by_server_id(self, server_id: str):
        try:
            docker_client = get_docker_client()
            containers = docker_client.containers.list(
                all=True,
                filters={
                    "label": [
                        f"{settings.managed_label}={settings.managed_label_value}",
                        f"mc.server_id={server_id}",
                    ]
                },
            )
        except DockerException as exc:
            raise ServiceError(503, f"Docker unavailable: {exc}") from exc
        if not containers:
            raise ServiceError(404, "Server not found")
        return containers[0]

    def _get_local_dir(self, container, server_id: str) -> str:
        expected = self._server_dir(settings.data_root, server_id)
        if os.path.isdir(expected):
            return expected

        labels = container.labels or {}
        local_dir = labels.get("mc.server_dir_local")
        if local_dir and self._is_within_data_root(local_dir) and os.path.isdir(local_dir):
            return local_dir

        return expected

    def _validate_local_dir(self, path: str) -> None:
        root = os.path.realpath(settings.data_root)
        target = os.path.realpath(path)
        if not target.startswith(root + os.sep):
            raise ServiceError(400, "Server data path is invalid")

    def _is_within_data_root(self, path: str) -> bool:
        root = os.path.realpath(settings.data_root)
        target = os.path.realpath(path)
        return target.startswith(root + os.sep)

    def _require_local_dir_exists(self, path: str) -> None:
        if os.path.isdir(path):
            return
        raise ServiceError(
            500,
            f"Server data directory is missing on this manager: {path}. "
            "Check DATA_ROOT/HOST_DATA_ROOT and your docker-compose bind mount, then restart the manager.",
        )

    def _assert_data_mount_matches(self, container, server_id: str) -> None:
        try:
            container.reload()
        except DockerException:
            return

        mounts = container.attrs.get("Mounts") or []
        source = None
        for mount in mounts:
            if mount.get("Destination") == "/data":
                source = mount.get("Source")
                break
        if not source:
            return

        expected = os.path.realpath(self._server_dir(settings.host_data_root, server_id))
        actual = os.path.realpath(str(source))
        if actual != expected:
            raise ServiceError(
                500,
                "Server volume mount mismatch. "
                f"Container has /data -> {actual}, but manager expects {expected}. "
                "Fix HOST_DATA_ROOT (and the bind mount used by the manager), then recreate the server container.",
            )

    def _resolve_mod_config_path(self, config_dir: str, file_path: str) -> str:
        raw = (file_path or "").strip().replace("\\", "/").lstrip("/")
        normalized = os.path.normpath(raw).replace("\\", "/")
        if normalized in {"", ".", ".."} or normalized.startswith("../"):
            raise ServiceError(400, "Invalid config file path")

        ext = os.path.splitext(normalized)[1].lower()
        if ext not in MOD_CONFIG_EXTENSIONS:
            raise ServiceError(400, "Unsupported config file type")

        root_real = os.path.realpath(config_dir)
        full_real = os.path.realpath(os.path.join(root_real, normalized))
        if not full_real.startswith(root_real + os.sep):
            raise ServiceError(400, "Invalid config file path")
        return full_real

    def _read_server_properties(self, local_dir: str) -> Dict[str, str]:
        path = os.path.join(local_dir, "server.properties")
        if not os.path.exists(path):
            return {}
        properties: Dict[str, str] = {}
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                key, value = stripped.split("=", 1)
                properties[key.strip()] = value.strip()
        return properties

    def _write_server_properties(self, local_dir: str, updates: Dict[str, str]) -> None:
        path = os.path.join(local_dir, "server.properties")
        os.makedirs(local_dir, exist_ok=True)
        lines: list[str] = []
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                lines = handle.readlines()

        remaining = dict(updates)
        new_lines: list[str] = []
        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in line:
                new_lines.append(line)
                continue
            key, _ = line.split("=", 1)
            key = key.strip()
            if key in remaining:
                new_lines.append(f"{key}={remaining.pop(key)}\n")
            else:
                new_lines.append(line)

        for key, value in remaining.items():
            new_lines.append(f"{key}={value}\n")

        with open(path, "w", encoding="utf-8") as handle:
            handle.writelines(new_lines)

    def _properties_to_settings(self, properties: Dict[str, str]) -> ServerSettings:
        payload: Dict[str, object] = {}
        for field, prop_key in PROPERTY_MAP.items():
            if prop_key not in properties:
                continue
            value = properties[prop_key]
            if field in BOOL_FIELDS:
                payload[field] = value.lower() == "true"
            elif field in INT_FIELDS:
                try:
                    payload[field] = int(value)
                except ValueError:
                    pass
            else:
                payload[field] = value
        return ServerSettings(**payload)

    def _settings_to_properties(self, request: ServerSettings) -> Dict[str, str]:
        updates: Dict[str, str] = {}
        if hasattr(request, "model_dump"):
            payload = request.model_dump(exclude_none=True)
        else:
            payload = request.dict(exclude_none=True)
        for field, value in payload.items():
            prop_key = PROPERTY_MAP.get(field)
            if not prop_key:
                continue
            if field in BOOL_FIELDS:
                updates[prop_key] = "true" if value else "false"
            else:
                updates[prop_key] = str(value)
        return updates

    def _exec_rcon(self, container, command: str) -> None:
        try:
            result = container.exec_run(["rcon-cli", command], stdout=True, stderr=True)
        except DockerException as exc:
            raise ServiceError(500, f"RCON command failed: {exc}") from exc

        output = result.output.decode("utf-8", errors="replace") if result.output else ""
        if result.exit_code != 0:
            raise ServiceError(500, f"RCON command failed: {output.strip()}")

    def _resolve_modpack_version(self, request: ModpackInstallRequest) -> dict:
        if request.version_id:
            try:
                return self.modrinth.get_version(request.version_id)
            except ModrinthError:
                raise

        if not request.project_id:
            raise ServiceError(400, "project_id is required")
        try:
            versions = self.modrinth.get_versions(
                request.project_id, request.loader, request.game_version
            )
        except ModrinthError:
            raise
        if not versions:
            raise ServiceError(404, "No compatible versions found")
        return versions[0]

    def _resolve_mod_version(self, request: ModInstallRequest) -> dict:
        if request.version_id:
            try:
                return self.modrinth.get_version(request.version_id)
            except ModrinthError:
                raise

        if not request.project_id:
            raise ServiceError(400, "project_id is required")
        try:
            versions = self.modrinth.get_versions(
                request.project_id, request.loader, request.game_version
            )
        except ModrinthError:
            raise
        if not versions:
            raise ServiceError(404, "No compatible versions found")
        return versions[0]

    def _select_mod_file(self, version_data: dict) -> dict:
        files = version_data.get("files") or []
        if not files:
            raise ServiceError(500, "Modrinth version has no files")
        for file_info in files:
            if file_info.get("primary"):
                return file_info
        return files[0]

    def _select_modpack_file(self, version_data: dict) -> dict:
        files = version_data.get("files") or []
        if not files:
            raise ServiceError(500, "Modrinth version has no files")

        candidates: list[dict[str, Any]] = []
        for file_info in files:
            if isinstance(file_info, dict) and file_info.get("primary"):
                candidates.append(file_info)
        for file_info in files:
            if isinstance(file_info, dict) and file_info not in candidates:
                candidates.append(file_info)

        for file_info in candidates:
            filename = str(file_info.get("filename") or "")
            if filename.lower().endswith(".mrpack"):
                return file_info
        return candidates[0] if candidates else files[0]

    def _read_modpack_index(self, archive) -> dict[str, Any]:
        try:
            raw = archive.read("modrinth.index.json")
        except KeyError as exc:
            raise ServiceError(400, "Modpack is missing modrinth.index.json") from exc

        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise ServiceError(400, f"Modpack index is invalid: {exc}") from exc

        if not isinstance(data, dict):
            raise ServiceError(400, "Modpack index is invalid")

        game = str(data.get("game") or "").strip().lower()
        if game and game != "minecraft":
            raise ServiceError(400, f"Unsupported modpack game: {game}")

        format_version = data.get("formatVersion")
        if format_version is not None and format_version != 1:
            raise ServiceError(400, f"Unsupported modpack formatVersion: {format_version}")

        return data

    def _assert_modpack_compatible(self, container, index: dict[str, Any]) -> None:
        dependencies = index.get("dependencies")
        if not isinstance(dependencies, dict):
            dependencies = {}

        required_loader: str | None = None
        if "fabric-loader" in dependencies:
            required_loader = "FABRIC"
        if "forge" in dependencies:
            if required_loader and required_loader != "FORGE":
                raise ServiceError(409, "Modpack requires both Fabric and Forge (unsupported)")
            required_loader = "FORGE"
        if "quilt-loader" in dependencies:
            raise ServiceError(409, "Quilt modpacks are not supported (Fabric/Forge only)")
        if "neoforge" in dependencies:
            raise ServiceError(409, "NeoForge modpacks are not supported (Fabric/Forge only)")

        env_map = self._container_env_dict(container)
        labels = container.labels or {}
        server_type = (env_map.get("TYPE") or labels.get("mc.server_type") or "").strip().upper()
        if required_loader and server_type and server_type != required_loader:
            raise ServiceError(
                409, f"Modpack requires {required_loader.title()} but server is {server_type.title()}"
            )

        required_mc = dependencies.get("minecraft")
        if isinstance(required_mc, str) and required_mc.strip():
            required_mc = required_mc.strip()
            server_version = (env_map.get("VERSION") or labels.get("mc.version") or "").strip()
            if server_version and server_version.lower() != "latest" and server_version != required_mc:
                raise ServiceError(
                    409,
                    f"Modpack requires Minecraft {required_mc} but server is {server_version}",
                )

    def _resolve_modpack_target_path(self, local_dir: str, relative_path: str) -> str:
        raw = (relative_path or "").strip().replace("\\", "/").lstrip("/")
        normalized = os.path.normpath(raw).replace("\\", "/")
        if normalized in {"", ".", ".."} or normalized.startswith("../"):
            raise ServiceError(400, "Invalid modpack file path")

        base_real = os.path.realpath(local_dir)
        full_real = os.path.realpath(os.path.join(base_real, normalized))
        if not full_real.startswith(base_real + os.sep):
            raise ServiceError(400, "Invalid modpack file path")
        return full_real

    def _install_modpack_files(
        self,
        local_dir: str,
        files: Any,
        overwrite: bool,
    ) -> tuple[int, int]:
        if not isinstance(files, list):
            raise ServiceError(400, "Modpack index files list is invalid")

        import tempfile

        installed = 0
        skipped = 0
        for entry in files:
            if not isinstance(entry, dict):
                continue

            env = entry.get("env")
            if isinstance(env, dict):
                server_env = str(env.get("server") or "").lower()
                if server_env == "unsupported":
                    continue

            path = entry.get("path")
            if not isinstance(path, str) or not path.strip():
                raise ServiceError(400, "Modpack entry is missing a file path")

            downloads = entry.get("downloads") or []
            if not isinstance(downloads, list) or not downloads:
                raise ServiceError(500, f"Modpack entry is missing downloads for: {path}")
            url = next((d for d in downloads if isinstance(d, str) and d.strip()), None)
            if not url:
                raise ServiceError(500, f"Modpack entry is missing downloads for: {path}")

            dest_path = self._resolve_modpack_target_path(local_dir, path)
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)

            if os.path.exists(dest_path) and not overwrite:
                skipped += 1
                continue

            expected_hashes = entry.get("hashes")
            hashes = expected_hashes if isinstance(expected_hashes, dict) else {}

            tmp_handle = tempfile.NamedTemporaryFile(
                dir=os.path.dirname(dest_path),
                prefix=".tmp-modpack-",
                delete=False,
            )
            tmp_path = tmp_handle.name
            tmp_handle.close()

            try:
                self._download_file_verified(url, tmp_path, hashes=hashes)
                os.replace(tmp_path, dest_path)
            except OSError as exc:
                raise ServiceError(500, f"Failed to save modpack file {path}: {exc}") from exc
            finally:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass

            installed += 1

        return installed, skipped

    def _extract_modpack_overrides(
        self,
        local_dir: str,
        archive,
        overwrite: bool,
    ) -> int:
        overrides_prefix = "overrides/"
        applied = 0

        for info in archive.infolist():
            name = str(getattr(info, "filename", "") or "")
            if not name.startswith(overrides_prefix):
                continue

            rel = name[len(overrides_prefix) :]
            if not rel or rel.endswith("/"):
                continue

            dest_path = self._resolve_modpack_target_path(local_dir, rel)
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)

            if os.path.exists(dest_path) and not overwrite:
                continue

            try:
                with archive.open(info, "r") as src, open(dest_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)
            except OSError as exc:
                raise ServiceError(500, f"Failed to write modpack override {rel}: {exc}") from exc
            applied += 1

        return applied

    def _collect_required_dependencies(
        self,
        version_data: dict,
        loader: Optional[str],
        game_version: Optional[str],
        visited_version_ids: set[str],
        visited_project_ids: set[str],
    ) -> list[dict[str, Any]]:
        dependencies = version_data.get("dependencies") or []
        if not isinstance(dependencies, list):
            return []

        collected: list[dict[str, Any]] = []
        for dep in dependencies:
            if not isinstance(dep, dict):
                continue
            dep_type = str(dep.get("dependency_type") or "").lower()
            if dep_type != "required":
                continue

            dep_version_data: dict[str, Any] | None = None
            raw_version_id = dep.get("version_id")
            raw_project_id = dep.get("project_id")

            if isinstance(raw_version_id, str) and raw_version_id.strip():
                version_id = raw_version_id.strip()
                if version_id in visited_version_ids:
                    continue
                visited_version_ids.add(version_id)
                dep_version_data = self.modrinth.get_version(version_id)
            elif isinstance(raw_project_id, str) and raw_project_id.strip():
                project_id = raw_project_id.strip()
                if project_id in visited_project_ids:
                    continue
                visited_project_ids.add(project_id)
                versions = self.modrinth.get_versions(project_id, loader, game_version)
                if not versions:
                    raise ServiceError(
                        404, f"No compatible versions found for required dependency: {project_id}"
                    )
                dep_version_data = versions[0]
                resolved_version_id = dep_version_data.get("id")
                if isinstance(resolved_version_id, str) and resolved_version_id.strip():
                    visited_version_ids.add(resolved_version_id.strip())
            else:
                continue

            if not isinstance(dep_version_data, dict):
                continue
            collected.append(dep_version_data)
            collected.extend(
                self._collect_required_dependencies(
                    dep_version_data,
                    loader=loader,
                    game_version=game_version,
                    visited_version_ids=visited_version_ids,
                    visited_project_ids=visited_project_ids,
                )
            )

        return collected

    def _download_file(self, url: str, dest_path: str) -> None:
        import httpx

        try:
            with httpx.stream(
                "GET",
                url,
                headers={"User-Agent": "TemptCraft/1.0"},
                timeout=httpx.Timeout(30.0),
            ) as response:
                if response.status_code >= 400:
                    raise ModrinthError(
                        response.status_code,
                        f"Modrinth download failed: {response.text}",
                    )
                with open(dest_path, "wb") as handle:
                    for chunk in response.iter_bytes():
                        handle.write(chunk)
        except httpx.RequestError as exc:
            raise ModrinthError(502, f"Mod download failed: {exc}") from exc

    def _download_file_verified(self, url: str, dest_path: str, hashes: dict[str, Any]) -> None:
        import hashlib
        import httpx

        sha1_expected = hashes.get("sha1") if isinstance(hashes.get("sha1"), str) else None
        sha512_expected = hashes.get("sha512") if isinstance(hashes.get("sha512"), str) else None
        sha1 = hashlib.sha1() if sha1_expected else None
        sha512 = hashlib.sha512() if sha512_expected else None

        try:
            with httpx.stream(
                "GET",
                url,
                headers={"User-Agent": "TemptCraft/1.0"},
                timeout=httpx.Timeout(30.0),
            ) as response:
                if response.status_code >= 400:
                    raise ModrinthError(
                        response.status_code,
                        f"Modrinth download failed: {response.text}",
                    )
                with open(dest_path, "wb") as handle:
                    for chunk in response.iter_bytes():
                        handle.write(chunk)
                        if sha1:
                            sha1.update(chunk)
                        if sha512:
                            sha512.update(chunk)
        except httpx.RequestError as exc:
            raise ModrinthError(502, f"Mod download failed: {exc}") from exc

        if sha1_expected and sha1 and sha1.hexdigest().lower() != sha1_expected.lower():
            raise ServiceError(502, "Downloaded file sha1 hash does not match modpack index")
        if sha512_expected and sha512 and sha512.hexdigest().lower() != sha512_expected.lower():
            raise ServiceError(502, "Downloaded file sha512 hash does not match modpack index")

    def _recreate_container_for_port(self, container, server_id: str, new_port: int) -> None:
        current_container_port, current_host_port = self._get_primary_ports(container)
        if current_host_port == new_port:
            return

        used_ports = self._get_used_ports()
        if current_host_port in used_ports:
            used_ports.remove(current_host_port)
        if new_port in used_ports:
            raise ServiceError(409, f"Port {new_port} is already in use")

        labels = dict(container.labels or {})
        host_dir = labels.get("mc.server_dir") or self._server_dir(settings.host_data_root, server_id)
        if not host_dir:
            raise ServiceError(500, "Missing server data path for container recreation")

        env = self._container_env_dict(container)
        env["SERVER_PORT"] = str(new_port)

        memory_label = labels.get("mc.memory_mb")
        if memory_label and memory_label.isdigit():
            memory_mb = int(memory_label)
        else:
            memory_mb = settings.default_memory_mb

        image_tag = container.image.tags[0] if container.image.tags else container.image.id
        container_name = container.name

        try:
            if container.status == "running":
                container.stop()
            container.remove()
            docker_client = get_docker_client()
            docker_client.containers.run(
                image_tag,
                name=container_name,
                detach=True,
                ports={f"{new_port}/tcp": new_port},
                volumes={host_dir: {"bind": "/data", "mode": "rw"}},
                environment=env,
                labels=labels,
                mem_limit=f"{memory_mb}m",
            )
        except DockerException as exc:
            raise ServiceError(500, f"Failed to recreate container: {exc}") from exc

    def _ensure_autopause_env(self, container, server_id: str):
        if not settings.autopause_enabled:
            return container

        env = self._container_env_dict(container)
        desired = {
            "ENABLE_AUTOPAUSE": "TRUE",
            "AUTOPAUSE_TIMEOUT_EST": str(settings.autopause_timeout_seconds),
            "AUTOPAUSE_TIMEOUT_INIT": str(settings.autopause_timeout_seconds),
            "AUTOPAUSE_PERIOD": str(settings.autopause_period_seconds),
        }
        needs_update = any(env.get(key) != value for key, value in desired.items())
        if not needs_update:
            return container

        env.update(desired)
        started = (container.status or "").lower() == "running"
        self._recreate_container_with_env(container, server_id, env, start=started)
        return self._get_container_by_server_id(server_id)

    def _recreate_container_with_env(
        self,
        container,
        server_id: str,
        env: Dict[str, str],
        start: bool,
    ) -> None:
        container.reload()
        container_port, host_port = self._get_primary_ports(container)
        if host_port is None:
            raise ServiceError(500, "Unable to determine server port for container recreation")
        container_port = container_port or host_port

        labels = dict(container.labels or {})
        host_dir = labels.get("mc.server_dir") or self._server_dir(settings.host_data_root, server_id)
        if not host_dir:
            raise ServiceError(500, "Missing server data path for container recreation")

        memory_label = labels.get("mc.memory_mb")
        if memory_label and memory_label.isdigit():
            memory_mb = int(memory_label)
        else:
            memory_mb = settings.default_memory_mb

        image_tag = container.image.tags[0] if container.image.tags else container.image.id
        container_name = container.name

        try:
            if container.status == "running":
                container.stop()
            container.remove()
            docker_client = get_docker_client()
            new_container = docker_client.containers.create(
                image_tag,
                name=container_name,
                detach=True,
                ports={f"{container_port}/tcp": host_port},
                volumes={host_dir: {"bind": "/data", "mode": "rw"}},
                environment=env,
                labels=labels,
                mem_limit=f"{memory_mb}m",
            )
            if start:
                new_container.start()
        except DockerException as exc:
            raise ServiceError(500, f"Failed to recreate container: {exc}") from exc

    def _get_primary_ports(self, container) -> tuple[Optional[int], Optional[int]]:
        ports = container.attrs.get("NetworkSettings", {}).get("Ports") or {}
        for container_port, bindings in ports.items():
            if not bindings:
                continue
            host_port_value = bindings[0].get("HostPort")
            if host_port_value and host_port_value.isdigit():
                container_port_num = container_port.split("/")[0]
                if container_port_num.isdigit():
                    return int(container_port_num), int(host_port_value)
                return None, int(host_port_value)
        return None, None

    def _container_env_dict(self, container) -> Dict[str, str]:
        env_list = container.attrs.get("Config", {}).get("Env") or []
        env_map: Dict[str, str] = {}
        for item in env_list:
            if "=" in item:
                key, value = item.split("=", 1)
                env_map[key] = value
        return env_map

    def _container_to_info(self, container) -> ServerInfo:
        labels = container.labels or {}
        ports = container.attrs.get("NetworkSettings", {}).get("Ports") or {}
        host_port = None
        for bindings in ports.values():
            if not bindings:
                continue
            host_port_value = bindings[0].get("HostPort")
            if host_port_value and host_port_value.isdigit():
                host_port = int(host_port_value)
                break

        image_tags = container.image.tags or []
        image_tag = image_tags[0] if image_tags else None

        version = labels.get("mc.version") or None
        server_type = labels.get("mc.server_type") or None
        modded_label = labels.get("mc.modded")
        if modded_label is None:
            modded = self._is_modded(server_type)
        else:
            modded = modded_label.lower() == "true"
        memory_label = labels.get("mc.memory_mb")
        memory_mb = int(memory_label) if memory_label and memory_label.isdigit() else None

        return ServerInfo(
            server_id=labels.get("mc.server_id", ""),
            name=labels.get("mc.server_name", container.name),
            status=container.status,
            image=image_tag,
            port=host_port,
            container_id=container.id,
            version=version,
            server_type=server_type,
            modded=modded,
            memory_mb=memory_mb,
        )
