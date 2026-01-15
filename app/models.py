from typing import Dict, Optional

from pydantic import BaseModel, Field


class ServerCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    port: Optional[int] = Field(None, ge=1, le=65535)
    memory_mb: Optional[int] = Field(None, ge=256, le=65536)
    env: Dict[str, str] = Field(default_factory=dict)
    version: Optional[str] = Field(None, max_length=32)
    server_type: Optional[str] = Field(None, max_length=32)
    eula: bool = True
    enable_rcon: Optional[bool] = None
    rcon_password: Optional[str] = Field(None, min_length=1)


class ServerInfo(BaseModel):
    server_id: str
    name: str
    status: str
    image: Optional[str]
    port: Optional[int]
    container_id: str
    version: Optional[str] = None
    server_type: Optional[str] = None
    modded: Optional[bool] = None
    memory_mb: Optional[int] = None


class ServerSettings(BaseModel):
    motd: Optional[str] = None
    max_players: Optional[int] = None
    difficulty: Optional[str] = None
    gamemode: Optional[str] = None
    view_distance: Optional[int] = None
    simulation_distance: Optional[int] = None
    online_mode: Optional[bool] = None
    whitelist: Optional[bool] = None
    pvp: Optional[bool] = None
    hardcore: Optional[bool] = None
    allow_nether: Optional[bool] = None
    allow_end: Optional[bool] = None
    allow_flight: Optional[bool] = None
    spawn_protection: Optional[int] = None
    level_seed: Optional[str] = None
    level_type: Optional[str] = None
    spawn_animals: Optional[bool] = None
    spawn_monsters: Optional[bool] = None
    spawn_npcs: Optional[bool] = None
    op_permission_level: Optional[int] = None
    player_idle_timeout: Optional[int] = None
    max_tick_time: Optional[int] = None
    entity_broadcast_range_percentage: Optional[int] = None
    server_port: Optional[int] = None
    server_ip: Optional[str] = None
    broadcast_console_to_ops: Optional[bool] = None
    broadcast_rcon_to_ops: Optional[bool] = None
    enable_query: Optional[bool] = None
    query_port: Optional[int] = None
    resource_pack: Optional[str] = None
    resource_pack_sha1: Optional[str] = None
    enable_command_block: Optional[bool] = None


class ServerSettingsResponse(BaseModel):
    server_id: str
    settings: ServerSettings


class WhitelistActionRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=32)
    action: str = Field(..., min_length=3, max_length=6)


class WhitelistResponse(BaseModel):
    server_id: str
    names: list[str]


class ModSearchResponse(BaseModel):
    results: list[dict]


class ModVersionResponse(BaseModel):
    versions: list[dict]


class ModInstallRequest(BaseModel):
    project_id: str = Field(..., min_length=1)
    version_id: Optional[str] = None
    loader: Optional[str] = None
    game_version: Optional[str] = None


class ModInstallResponse(BaseModel):
    server_id: str
    filename: str


class ModListResponse(BaseModel):
    server_id: str
    mods: list[str]

class ModpackSearchResponse(BaseModel):
    results: list[dict]


class ModpackVersionResponse(BaseModel):
    versions: list[dict]


class ModpackInstallRequest(BaseModel):
    project_id: str = Field(..., min_length=1)
    version_id: Optional[str] = None
    loader: Optional[str] = None
    game_version: Optional[str] = None
    overwrite: bool = False


class ModpackInstallResponse(BaseModel):
    server_id: str
    project_id: str
    version_id: str
    modpack_name: str
    installed_files: int
    skipped_files: int
    overrides_applied: int

class ModConfigFileInfo(BaseModel):
    path: str
    size_bytes: int
    modified_at: str


class ModConfigListResponse(BaseModel):
    server_id: str
    files: list[ModConfigFileInfo]


class ModConfigFileResponse(BaseModel):
    server_id: str
    path: str
    content: str


class ModConfigUpdateRequest(BaseModel):
    content: str


class ServerCreateResponse(BaseModel):
    message: str
    server: ServerInfo


class ServerActionResponse(BaseModel):
    server_id: str
    status: str


class CommandRequest(BaseModel):
    command: str = Field(..., min_length=1)


class CommandResponse(BaseModel):
    server_id: str
    exit_code: int
    output: str


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class UserInfo(BaseModel):
    id: int
    username: str
    role: str


class AuthResponse(BaseModel):
    user: UserInfo


class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)
    role: str = Field(..., min_length=4, max_length=8)


class UserListResponse(BaseModel):
    users: list[UserInfo]
