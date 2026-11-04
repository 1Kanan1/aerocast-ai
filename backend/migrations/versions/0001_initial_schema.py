"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-11-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stations",
        sa.Column("icao", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("state", sa.Text()),
        sa.Column("country", sa.Text()),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lon", sa.Float(), nullable=False),
        sa.Column("elev_m", sa.Integer()),
        sa.Column("site_type", sa.Text()),
    )

    op.create_table(
        "metar_observations",
        sa.Column(
            "station_icao",
            sa.Text(),
            sa.ForeignKey("stations.icao"),
            nullable=False,
        ),
        sa.Column("obs_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("report_time", sa.DateTime(timezone=True)),
        sa.Column("raw", sa.Text(), nullable=False),
        sa.Column("decoded", postgresql.JSONB(), nullable=False),
        sa.Column("category", sa.Text()),
        sa.Column("upstream_category", sa.Text()),
        sa.Column("parse_status", sa.Text(), nullable=False),
        sa.Column("parser_version", sa.Text(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("station_icao", "obs_time"),
    )
    op.create_index(
        "metar_observations_obs_time_idx",
        "metar_observations",
        [sa.text("obs_time DESC")],
    )

    op.create_table(
        "taf_forecasts",
        sa.Column(
            "station_icao",
            sa.Text(),
            sa.ForeignKey("stations.icao"),
            nullable=False,
        ),
        sa.Column("issue_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=False),
        sa.Column("raw", sa.Text(), nullable=False),
        sa.Column("periods", postgresql.JSONB(), nullable=False),
        sa.Column("parser_version", sa.Text(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("station_icao", "issue_time"),
    )

    op.create_table(
        "ingest_runs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("job", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "rows_upserted", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("error", sa.Text()),
    )
    op.create_index(
        "ingest_runs_job_idx",
        "ingest_runs",
        ["job", sa.text("started_at DESC")],
    )


def downgrade() -> None:
    op.drop_table("ingest_runs")
    op.drop_table("taf_forecasts")
    op.drop_index("metar_observations_obs_time_idx")
    op.drop_table("metar_observations")
    op.drop_table("stations")
