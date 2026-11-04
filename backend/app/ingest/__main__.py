"""Run one ingestion cycle from the command line."""

from __future__ import annotations

import asyncio
import logging

from app.db.session import dispose_engine, get_engine
from app.ingest.jobs import JOBS, run_job


async def _main() -> None:
    logging.basicConfig(level=logging.INFO)
    engine = get_engine()
    for name, _, job in JOBS:
        rows = await run_job(engine, name, job)
        print(f"{name}: {rows} rows")
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(_main())
