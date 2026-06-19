# scripts/add_trade_date_index.py
"""Add index on stock_daily_qfq_with_name.trade_date for fast MAX lookup."""
import sys
sys.path.insert(0, '.')
from backend.db import Database
from sqlalchemy import text

db = Database()
with db.engine.connect() as conn:
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_sd_trade_date "
        "ON stock_daily_qfq_with_name(trade_date)"
    ))
    conn.commit()
print("Index idx_sd_trade_date created (or already exists).")
