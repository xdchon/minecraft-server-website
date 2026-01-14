import logging
import os
from typing import Optional

from fastapi import FastAPI, File, Query, Request, Response, UploadFile
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    PlainTextResponse,
    RedirectResponse,
    StreamingResponse,
)
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .auth import AuthService, AuthUser
from .config import settings
from .models import (
    AuthResponse,
    CommandRequest,
    CommandResponse,
    LoginRequest,
    ServerActionResponse,
    ServerCreateRequest,
    ServerCreateResponse,
    ServerInfo,
    ServerSettings,
    ServerSettingsResponse,
    UserCreateRequest,
    UserInfo,
    UserListResponse,
    WhitelistActionRequest,
    WhitelistResponse,
    ModInstallRequest,
    ModInstallResponse,
    ModListResponse,
    ModConfigListResponse,
    ModConfigFileResponse,
    ModConfigUpdateRequest,
    ModSearchResponse,
    ModVersionResponse,
)
from .services.minecraft_service import MinecraftService, ServiceError
from .services.metadata_service import MetadataService
from .services.modrinth_service import ModrinthError, ModrinthService
from .services.branding_service import (
    BrandingError,
    branding_paths,
    ensure_branding_assets,
    read_branding_version,
    update_logo,
)

app = FastAPI(title="Minecraft Docker Manager")
logger = logging.getLogger(__name__)
modrinth = ModrinthService()
service = MinecraftService(modrinth=modrinth)
metadata = MetadataService()
auth_service = AuthService()
base_dir = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(base_dir, "static")
templates_dir = os.path.join(base_dir, "templates")
app.mount("/static", StaticFiles(directory=static_dir), name="static")
static_fonts_dir = os.path.join(static_dir, "fonts")
static_imgs_dir = os.path.join(static_dir, "imgs")
app.mount("/fonts", StaticFiles(directory=static_fonts_dir), name="fonts")
app.mount("/imgs", StaticFiles(directory=static_imgs_dir), name="imgs")
templates = Jinja2Templates(directory=templates_dir)


@app.on_event("startup")
def startup() -> None:
    try:
        auth_service.init_db()
    except Exception:
        logger.exception("Auth database init failed")

    try:
        auth_service.ensure_owner_bootstrap()
    except Exception:
        logger.exception("Owner bootstrap failed")

    try:
        ensure_branding_assets()
    except Exception:
        logger.exception("Branding asset init failed")

    try:
        service.start_dns_reconciler()
    except Exception:
        logger.exception("DNS reconciler startup failed")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith(("/static", "/fonts", "/imgs")) or path in {
        "/login",
        "/auth/login",
        "/auth/logout",
    }:
        return await call_next(request)
    if path.startswith("/branding") and request.method == "GET":
        return await call_next(request)
    if path == "/theme/backgrounds" and request.method == "GET":
        return await call_next(request)

    user = auth_service.get_user_from_request(request)
    if not user:
        accepts = request.headers.get("accept", "")
        if path == "/" or "text/html" in accepts:
            return RedirectResponse("/login")
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    request.state.user = user
    return await call_next(request)


@app.get("/")
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/panel")
def panel_root(request: Request):
    return index(request)


@app.get("/panel/{path:path}")
def panel_page(request: Request, path: str):
    return index(request)


@app.get("/login")
def login_page() -> FileResponse:
    return FileResponse(os.path.join(static_dir, "login.html"))

@app.get("/theme/backgrounds")
def theme_backgrounds() -> JSONResponse:
    background_dir = Path(static_imgs_dir) / "background"
    urls: list[str] = []
    if background_dir.exists():
        for path in sorted(background_dir.iterdir()):
            if not path.is_file():
                continue
            if path.name.startswith("."):
                continue
            if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                continue
            urls.append(f"/static/imgs/background/{path.name}")
    return JSONResponse(content={"urls": urls})


@app.post("/auth/login", response_model=AuthResponse)
def login(request: LoginRequest, response: Response) -> AuthResponse:
    user = auth_service.authenticate(request.username, request.password)
    if not user:
        raise ServiceError(401, "Invalid credentials")
    token, _ = auth_service.create_session(user.id)
    max_age = settings.session_ttl_hours * 3600
    response.set_cookie(
        settings.auth_cookie_name,
        token,
        httponly=True,
        samesite="lax",
        secure=settings.auth_cookie_secure,
        max_age=max_age,
    )
    return AuthResponse(user=UserInfo(id=user.id, username=user.username, role=user.role))


@app.post("/auth/logout")
def logout(request: Request, response: Response) -> JSONResponse:
    token = request.cookies.get(settings.auth_cookie_name)
    if token:
        auth_service.delete_session(token)
    response.delete_cookie(settings.auth_cookie_name)
    return JSONResponse(content={"message": "logged out"})


