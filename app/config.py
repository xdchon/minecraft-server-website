import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


def _get_env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value in (None, ""):
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _get_env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value in (None, ""):
        return default
    if value.strip().lower() in {"1", "true", "yes", "on"}:
        return True
    if value.strip().lower() in {"0", "false", "no", "off"}:
        return False
    return default


@dataclass(frozen=True)
class Settings:
    docker_base_url: str
    data_root: str
    host_data_root: str
    minecraft_image: str
    modrinth_base_url: str
    port_range_start: int
    port_range_end: int
    default_memory_mb: int
    default_enable_rcon: bool
    default_rcon_password: str | None
    managed_label: str
    managed_label_value: str
    auth_secret: str
    auth_cookie_name: str
    auth_cookie_secure: bool
    session_ttl_hours: int
    owner_username: str | None
    owner_password: str | None
    auth_db_path: str


def load_settings() -> Settings:
    data_root = os.path.abspath(os.getenv("DATA_ROOT", "/data/minecraft"))
    host_data_root_env = os.getenv("HOST_DATA_ROOT")
    host_data_root = os.path.abspath(host_data_root_env) if host_data_root_env else data_root
    return Settings(
        docker_base_url=os.getenv("DOCKER_BASE_URL", "unix://var/run/docker.sock"),
        data_root=data_root,
        host_data_root=host_data_root,
        minecraft_image=os.getenv("MINECRAFT_IMAGE", "itzg/minecraft-server"),
        modrinth_base_url=os.getenv("MODRINTH_BASE_URL", "https://api.modrinth.com/v2"),
        port_range_start=_get_env_int("PORT_RANGE_START", 25565),
        port_range_end=_get_env_int("PORT_RANGE_END", 25665),
        default_memory_mb=_get_env_int("DEFAULT_MEMORY_MB", 2048),
        default_enable_rcon=_get_env_bool("DEFAULT_ENABLE_RCON", False),
        default_rcon_password=os.getenv("DEFAULT_RCON_PASSWORD") or None,
        managed_label=os.getenv("MANAGED_LABEL", "mc.manager"),
        managed_label_value=os.getenv("MANAGED_LABEL_VALUE", "fastapi"),
        auth_secret=os.getenv("AUTH_SECRET", ""),
        auth_cookie_name=os.getenv("AUTH_COOKIE_NAME", "mcserver_session"),
        auth_cookie_secure=_get_env_bool("AUTH_COOKIE_SECURE", False),
        session_ttl_hours=_get_env_int("SESSION_TTL_HOURS", 24),
        owner_username=os.getenv("OWNER_USERNAME") or None,
        owner_password=os.getenv("OWNER_PASSWORD") or None,
        auth_db_path=os.path.join(data_root, "_auth", "auth.db"),
    )


settings = load_settings()
