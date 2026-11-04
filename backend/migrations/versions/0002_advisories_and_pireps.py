"""advisories and pireps

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "advisories",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("source_id", sa.Text(), nullable=False),
        sa.Column("hazard", sa.Text(), nullable=False),
        sa.Column("severity", sa.Text()),
        sa.Column("base_ft", sa.Integer()),
        sa.Column("top_ft", sa.Integer()),
        sa.Column("due_to", sa.Text()),
        sa.Column("raw", sa.Text()),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=False),
        sa.Column("geom", postgresql.JSONB(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("kind", "source_id", "valid_from"),
    )
    op.create_index("advisories_valid_to_idx", "advisories", ["valid_to"])

    op.create_table(
        "pireps",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("report_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("station_icao", sa.Text()),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lon", sa.Float(), nullable=False),
        sa.Column("altitude_ft", sa.Integer()),
        sa.Column("kind", sa.Text()),
        sa.Column("turbulence", sa.Text()),
        sa.Column("icing", sa.Text()),
        sa.Column("clouds", sa.Text()),
        sa.Column("raw", sa.Text(), nullable=False),
        sa.UniqueConstraint("report_time", "lat", "lon"),
    )
    op.create_index("pireps_report_time_idx", "pireps", ["report_time"])


def downgrade() -> None:
    op.drop_index("pireps_report_time_idx")
    op.drop_table("pireps")
    op.drop_index("advisories_valid_to_idx")
    op.drop_table("advisories")
