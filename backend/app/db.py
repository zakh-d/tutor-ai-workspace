from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import create_engine, String, Integer, DateTime, ForeignKeyConstraint, UniqueConstraint, Index, BigInteger, Text, false
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from .config import settings

class Base(DeclarativeBase): pass
def now(): return datetime.now(timezone.utc)
def uid(): return str(uuid4())
class Workspace(Base):
    __tablename__='workspaces'
    id: Mapped[str]=mapped_column(UUID(as_uuid=False),primary_key=True,default=uid)
    issuer: Mapped[str]=mapped_column(Text)
    subject: Mapped[str]=mapped_column(Text)
    name: Mapped[str]=mapped_column(String(200),default='My workspace')
    timezone: Mapped[str]=mapped_column(String(100),default='UTC')
    timezone_configured: Mapped[bool]=mapped_column(server_default=false())
    revision: Mapped[int]=mapped_column(default=1)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
    __table_args__=(UniqueConstraint('issuer','subject'),)
class Record(Base):
    __tablename__='records'
    id: Mapped[str]=mapped_column(UUID(as_uuid=False),primary_key=True,default=uid)
    workspace_id: Mapped[str]=mapped_column(UUID(as_uuid=False),index=True)
    kind: Mapped[str]=mapped_column(String(60),index=True)
    revision: Mapped[int]=mapped_column(default=1)
    data: Mapped[dict]=mapped_column(JSONB,default=dict)
    archived_at: Mapped[datetime|None]=mapped_column(DateTime(timezone=True),nullable=True)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
    updated_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
    __table_args__=(UniqueConstraint('workspace_id','id'),ForeignKeyConstraint(['workspace_id'],['workspaces.id']),Index('records_page','workspace_id','kind','created_at','id'))
class Operation(Base):
    __tablename__='operations'
    id: Mapped[str]=mapped_column(UUID(as_uuid=False),primary_key=True,default=uid)
    workspace_id: Mapped[str]=mapped_column(UUID(as_uuid=False))
    client_id: Mapped[str]=mapped_column(Text)
    key: Mapped[str]=mapped_column(UUID(as_uuid=False))
    request_hash: Mapped[str]=mapped_column(String(64))
    result: Mapped[dict]=mapped_column(JSONB,default=dict)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
    __table_args__=(UniqueConstraint('workspace_id','client_id','key'),ForeignKeyConstraint(['workspace_id'],['workspaces.id']))
class Revision(Base):
    __tablename__='revisions'
    id: Mapped[str]=mapped_column(UUID(as_uuid=False),primary_key=True,default=uid)
    workspace_id: Mapped[str]=mapped_column(UUID(as_uuid=False),index=True)
    entity_id: Mapped[str]=mapped_column(UUID(as_uuid=False))
    entity_type: Mapped[str]=mapped_column(String(60))
    revision: Mapped[int]=mapped_column(Integer)
    before: Mapped[dict|None]=mapped_column(JSONB,nullable=True)
    after: Mapped[dict]=mapped_column(JSONB)
    actor: Mapped[str]=mapped_column(Text)
    client_id: Mapped[str]=mapped_column(Text)
    operation_id: Mapped[str]=mapped_column(UUID(as_uuid=False))
    undo_of: Mapped[str|None]=mapped_column(UUID(as_uuid=False),nullable=True)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
    __table_args__=(UniqueConstraint('workspace_id','entity_id','revision'),ForeignKeyConstraint(['workspace_id'],['workspaces.id']))
class Access(Base):
    __tablename__='assignment_access'
    id: Mapped[str]=mapped_column(UUID(as_uuid=False),primary_key=True,default=uid)
    workspace_id: Mapped[str]=mapped_column(UUID(as_uuid=False))
    assignment_id: Mapped[str]=mapped_column(UUID(as_uuid=False))
    token_hash: Mapped[str]=mapped_column(String(64),unique=True)
    expires_at: Mapped[datetime]=mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime|None]=mapped_column(DateTime(timezone=True),nullable=True)
    __table_args__=(ForeignKeyConstraint(['workspace_id','assignment_id'],['records.workspace_id','records.id']),)
class StudentSession(Base):
    __tablename__='assignment_sessions'
    id: Mapped[str]=mapped_column(UUID(as_uuid=False),primary_key=True,default=uid)
    workspace_id: Mapped[str]=mapped_column(UUID(as_uuid=False))
    access_id: Mapped[str]=mapped_column(UUID(as_uuid=False))
    token_hash: Mapped[str]=mapped_column(String(64),unique=True)
    csrf_hash: Mapped[str]=mapped_column(String(64))
    expires_at: Mapped[datetime]=mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
    __table_args__=(ForeignKeyConstraint(['access_id'],['assignment_access.id']),)
class Blob(Base):
    __tablename__='blobs'
    id: Mapped[str]=mapped_column(UUID(as_uuid=False),primary_key=True,default=uid)
    workspace_id: Mapped[str]=mapped_column(UUID(as_uuid=False))
    record_id: Mapped[str]=mapped_column(UUID(as_uuid=False))
    object_key: Mapped[str]=mapped_column(Text)
    filename: Mapped[str]=mapped_column(Text)
    media_type: Mapped[str]=mapped_column(Text)
    size: Mapped[int]=mapped_column(BigInteger)
    checksum: Mapped[str]=mapped_column(String(64))
    purpose: Mapped[str]=mapped_column(String(30))
    metadata_json: Mapped[dict]=mapped_column(JSONB,default=dict)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
    __table_args__=(UniqueConstraint('workspace_id','id'),ForeignKeyConstraint(['workspace_id','record_id'],['records.workspace_id','records.id']))
class Job(Base):
    __tablename__='jobs'
    id: Mapped[str]=mapped_column(UUID(as_uuid=False),primary_key=True,default=uid)
    workspace_id: Mapped[str]=mapped_column(UUID(as_uuid=False),index=True)
    type: Mapped[str]=mapped_column(String(60))
    payload: Mapped[dict]=mapped_column(JSONB)
    state: Mapped[str]=mapped_column(String(30),default='queued')
    attempts: Mapped[int]=mapped_column(default=0)
    generation: Mapped[int]=mapped_column(default=0)
    available_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
    lease_until: Mapped[datetime|None]=mapped_column(DateTime(timezone=True),nullable=True)
    error: Mapped[dict|None]=mapped_column(JSONB,nullable=True)
    operation_id: Mapped[str]=mapped_column(UUID(as_uuid=False))
class RateBucket(Base):
    __tablename__='rate_buckets'
    key: Mapped[str]=mapped_column(String(64),primary_key=True)
    window: Mapped[int]=mapped_column(BigInteger,primary_key=True)
    count: Mapped[int]=mapped_column(Integer,default=1)

engine=create_engine(settings().database_url,pool_pre_ping=True)
Session=sessionmaker(engine,expire_on_commit=False)
