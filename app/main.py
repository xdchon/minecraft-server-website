import os
from typing import Optional

from fastapi import FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .models import (
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
    ModSearchResponse,
    ModVersionResponse,
)
from .services.minecraft_service import MinecraftService, ServiceError
from .services.modrinth_service import ModrinthError, ModrinthService

app = FastAPI(title="Minecraft Docker Manager")
modrinth = ModrinthService()
service = MinecraftService(modrinth=modrinth)
base_dir = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(base_dir, "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(os.path.join(static_dir, "index.html"))


@app.exception_handler(ServiceError)
def service_error_handler(request: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(ModrinthError)
def modrinth_error_handler(request: Request, exc: ModrinthError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.get("/servers", response_model=list[ServerInfo])
def list_servers() -> list[ServerInfo]:
    return service.list_servers()


@app.post("/servers", response_model=ServerCreateResponse)
def create_server(request: ServerCreateRequest) -> ServerCreateResponse:
    return service.create_server(request)


@app.post("/servers/{server_id}/start", response_model=ServerActionResponse)
def start_server(server_id: str) -> ServerActionResponse:
    return service.start_server(server_id)


@app.post("/servers/{server_id}/stop", response_model=ServerActionResponse)
def stop_server(server_id: str) -> ServerActionResponse:
    return service.stop_server(server_id)


@app.post("/servers/{server_id}/restart", response_model=ServerActionResponse)
def restart_server(server_id: str) -> ServerActionResponse:
    return service.restart_server(server_id)


@app.delete("/servers/{server_id}", response_model=ServerActionResponse)
def delete_server(
    server_id: str, retain_data: bool = Query(True)
) -> ServerActionResponse:
    return service.delete_server(server_id, retain_data=retain_data)


@app.get("/servers/{server_id}/logs")
def get_logs(
    server_id: str,
    follow: bool = Query(False),
    tail: Optional[int] = Query(200, ge=0),
):
    logs = service.get_logs(server_id, follow=follow, tail=tail)
    if follow:
        return StreamingResponse(logs, media_type="text/plain")
    if isinstance(logs, bytes):
        text = logs.decode("utf-8", errors="replace")
    else:
        text = b"".join(logs).decode("utf-8", errors="replace")
    return PlainTextResponse(text)


@app.post("/servers/{server_id}/command", response_model=CommandResponse)
def send_command(server_id: str, request: CommandRequest) -> CommandResponse:
    return service.send_command(server_id, request)


@app.get("/servers/{server_id}/settings", response_model=ServerSettingsResponse)
def get_settings(server_id: str) -> ServerSettingsResponse:
    return service.get_settings(server_id)


@app.patch("/servers/{server_id}/settings", response_model=ServerSettingsResponse)
def update_settings(
    server_id: str,
    request: ServerSettings,
    restart: bool = Query(False),
) -> ServerSettingsResponse:
    return service.update_settings(server_id, request, restart)


@app.get("/servers/{server_id}/whitelist", response_model=WhitelistResponse)
def get_whitelist(server_id: str) -> WhitelistResponse:
    return service.get_whitelist(server_id)


@app.post("/servers/{server_id}/whitelist", response_model=WhitelistResponse)
def update_whitelist(
    server_id: str, request: WhitelistActionRequest
) -> WhitelistResponse:
    return service.update_whitelist(server_id, request)


@app.get("/mods/search", response_model=ModSearchResponse)
def search_mods(
    query: str,
    loader: str = Query("fabric"),
    game_version: str | None = Query(None),
    limit: int = Query(10, ge=1, le=50),
) -> ModSearchResponse:
    data = modrinth.search(query, loader, game_version, limit)
    return ModSearchResponse(results=data.get("hits", []))


@app.get("/mods/{project_id}/versions", response_model=ModVersionResponse)
def mod_versions(
    project_id: str,
    loader: str = Query("fabric"),
    game_version: str | None = Query(None),
) -> ModVersionResponse:
    versions = modrinth.get_versions(project_id, loader, game_version)
    return ModVersionResponse(versions=versions)


@app.get("/servers/{server_id}/mods", response_model=ModListResponse)
def list_mods(server_id: str) -> ModListResponse:
    return service.list_mods(server_id)


@app.post("/servers/{server_id}/mods", response_model=ModInstallResponse)
def install_mod(
    server_id: str,
    request: ModInstallRequest,
    restart: bool = Query(False),
) -> ModInstallResponse:
    return service.install_mod(server_id, request, restart)


@app.delete("/servers/{server_id}/mods/{filename}", response_model=ModListResponse)
def remove_mod(
    server_id: str,
    filename: str,
    restart: bool = Query(False),
) -> ModListResponse:
    return service.remove_mod(server_id, filename, restart)
