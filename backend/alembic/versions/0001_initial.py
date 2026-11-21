"""Initial application schema; static DDL frozen at revision creation.

IF NOT EXISTS permits adoption of the first pre-Alembic development schema.
"""
from alembic import op
revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None

DDL = (
    '\nCREATE TABLE IF NOT EXISTS jobs (\n\tid UUID NOT NULL, \n\tworkspace_id UUID NOT NULL, \n\ttype VARCHAR(60) NOT NULL, \n\tpayload JSONB NOT NULL, \n\tstate VARCHAR(30) NOT NULL, \n\tattempts INTEGER NOT NULL, \n\tgeneration INTEGER NOT NULL, \n\tavailable_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tlease_until TIMESTAMP WITH TIME ZONE, \n\terror JSONB, \n\toperation_id UUID NOT NULL, \n\tPRIMARY KEY (id)\n)\n\n',
    '\nCREATE TABLE IF NOT EXISTS rate_buckets (\n\tkey VARCHAR(64) NOT NULL, \n\t"window" BIGINT NOT NULL, \n\tcount INTEGER NOT NULL, \n\tPRIMARY KEY (key, "window")\n)\n\n',
    '\nCREATE TABLE IF NOT EXISTS workspaces (\n\tid UUID NOT NULL, \n\tissuer TEXT NOT NULL, \n\tsubject TEXT NOT NULL, \n\tname VARCHAR(200) NOT NULL, \n\ttimezone VARCHAR(100) NOT NULL, \n\trevision INTEGER NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (issuer, subject)\n)\n\n',
    '\nCREATE TABLE IF NOT EXISTS operations (\n\tid UUID NOT NULL, \n\tworkspace_id UUID NOT NULL, \n\tclient_id TEXT NOT NULL, \n\tkey UUID NOT NULL, \n\trequest_hash VARCHAR(64) NOT NULL, \n\tresult JSONB NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (workspace_id, client_id, key), \n\tFOREIGN KEY(workspace_id) REFERENCES workspaces (id)\n)\n\n',
    '\nCREATE TABLE IF NOT EXISTS records (\n\tid UUID NOT NULL, \n\tworkspace_id UUID NOT NULL, \n\tkind VARCHAR(60) NOT NULL, \n\trevision INTEGER NOT NULL, \n\tdata JSONB NOT NULL, \n\tarchived_at TIMESTAMP WITH TIME ZONE, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (workspace_id, id), \n\tFOREIGN KEY(workspace_id) REFERENCES workspaces (id)\n)\n\n',
    '\nCREATE TABLE IF NOT EXISTS revisions (\n\tid UUID NOT NULL, \n\tworkspace_id UUID NOT NULL, \n\tentity_id UUID NOT NULL, \n\tentity_type VARCHAR(60) NOT NULL, \n\trevision INTEGER NOT NULL, \n\tbefore JSONB, \n\tafter JSONB NOT NULL, \n\tactor TEXT NOT NULL, \n\tclient_id TEXT NOT NULL, \n\toperation_id UUID NOT NULL, \n\tundo_of UUID, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (workspace_id, entity_id, revision), \n\tFOREIGN KEY(workspace_id) REFERENCES workspaces (id)\n)\n\n',
    '\nCREATE TABLE IF NOT EXISTS assignment_access (\n\tid UUID NOT NULL, \n\tworkspace_id UUID NOT NULL, \n\tassignment_id UUID NOT NULL, \n\ttoken_hash VARCHAR(64) NOT NULL, \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\trevoked_at TIMESTAMP WITH TIME ZONE, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(workspace_id, assignment_id) REFERENCES records (workspace_id, id), \n\tUNIQUE (token_hash)\n)\n\n',
    '\nCREATE TABLE IF NOT EXISTS blobs (\n\tid UUID NOT NULL, \n\tworkspace_id UUID NOT NULL, \n\trecord_id UUID NOT NULL, \n\tobject_key TEXT NOT NULL, \n\tfilename TEXT NOT NULL, \n\tmedia_type TEXT NOT NULL, \n\tsize BIGINT NOT NULL, \n\tchecksum VARCHAR(64) NOT NULL, \n\tpurpose VARCHAR(30) NOT NULL, \n\tmetadata_json JSONB NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (workspace_id, id), \n\tFOREIGN KEY(workspace_id, record_id) REFERENCES records (workspace_id, id)\n)\n\n',
    '\nCREATE TABLE IF NOT EXISTS assignment_sessions (\n\tid UUID NOT NULL, \n\tworkspace_id UUID NOT NULL, \n\taccess_id UUID NOT NULL, \n\ttoken_hash VARCHAR(64) NOT NULL, \n\tcsrf_hash VARCHAR(64) NOT NULL, \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(access_id) REFERENCES assignment_access (id), \n\tUNIQUE (token_hash)\n)\n\n',
    'CREATE INDEX IF NOT EXISTS ix_jobs_workspace_id ON jobs (workspace_id)',
    'CREATE INDEX IF NOT EXISTS ix_records_kind ON records (kind)',
    'CREATE INDEX IF NOT EXISTS ix_records_workspace_id ON records (workspace_id)',
    'CREATE INDEX IF NOT EXISTS records_page ON records (workspace_id, kind, created_at, id)',
    'CREATE INDEX IF NOT EXISTS ix_revisions_workspace_id ON revisions (workspace_id)',
)

def upgrade():
    for statement in DDL:
        op.execute(statement)

def downgrade():
    raise RuntimeError('Initial schema downgrade is destructive; restore a verified backup instead')