@app.get("/auth/me", response_model=AuthResponse)
def me(request: Request) -> AuthResponse:
    user = _require_user(request)
    return AuthResponse(user=UserInfo(id=user.id, username=user.username, role=user.role))


@app.get("/auth/users", response_model=UserListResponse)
def list_users(request: Request) -> UserListResponse:
    _require_owner(request)
    users = auth_service.list_users()
    return UserListResponse(
        users=[UserInfo(id=user.id, username=user.username, role=user.role) for user in users]
    )


@app.post("/auth/users", response_model=UserInfo)
def create_user(request: Request, payload: UserCreateRequest) -> UserInfo:
    _require_owner(request)
    role = payload.role.lower().strip()
    if role != "admin":
        raise ServiceError(400, "Only admin accounts can be created")
    try:
        user = auth_service.create_user(payload.username, payload.password, role="admin")
    except ValueError as exc:
        raise ServiceError(400, str(exc)) from exc
    return UserInfo(id=user.id, username=user.username, role=user.role)


@app.exception_handler(ServiceError)
def service_error_handler(request: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(ModrinthError)
def modrinth_error_handler(request: Request, exc: ModrinthError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(BrandingError)
def branding_error_handler(request: Request, exc: BrandingError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


def _require_user(request: Request) -> AuthUser:
    user = getattr(request.state, "user", None)
    if not user:
        raise ServiceError(401, "Not authenticated")
    return user


def _require_owner(request: Request) -> AuthUser:
    user = _require_user(request)
    if user.role != "owner":
        raise ServiceError(403, "Owner permissions required")
    return user


@app.get("/branding/version")
def branding_version() -> JSONResponse:
    return JSONResponse(content={"version": read_branding_version()})


@app.get("/branding/logo.png")
def branding_logo() -> FileResponse:
    paths = branding_paths()
    return FileResponse(
        paths.logo_path,
        media_type="image/png",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/branding/server-icon.png")
def branding_server_icon() -> FileResponse:
    paths = branding_paths()
    return FileResponse(
        paths.server_icon_path,
        media_type="image/png",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/branding/favicon.png")
def branding_favicon() -> FileResponse:
    paths = branding_paths()
    return FileResponse(
        paths.favicon_path,
        media_type="image/png",
        headers={"Cache-Control": "no-cache"},
    )


@app.post("/branding/logo")
def upload_branding_logo(request: Request, file: UploadFile = File(...)) -> JSONResponse:
    _require_owner(request)
    try:
        data = file.file.read()
    except Exception as exc:
        raise BrandingError(400, f"Failed to read upload: {exc}") from exc
    update_logo(data)
    updated = service.apply_branding_to_all_servers()
    return JSONResponse(
        content={
            "message": "logo updated",
            "version": read_branding_version(),
            "servers_updated": updated,
        }
    )


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


@app.get("/meta/minecraft/releases")
def minecraft_releases() -> JSONResponse:
    try:
        versions = metadata.minecraft_release_versions()
    except RuntimeError as exc:
        raise ServiceError(502, str(exc)) from exc
    return JSONResponse(content={"versions": versions})


@app.get("/meta/fabric/game-versions")
def fabric_game_versions() -> JSONResponse:
    try:
        versions = metadata.fabric_game_versions()
    except RuntimeError as exc:
        raise ServiceError(502, str(exc)) from exc
    return JSONResponse(content={"versions": versions})


@app.get("/meta/fabric/loaders")
def fabric_loaders() -> JSONResponse:
    try:
        loaders = metadata.fabric_loader_versions()
    except RuntimeError as exc:
        raise ServiceError(502, str(exc)) from exc
    return JSONResponse(content={"loaders": loaders})


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


@app.get("/servers/{server_id}/mod-settings", response_model=ModConfigListResponse)
def list_mod_settings(server_id: str) -> ModConfigListResponse:
    return service.list_mod_config_files(server_id)


@app.get(
    "/servers/{server_id}/mod-settings/{file_path:path}",
    response_model=ModConfigFileResponse,
)
def get_mod_setting_file(server_id: str, file_path: str) -> ModConfigFileResponse:
    return service.get_mod_config_file(server_id, file_path)


@app.put(
    "/servers/{server_id}/mod-settings/{file_path:path}",
    response_model=ModConfigFileResponse,
)
def update_mod_setting_file(
    server_id: str,
    file_path: str,
    request: ModConfigUpdateRequest,
    restart: bool = Query(False),
) -> ModConfigFileResponse:
    return service.update_mod_config_file(server_id, file_path, request, restart=restart)
