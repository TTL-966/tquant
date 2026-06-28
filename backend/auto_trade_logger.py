"""自动下单日志记录：数据库表 + 文件日志。"""

import os
import logging
import threading
from datetime import datetime
from sqlalchemy import text

_LOG = None
_LOCK = threading.Lock()


def _get_logger():
    global _LOG
    if _LOG is not None:
        return _LOG
    with _LOCK:
        if _LOG is not None:
            return _LOG
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        log_dir = os.path.join(base_dir, 'logs')
        os.makedirs(log_dir, exist_ok=True)
        logger = logging.getLogger('auto_trade')
        logger.setLevel(logging.INFO)
        if not logger.handlers:
            fh = logging.FileHandler(
                os.path.join(log_dir, 'auto_trade.log'), encoding='utf-8'
            )
            fh.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
            logger.addHandler(fh)
        _LOG = logger
        return _LOG


def log_order_to_db(engine, stock_code, action, price, volume, status, message='', mode='', order_id=''):
    """将下单记录写入 auto_trade_log 表。"""
    try:
        sql = text("""
            INSERT INTO auto_trade_log
                (timestamp, stock_code, action, price, volume, status, message, mode, order_id)
            VALUES (:ts, :code, :action, :price, :vol, :status, :msg, :mode, :oid)
        """)
        with engine.begin() as conn:
            conn.execute(sql, {
                "ts": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                "code": stock_code,
                "action": action,
                "price": price,
                "vol": volume,
                "status": status,
                "msg": message,
                "mode": mode,
                "oid": order_id,
            })
    except Exception as e:
        logger = _get_logger()
        logger.error(f"写入数据库日志失败: {e}")


def log_order_to_file(message, level='INFO'):
    """写入文件日志。"""
    logger = _get_logger()
    if level == 'ERROR':
        logger.error(message)
    elif level == 'WARNING':
        logger.warning(message)
    else:
        logger.info(message)


def get_order_logs(engine, limit=100):
    """读取最近的下单记录。"""
    try:
        sql = text("""
            SELECT id, timestamp, stock_code, action, price, volume, status, message, mode, order_id
            FROM auto_trade_log ORDER BY id DESC LIMIT :limit
        """)
        with engine.connect() as conn:
            rows = conn.execute(sql, {"limit": limit}).fetchall()
        return [
            {
                "id": r[0], "timestamp": r[1], "stock_code": r[2],
                "action": r[3], "price": r[4], "volume": r[5],
                "status": r[6], "message": r[7], "mode": r[8], "order_id": r[9],
            }
            for r in rows
        ]
    except Exception as e:
        return []
