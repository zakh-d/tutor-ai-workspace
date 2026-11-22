from fastapi.testclient import TestClient
from app.config import Settings, settings
from app.main import app


def test_version_default(monkeypatch):
    monkeypatch.delenv('APP_VERSION', raising=False)
    assert Settings(_env_file=None).app_version == 'dev'


def test_version_is_public_and_reads_environment(monkeypatch):
    monkeypatch.setenv('APP_VERSION', 'v1.2.3')
    settings.cache_clear()
    try:
        with TestClient(app) as client:
            response = client.get('/api/v1/version')
        assert response.status_code == 200
        assert response.json() == {'version': 'v1.2.3'}
        assert response.headers['cache-control'] == 'no-store'
    finally:
        settings.cache_clear()
