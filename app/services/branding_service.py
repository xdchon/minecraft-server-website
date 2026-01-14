import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from ..config import settings

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover
    Image = None  # type: ignore[assignment]
    ImageOps = None  # type: ignore[assignment]


class BrandingError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


@dataclass(frozen=True)
class BrandingPaths:
    root_dir: str
    logo_path: str
    favicon_path: str
    server_icon_path: str
    version_path: str


def _static_default_logo_path() -> str:
    app_dir = Path(__file__).resolve().parents[1]
    preferred = app_dir / "static" / "imgs" / "ui" / "Comedianos.png"
    if preferred.exists():
        return str(preferred)
    return str(app_dir / "static" / "comedianos.png")


def branding_paths() -> BrandingPaths:
    root = os.path.join(settings.data_root, "_branding")
    return BrandingPaths(
        root_dir=root,
        logo_path=os.path.join(root, "logo.png"),
        favicon_path=os.path.join(root, "favicon.png"),
        server_icon_path=os.path.join(root, "server-icon.png"),
        version_path=os.path.join(root, "version.txt"),
    )


def ensure_branding_assets() -> None:
    paths = branding_paths()
    os.makedirs(paths.root_dir, exist_ok=True)
    default_logo = _static_default_logo_path()
    if not os.path.exists(paths.logo_path):
        if not os.path.exists(default_logo):
            raise BrandingError(500, "Default branding asset is missing")
        shutil.copyfile(default_logo, paths.logo_path)
    _ensure_derived_assets(paths)


def bump_branding_version() -> None:
    paths = branding_paths()
    os.makedirs(paths.root_dir, exist_ok=True)
    try:
        current = 0
        if os.path.exists(paths.version_path):
            with open(paths.version_path, "r", encoding="utf-8") as handle:
                raw = handle.read().strip()
            if raw.isdigit():
                current = int(raw)
        with open(paths.version_path, "w", encoding="utf-8") as handle:
            handle.write(str(current + 1))
    except OSError:
        # Versioning is best-effort; assets still work without it.
        return


def read_branding_version() -> str:
    paths = branding_paths()
    try:
        if os.path.exists(paths.version_path):
            with open(paths.version_path, "r", encoding="utf-8") as handle:
                return handle.read().strip() or "0"
    except OSError:
        return "0"
    return "0"


def update_logo(image_bytes: bytes) -> None:
    if not image_bytes:
        raise BrandingError(400, "Empty upload")
    if len(image_bytes) > 5 * 1024 * 1024:
        raise BrandingError(413, "Image too large (max 5MB)")
    if Image is None or ImageOps is None:
        raise BrandingError(500, "Image processing is unavailable (missing Pillow)")

    paths = branding_paths()
    os.makedirs(paths.root_dir, exist_ok=True)

    try:
        from io import BytesIO

        with Image.open(BytesIO(image_bytes)) as img:
            img = img.convert("RGBA")
            # Save a reasonable logo (contained in 512x512 to avoid huge assets)
            logo = ImageOps.contain(img, (512, 512), Image.Resampling.LANCZOS)
            logo.save(paths.logo_path, format="PNG")

            icon = ImageOps.fit(img, (64, 64), Image.Resampling.LANCZOS)
            icon.save(paths.server_icon_path, format="PNG")

            favicon = ImageOps.fit(img, (64, 64), Image.Resampling.LANCZOS)
            favicon.save(paths.favicon_path, format="PNG")
    except BrandingError:
        raise
    except Exception as exc:
        raise BrandingError(400, f"Invalid image upload: {exc}") from exc

    bump_branding_version()


def _ensure_derived_assets(paths: BrandingPaths) -> None:
    if Image is None or ImageOps is None:
        return
    if os.path.exists(paths.server_icon_path) and os.path.exists(paths.favicon_path):
        return
    try:
        with Image.open(paths.logo_path) as img:
            img = img.convert("RGBA")
            if not os.path.exists(paths.server_icon_path):
                icon = ImageOps.fit(img, (64, 64), Image.Resampling.LANCZOS)
                icon.save(paths.server_icon_path, format="PNG")
            if not os.path.exists(paths.favicon_path):
                favicon = ImageOps.fit(img, (64, 64), Image.Resampling.LANCZOS)
                favicon.save(paths.favicon_path, format="PNG")
    except Exception:
        # Best-effort: keep original logo, skip derived.
        return
