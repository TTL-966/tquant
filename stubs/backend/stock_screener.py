# stub: simplified public version - only MA cross evaluator kept
# ponytail: full version has 20+ indicators
import numpy as np
import pandas as pd
from backend.data_feed import DataFeed
from backend.db import Database

class StockScreener:
    _realtime_cache = {}
    _CACHE_TTL = 10

    def __init__(self, data_feed: DataFeed):
        self.data_feed = data_feed
        self.db = Database()
        self._evaluators = {'ma_cross': self._eval_ma_cross}
        self._batch_evaluators = {'ma_cross': self._batch_ma_cross}

    def _eval_ma_cross(self, row, condition, code):
        try:
            kline = self.data_feed.get_kline_df(code, end_date=row.get('trade_date', ''), days=condition.get('slow_period', 20) + 5)
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
        results = pd.Series(False, index=df.index)
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
        cond_type = card.get('type', '')
        if cond_type not in self._evaluators:
            return False, f"Condition type '{cond_type}' not supported (public version: ma_cross only)"
        ok = self._evaluators[cond_type]({'trade_date': ''}, card.get('params', {}), code)
        return ok, 'Match' if ok else 'No match'

    def screen_stocks_batch(self, conditions, pool=None, start_date=None, end_date=None,
                            industry_filter='', concept_filter=None, concept_match_mode='any',
                            market_cap_min='', market_cap_max='',
                            float_shares_min='', float_shares_max=''):
        return {'success': True, 'matches': [], 'total_checked': 0, 'message': 'Public version: ma_cross only. Full version: 20+ indicators'}
