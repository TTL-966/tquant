# stub: simplified public version — full implementation is local only
# ponytail: this stub keeps only MA cross evaluator; full version has 20+ indicators
import json
import time
import numpy as np
import pandas as pd
from datetime import timedelta
from backend.data_feed import DataFeed
from backend.db import Database


class StockScreener:
    """Stock screening engine. Simplified public version — only MA cross demo."""

    _realtime_cache = {}
    _CACHE_TTL = 10

    def __init__(self, data_feed: DataFeed):
        self.data_feed = data_feed
        self.db = Database()

        self._evaluators = {
            'ma_cross': self._eval_ma_cross,
        }

        self._batch_evaluators = {
            'ma_cross': self._batch_ma_cross,
        }

    def _eval_ma_cross(self, row, condition, code):
        """Single-stock MA cross evaluation."""
        try:
            kline = self.data_feed.get_kline_df(
                code, end_date=row.get('trade_date', ''),
                days=condition.get('slow_period', 20) + 5
            )
            if kline is None or len(kline) < condition.get('slow_period', 20):
                return False
            fast = condition.get('fast_period', 5)
            slow = condition.get('slow_period', 20)
            ma_fast = kline['close'].rolling(fast).mean().iloc[-2:].values
            ma_slow = kline['close'].rolling(slow).mean().iloc[-2:].values
            direction = condition.get('direction', 'golden')
            if direction == 'golden':
                return ma_fast[0] <= ma_slow[0] and ma_fast[1] > ma_slow[1]
            else:
                return ma_fast[0] >= ma_slow[0] and ma_fast[1] < ma_slow[1]
        except Exception:
            return False

    def _batch_ma_cross(self, df, condition):
        """Batch MA cross screening."""
        results = pd.Series(False, index=df.index)
        fast_p = condition.get('fast_period', 5)
        slow_p = condition.get('slow_period', 20)
        direction = condition.get('direction', 'golden')
        for i in df.index:
            try:
                code = df.at[i, 'code'] if 'code' in df.columns else df.at[i, 'stock_code']
                row = df.loc[i].to_dict()
                row['trade_date'] = str(df.at[i, 'trade_date'])[:10] if 'trade_date' in df.columns else ''
                results[i] = self._eval_ma_cross(row, condition, code)
            except Exception:
                results[i] = False
        return results

    def evaluate_stock_with_reason(self, code, card):
        """Evaluate single card condition against a stock. Returns (ok, reason)."""
        cond_type = card.get('type', '')
        if cond_type not in self._evaluators:
            return False, f"条件类型 '{cond_type}' 不支持（公开版仅支持 ma_cross）"
        ok = self._evaluators[cond_type]({'trade_date': ''}, card.get('params', {}), code)
        reason = '符合条件' if ok else '不符合条件'
        return ok, reason

    def screen_stocks_batch(self, conditions, pool=None, start_date=None, end_date=None,
                            industry_filter='', concept_filter=None, concept_match_mode='any',
                            market_cap_min='', market_cap_max='',
                            float_shares_min='', float_shares_max=''):
        """Batch screen stocks. Returns simplified result."""
        return {
            'success': True,
            'matches': [],
            'total_checked': 0,
            'message': '公开版仅支持 ma_cross 选股，完整版支持 20+ 指标'
        }
