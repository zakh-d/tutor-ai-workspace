"""Track whether the workspace timezone has been initialized."""
import sqlalchemy as sa
from alembic import op

revision = '0002_workspace_timezone'
down_revision = '0001_initial'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('workspaces', sa.Column(
        'timezone_configured', sa.Boolean(), nullable=False, server_default=sa.false(),
    ))
    # Legacy workspace updates did not distinguish saving UTC from editing only the name.
    op.execute("UPDATE workspaces SET timezone_configured = true WHERE revision > 1 OR timezone <> 'UTC'")


def downgrade():
    op.drop_column('workspaces', 'timezone_configured')
