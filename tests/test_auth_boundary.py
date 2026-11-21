import time
from types import SimpleNamespace
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from app import auth
from app.errors import DomainError

@pytest.fixture
def signed(monkeypatch):
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    monkeypatch.setattr(auth,'jwks',lambda:SimpleNamespace(get_signing_key_from_jwt=lambda _:SimpleNamespace(key=key.public_key())))
    def token(**overrides):
        claims={'iss':auth.settings().keycloak_issuer,'sub':'tutor-one','aud':'tutor-api','iat':int(time.time()),'exp':int(time.time())+300,'azp':'tutor-web','scope':'workspace:read tutor:review','typ':'Bearer'}
        claims.update(overrides)
        return jwt.encode(claims,key,algorithm='RS256')
    return token

def test_valid_identity(signed):
    actor=auth.verify(signed(),'tutor-api')
    assert actor.subject=='tutor-one'
    actor.tutor()

@pytest.mark.parametrize('claims',[{'iss':'https://wrong.example'},{'aud':'other-service'},{'exp':0},{'typ':'ID'}])
def test_invalid_token_rejected(signed,claims):
    with pytest.raises(DomainError):
        auth.verify(signed(**claims),'tutor-api')

def test_mcp_client_cannot_release_even_with_review_scope(signed):
    actor=auth.verify(signed(azp='external-agent'),'tutor-api')
    with pytest.raises(DomainError):
        actor.tutor()

def test_missing_review_scope_rejected(signed):
    actor=auth.verify(signed(scope='workspace:read'),'tutor-api')
    with pytest.raises(DomainError):
        actor.tutor()
