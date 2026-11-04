"""Run the cache jobs on their intervals."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time

from sqlalchemy.ext.asyncio import AsyncEngine

from app.ingest.jobs import JOBS, run_job

logger = logging.getLogger(__name__)

TICK_SECONDS = 15


async def run_forever(engine: AsyncEngine) -> None:
    """Poll for due jobs until cancelled.

    A fifteen second tick is enough for a one minute minimum interval, and
    avoids a scheduler dependency for three jobs.
    """
    due = {name: 0.0 for name, _, _ in JOBS}

    while True:
        for name, interval, job in JOBS:
            if time.monotonic() < due[name]:
                continue
            due[name] = time.monotonic() + interval
            await run_job(engine, name, job)

        await asyncio.sleep(TICK_SECONDS)


@contextlib.asynccontextmanager
async def running(engine: AsyncEngine):
    task = asyncio.create_task(run_forever(engine))
    try:
        yield task
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
