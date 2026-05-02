import json
import pandas as pd
from backend.db import Database

class DataFeed:
    def __init__(self):
        self.db = Database()

    def get_kline_json(self, code, start_date="2026-01-01", end_date="2026-04-01"):
        df = self.db.get_kline(code, start_date, end_date)
        dates = [d.strftime('%Y-%m-%d') for d in df['trade_date']]
        values = [[round(o,2), round(c,2), round(l,2), round(h,2)] for o,c,l,h in zip(df['open'], df['close'], df['low'], df['high'])]
        result = {
            "dates": dates,
            "values": values
        }
        return json.dumps(result)
