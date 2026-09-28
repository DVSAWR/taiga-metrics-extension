"""Baseline: an empty database managed by Alembic."""

from __future__ import annotations

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Nothing to create yet, the first tables arrive with the ETL."""


def downgrade() -> None:
    """Nothing to drop."""
