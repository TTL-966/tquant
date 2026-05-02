from backend.db import Database

def fetch_kline(code, start_date=None, end_date=None):
    db = Database()
    try:
        sql = "SELECT trade_date, open, high, low, close, vol FROM stock_daily WHERE ts_code = %s"
        params = [code]
        if start_date:
            sql += " AND trade_date >= %s"
            params.append(start_date)
        if end_date:
            sql += " AND trade_date <= %s"
            params.append(end_date)
        sql += " ORDER BY trade_date ASC"
        rows = db.query(sql, params)
        result = []
        for row in rows:
            result.append({
                "date": row['trade_date'].strftime('%Y-%m-%d'),
                "open": float(row['open']),
                "high": float(row['high']),
                "low": float(row['low']),
                "close": float(row['close']),
                "vol": float(row['vol'])
            })
        return result
    finally:
        db.close()
