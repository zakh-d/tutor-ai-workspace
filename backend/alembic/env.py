"""Run migrations on the connection serialized by app.migrate."""
from alembic import context
from app.db import Base

config = context.config
connection = config.attributes.get('connection')
if connection is None:
    raise RuntimeError('Run migrations using python -m app.migrate')
context.configure(connection=connection, target_metadata=Base.metadata,
                  version_table_schema='app', compare_type=True)
with context.begin_transaction():
    context.run_migrations()
