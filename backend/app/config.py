from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    database_url: str = 'postgresql+psycopg://tutor:tutor@localhost:5432/tutor'
    keycloak_issuer: str = 'http://localhost:8081/realms/tutor'
    keycloak_jwks_url: str | None = None
    api_audience: str = 'tutor-api'
    mcp_audience: str = 'http://localhost:8000/mcp'
    tutor_client_id: str = 'tutor-web'
    public_base_url: str = 'http://localhost:5173'
    cors_origins: str = 'http://localhost:5173'
    s3_endpoint: str = 'http://localhost:9000'
    s3_access_key: str = 'tutor'
    s3_secret_key: str = 'development-only-change-me'
    s3_bucket: str = 'tutor-private'
    cookie_secure: bool = True
    workspace_quota_bytes: int = 2 * 1024**3
    google_client_id: str = ''
    google_client_secret: str = ''
    google_redirect_uri: str = 'http://localhost:8000/api/v1/calendar/connection/callback'
    credential_encryption_key: str = ''

@lru_cache
def settings():
    return Settings()
