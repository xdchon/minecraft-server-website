import time
from typing import Any

import httpx


class MetadataService:
    def __init__(self, cache_ttl_seconds: int = 6 * 60 * 60) -> None:
        self._cache_ttl_seconds = cache_ttl_seconds
        self._cache: dict[str, tuple[float, Any]] = {}
        self._timeout = httpx.Timeout(20.0)

    def minecraft_release_versions(self) -> list[str]:
        cached = self._get_cache("mc_releases")
        if cached is not None:
            return cached

        data = self._get_json("https://launchermeta.mojang.com/mc/game/version_manifest.json")
        versions: list[str] = []
        for item in data.get("versions", []) if isinstance(data, dict) else []:
            if not isinstance(item, dict):
                continue
            if item.get("type") != "release":
                continue
            version_id = item.get("id")
            if isinstance(version_id, str) and version_id.strip():
                versions.append(version_id.strip())

        self._set_cache("mc_releases", versions)
        return versions

    def fabric_game_versions(self) -> list[str]:
        cached = self._get_cache("fabric_game_versions")
        if cached is not None:
            return cached

        data = self._get_json("https://meta.fabricmc.net/v2/versions/game")
        versions: list[str] = []
        if isinstance(data, list):
            for item in data:
                if not isinstance(item, dict):
                    continue
                if item.get("stable") is not True:
                    continue
                version = item.get("version")
                if isinstance(version, str) and version.strip():
                    versions.append(version.strip())

        self._set_cache("fabric_game_versions", versions)
        return versions

    def fabric_loader_versions(self) -> list[dict[str, Any]]:
        cached = self._get_cache("fabric_loader_versions")
        if cached is not None:
            return cached

        data = self._get_json("https://meta.fabricmc.net/v2/versions/loader")
        loaders: list[dict[str, Any]] = []
        if isinstance(data, list):
            for item in data:
                if not isinstance(item, dict):
                    continue
                version = item.get("version")
                if not isinstance(version, str) or not version.strip():
                    continue
                loaders.append(
                    {
                        "version": version.strip(),
                        "stable": bool(item.get("stable")),
                    }
                )

        self._set_cache("fabric_loader_versions", loaders)
        return loaders

    def _get_cache(self, key: str) -> Any | None:
        entry = self._cache.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if expires_at < time.time():
            self._cache.pop(key, None)
            return None
        return value

    def _set_cache(self, key: str, value: Any) -> None:
        self._cache[key] = (time.time() + self._cache_ttl_seconds, value)

    def _get_json(self, url: str) -> Any:
        try:
            response = httpx.get(
                url,
                headers={"User-Agent": "TemptCraft/1.0"},
                timeout=self._timeout,
            )
        except httpx.RequestError as exc:
            raise RuntimeError(f"Metadata request failed: {exc}") from exc

        if response.status_code >= 400:
            raise RuntimeError(f"Metadata error {response.status_code}: {response.text}")
        return response.json()

