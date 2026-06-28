"""Async DB helper: runs synchronous SQLAlchemy queries in executor pool.

Avoids blocking the asyncio event loop while keeping the existing
SQLAlchemy engine and schema unchanged.
"""

import asyncio
import numpy as np
from sqlalchemy import text
from backend.db import Database


# Module-level cached engine — initialized on first use
_engine = None
_init_lock = asyncio.Lock()


async def _get_engine():
    global _engine
    if _engine is None:
        async with _init_lock:
            if _engine is None:
                _engine = Database().engine
    return _engine


async def query_history_bars(code_pure, field, count):
    """Fetch `count` bars of `field` for stock, ordered ascending.
    Returns numpy array. Runs DB I/O in default executor.
    """
    engine = await _get_engine()

    # Build ts_code suffix
    suffix_map = {'6': 'SH', '9': 'SH', '68': 'SH', '8': 'BJ'}
    suffix = '.SZ'
    for prefix, sfx in suffix_map.items():
        if code_pure.startswith(prefix):
            suffix = f'.{sfx}'
            break
    ts_code = code_pure + suffix

    from datetime import datetime
    today = datetime.now().strftime('%Y-%m-%d')

    def _query():
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"SELECT {field} FROM stock_daily_qfq_with_name "
                    "WHERE ts_code = :code AND trade_date < :today "
                    "ORDER BY trade_date DESC LIMIT :limit"
                ),
                {'code': ts_code, 'today': today, 'limit': count}
            ).fetchall()
        if not rows:
            return np.array([])
        values = [r[0] for r in rows if r[0] is not None]
        return np.array(values[::-1])

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _query)
