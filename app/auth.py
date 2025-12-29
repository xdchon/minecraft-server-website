import base64
import hashlib
import hmac
import logging
import os
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from .config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AuthUser:
    id: int
    username: str
    role: str


class AuthService:
    def __init__(
        self,
        db_path: Optional[str] = None,
        secret: Optional[str] = None,
        cookie_name: Optional[str] = None,
        session_ttl_hours: Optional[int] = None,
    ) -> None:
        self.db_path = db_path or settings.auth_db_path
        self.secret = secret or settings.auth_secret or secrets.token_hex(32)
        self.cookie_name = cookie_name or settings.auth_cookie_name
        self.session_ttl_hours = session_ttl_hours or settings.session_ttl_hours

        if not settings.auth_secret:
            logger.warning(
                "AUTH_SECRET is not set; sessions will reset on restart. Set AUTH_SECRET to persist sessions."
            )

    def init_db(self) -> None:
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    token_hash TEXT UNIQUE NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)"
            )
            conn.execute("PRAGMA foreign_keys = ON")

    def ensure_owner_bootstrap(self) -> None:
        with self._connect() as conn:
            existing = conn.execute("SELECT COUNT(*) FROM users").fetchone()
            if existing and existing[0] > 0:
                return

        username = (settings.owner_username or "").strip().lower()
        password = settings.owner_password or ""
        if not username or not password:
            raise RuntimeError(
                "No users exist. Set OWNER_USERNAME and OWNER_PASSWORD to bootstrap the owner account."
            )
        self.create_user(username=username, password=password, role="owner")
        logger.info("Owner account created from environment variables.")

    def authenticate(self, username: str, password: str) -> Optional[AuthUser]:
        username = username.strip().lower()
        if not username or not password:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, username, password_hash, role FROM users WHERE username = ?",
                (username,),
            ).fetchone()
        if not row:
            return None
        if not self._verify_password(row["password_hash"], password):
            return None
        return AuthUser(id=row["id"], username=row["username"], role=row["role"])

    def create_user(self, username: str, password: str, role: str) -> AuthUser:
        username = username.strip().lower()
        if not username or not password:
            raise ValueError("Username and password are required")
        if role not in {"owner", "admin"}:
            raise ValueError("Invalid role")
        password_hash = self._hash_password(password)
        created_at = self._now().isoformat()
        with self._connect() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO users (username, password_hash, role, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (username, password_hash, role, created_at),
                )
                user_id = conn.execute(
                    "SELECT id FROM users WHERE username = ?", (username,)
                ).fetchone()[0]
            except sqlite3.IntegrityError as exc:
                raise ValueError("Username already exists") from exc
        return AuthUser(id=user_id, username=username, role=role)

    def list_users(self) -> list[AuthUser]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, username, role FROM users ORDER BY created_at ASC"
            ).fetchall()
        return [AuthUser(id=row["id"], username=row["username"], role=row["role"]) for row in rows]

    def create_session(self, user_id: int) -> tuple[str, datetime]:
        token = secrets.token_urlsafe(32)
        token_hash = self._hash_token(token)
        now = self._now()
        expires = now + timedelta(hours=self.session_ttl_hours)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (user_id, token_hash, created_at, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (user_id, token_hash, now.isoformat(), expires.isoformat()),
            )
        return token, expires

    def delete_session(self, token: str) -> None:
        token_hash = self._hash_token(token)
        with self._connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    def get_user_by_session(self, token: str) -> Optional[AuthUser]:
        if not token:
            return None
        token_hash = self._hash_token(token)
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT users.id, users.username, users.role, sessions.expires_at
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = ?
                """,
                (token_hash,),
            ).fetchone()
        if not row:
            return None
        expires_at = datetime.fromisoformat(row["expires_at"])
        if expires_at < self._now():
            self.delete_session(token)
            return None
        return AuthUser(id=row["id"], username=row["username"], role=row["role"])

    def get_user_from_request(self, request) -> Optional[AuthUser]:
        token = request.cookies.get(self.cookie_name)
        if not token:
            return None
        return self.get_user_by_session(token)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _hash_password(self, password: str, salt: Optional[bytes] = None) -> str:
        salt = salt or secrets.token_bytes(16)
        iterations = 200_000
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return "$".join(
            [
                "pbkdf2_sha256",
                str(iterations),
                base64.b64encode(salt).decode("ascii"),
                base64.b64encode(dk).decode("ascii"),
            ]
        )

    def _verify_password(self, stored: str, password: str) -> bool:
        try:
            algorithm, iterations_str, salt_b64, hash_b64 = stored.split("$", 3)
            if algorithm != "pbkdf2_sha256":
                return False
            iterations = int(iterations_str)
            salt = base64.b64decode(salt_b64)
            expected = base64.b64decode(hash_b64)
        except (ValueError, base64.binascii.Error):
            return False
        derived = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, iterations
        )
        return hmac.compare_digest(expected, derived)

    def _hash_token(self, token: str) -> str:
        return hmac.new(self.secret.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()

    def _now(self) -> datetime:
        return datetime.now(timezone.utc)
