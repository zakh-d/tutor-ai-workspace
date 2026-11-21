import pytest
from fastapi.testclient import TestClient

@pytest.fixture(scope='session')
def live_client():
    from app.main import app
    with TestClient(app) as client:
        yield client
