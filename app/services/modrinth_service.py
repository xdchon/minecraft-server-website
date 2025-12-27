import json
from typing import Any, Optional

import httpx

from ..config import settings


class ModrinthError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class ModrinthService:
    def __init__(self) -> None:
        self.base_url = settings.modrinth_base_url.rstrip("/")
        self.timeout = httpx.Timeout(20.0)

    def search(
        self,
        query: str,
        loader: Optional[str],
        game_version: Optional[str],
        limit: int,
    ) -> dict[str, Any]:
        params: dict[str, str] = {"query": query, "limit": str(limit)}
        facets = self._build_facets(loader, game_version)
        if facets:
            params["facets"] = facets
        return self._get("/search", params)

    def get_versions(
        self, project_id: str, loader: Optional[str], game_version: Optional[str]
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {}
        if loader:
            params["loaders"] = json.dumps([loader])
        if game_version:
            params["game_versions"] = json.dumps([game_version])
        return self._get(f"/project/{project_id}/version", params)

    def get_version(self, version_id: str) -> dict[str, Any]:
        return self._get(f"/version/{version_id}", {})

    def _get(self, path: str, params: dict[str, str]) -> Any:
        url = f"{self.base_url}{path}"
        try:
            response = httpx.get(
                url,
                params=params,
                headers={"User-Agent": "TemptCraft/1.0"},
                timeout=self.timeout,
            )
        except httpx.RequestError as exc:
            raise ModrinthError(502, f"Modrinth request failed: {exc}") from exc

        if response.status_code >= 400:
            raise ModrinthError(
                response.status_code,
                f"Modrinth error {response.status_code}: {response.text}",
            )
        return response.json()

    def _build_facets(self, loader: Optional[str], game_version: Optional[str]) -> str:
        facets: list[list[str]] = [["project_type:mod"]]
        if loader:
            facets.append([f"categories:{loader}"])
        if game_version:
            facets.append([f"versions:{game_version}"])
        return json.dumps(facets)
