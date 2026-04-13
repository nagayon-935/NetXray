import logging
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # SSH credentials for containerlab node collection.
    # Set via environment variables or .env file — no hardcoded defaults.
    # If unset, collection endpoints will use empty strings (SSH will fail with
    # an authentication error rather than silently using known-weak credentials).
    clab_ssh_user: str = ""
    clab_ssh_password: str = ""
    data_dir: Path = Path(__file__).parent.parent / "data" / "topologies"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:4173"]
    arista_eapi_port: int = 443
    schema_path: Path = Path(__file__).parent.parent.parent / "schema" / "netxray-ir.schema.json"


settings = Settings()

if not settings.clab_ssh_user:
    logger.warning(
        "CLAB_SSH_USER is not set. Set it via environment variable or .env file "
        "before using the /collect endpoint."
    )
