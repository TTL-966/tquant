import json
import time
import numpy as np
import pandas as pd
from datetime import timedelta
from sqlalchemy import text
from backend.data_feed import DataFeed
from backend.db import Database


class StockScreener:
    """条件选股引擎 —— 单股判断 + 批量矢量化选股"""

    # 实时行情缓存: code -> (timestamp, data_dict)
    _realtime_cache = {}
    _CACHE_TTL = 10  # 秒

    def __init__(self, data_feed: DataFeed):
        self.data_feed = data_feed
        self.db = Database()

        # 单股评估器（保留原有单股逻辑）
        self._evaluators = {
            'ma_cross': self._eval_ma_cross,
            'rsi': self._eval_rsi,
            'macd': self._eval_macd,
            'bollinger': self._eval_bollinger,
            'kdj': self._eval_kdj,
            'volume': self._eval_volume,
            'volume_contraction': self._eval_volume_contraction,
            'fund_flow_single': self._eval_fund_flow_single,
            'supertrend': self._eval_supertrend,
            'cmf': self._eval_cmf,
            'resonance': self._eval_resonance,
            'seven_swords': self._eval_seven_swords,
            'trend_strength': self._eval_trend_strength,
        }

        # 批量矢量化评估器（唯一且完整）
        self._batch_evaluators = {
            'ma_cross': self._batch_ma_cross,
            'rsi': self._batch_rsi,
            'macd': self._batch_macd,
            'bollinger': self._batch_bollinger,
            'bollinger_width': self._batch_bollinger_width,
            'kdj': self._batch_kdj,
            'volume': self._batch_volume,
            'volume_contraction': self._batch_volume_contraction,
            'day_of_week': self._batch_day_of_week,
            'atr_breakout': self._batch_atr_channel,
            'cci': self._batch_cci,
            'williams_r': self._batch_williams_r,
            'obv': self._batch_obv,
            'roc': self._batch_roc,
            'psy': self._batch_psy,
            'sar': self._batch_sar,
            'ma_alignment': self._batch_ma_alignment,
            'hammer_hanging': self._batch_hammer_hanging,
            'price_limit': self._batch_price_limit,
            'pe_below': self._batch_pe_below,
            'pb_below': self._batch_pb_below,
            'roe_above': self._batch_roe_above,
            'total_mv_between': self._batch_total_mv_between,
            'float_mv_between': self._batch_float_mv_between,
            'float_shares_between': self._batch_float_shares_between,
            'concept_contains': self._batch_concept_contains,
            'industry_contains': self._batch_industry_contains,
            'yesterday_change': self._batch_yesterday_change,
            'n_day_high': self._batch_n_day_high,
            'n_day_low': self._batch_n_day_low,
            'consecutive_up': self._batch_consecutive_up,
            'volume_ratio': self._batch_volume_ratio,
            'realtime_change': self._batch_realtime_change,
            'fund_flow_single': self._batch_fund_flow_single,
            'supertrend': self._batch_supertrend,
            'cmf': self._batch_cmf,
            'resonance': self._batch_resonance,
            'seven_swords': self._batch_seven_swords,
            'trend_strength': self._batch_trend_strength,
            'vwap_signal': self._batch_vwap_signal,
            'median_signal': self._batch_median_signal,
            'mean_signal': self._batch_mean_signal,
            'turnover_threshold': self._batch_turnover_threshold,
            'turnover_ratio': self._batch_turnover_ratio,
        }

    @staticmethod
    def _apply_pre_filters(input_codes, db_engine, pre_filters):
        """Apply DB-sourced pre-filters sequentially.

        Args:
            input_codes: list of pure-digit codes (e.g. ['000001', '600519']),
                         or None for full market
            db_engine: SQLAlchemy engine
            pre_filters: dict with keys: industry, concepts, concept_match,
                         market_cap_min, market_cap_max,
                         float_shares_min, float_shares_max

        Returns: narrowed list of pure-digit codes, or empty list
        """
        if not pre_filters:
            return input_codes

        codes = list(input_codes) if input_codes else None

        # 1. Industry filter
        industry = (pre_filters.get('industry') or '').strip()
        if industry:
            try:
                sql = text(
                    "SELECT ts_code FROM stock_industry_detail "
                    "WHERE industry_level1 = :ind"
                )
                with db_engine.connect() as conn:
                    rows = conn.execute(sql, {"ind": industry}).fetchall()
                ind_codes = {r[0].replace('.SZ', '').replace('.SH', '').replace('.BJ', '')
                             for r in rows}
                if codes is None:
                    codes = list(ind_codes)
                else:
                    codes = [c for c in codes if c in ind_codes]
                print(f"[PreFilter] 行业={industry}: {len(codes)} 只")
                if not codes:
                    return []
            except Exception as e:
                print(f"[PreFilter] 行业筛选失败: {e}")

        # 2. Concept filter
        concepts = pre_filters.get('concepts')
        if concepts and len(concepts) > 0:
            concept_match = pre_filters.get('concept_match', 'any')
            concept_set = set(concepts)
            try:
                placeholders = ','.join([f"'{c}'" for c in concepts])
                sql = text(f"""
                    SELECT sc.ts_code, c.concept_name
                    FROM stock_concept sc
                    JOIN concept c ON sc.concept_id = c.concept_id
                    WHERE c.concept_name IN ({placeholders})
                """)
                with db_engine.connect() as conn:
                    rows = conn.execute(sql).fetchall()
                # Group matched concept names per pure code
                code_matches = {}
                for r in rows:
                    pure = r[0].replace('.SZ', '').replace('.SH', '').replace('.BJ', '')
                    code_matches.setdefault(pure, set()).add(r[1])
                if concept_match == 'all':
                    valid = {c for c, m in code_matches.items()
                             if concept_set.issubset(m)}
                else:
                    valid = {c for c, m in code_matches.items()
                             if concept_set & m}
                if codes is None:
                    codes = list(valid)
                else:
                    codes = [c for c in codes if c in valid]
                print(f"[PreFilter] 概念={concepts} match={concept_match}: {len(codes)} 只")
                if not codes:
                    return []
            except Exception as e:
                print(f"[PreFilter] 概念筛选失败: {e}")

        # 3. Market cap filter
        mc_min = pre_filters.get('market_cap_min')
        mc_max = pre_filters.get('market_cap_max')
        if mc_min is not None or mc_max is not None:
            try:
                fin_df = pd.read_sql("SELECT ts_code, total_mv FROM stock_financial", db_engine)
                # Parse numeric values
                mc_min_v = float(mc_min) if mc_min not in (None, '') else None
                mc_max_v = float(mc_max) if mc_max not in (None, '') else None
                fin_df['code'] = fin_df['ts_code'].str.replace(
                    r'\.(SZ|SH|BJ)$', '', regex=True
                )
                valid_codes = set()
                for _, row in fin_df.iterrows():
                    mv = row['total_mv']
                    if mv is None:
                        continue
                    ok = True
                    if mc_min_v is not None and mv < mc_min_v:
                        ok = False
                    if mc_max_v is not None and mv > mc_max_v:
                        ok = False
                    if ok:
                        valid_codes.add(row['code'])
                if codes is None:
                    codes = list(valid_codes)
                else:
                    codes = [c for c in codes if c in valid_codes]
                print(f"[PreFilter] 市值 {mc_min_v}~{mc_max_v}亿: {len(codes)} 只")
                if not codes:
                    return []
            except Exception as e:
                print(f"[PreFilter] 市值筛选失败: {e}")

        # 4. Float shares filter
        fs_min = pre_filters.get('float_shares_min')
        fs_max = pre_filters.get('float_shares_max')
        if fs_min is not None or fs_max is not None:
            try:
                fin_df = pd.read_sql("SELECT ts_code, float_shares FROM stock_financial", db_engine)
                fs_min_v = float(fs_min) if fs_min not in (None, '') else None
                fs_max_v = float(fs_max) if fs_max not in (None, '') else None
                fin_df['code'] = fin_df['ts_code'].str.replace(
                    r'\.(SZ|SH|BJ)$', '', regex=True
                )
                valid_codes = set()
                for _, row in fin_df.iterrows():
                    fs = row['float_shares']
                    if fs is None:
                        continue
                    ok = True
                    if fs_min_v is not None and fs < fs_min_v:
                        ok = False
                    if fs_max_v is not None and fs > fs_max_v:
                        ok = False
                    if ok:
                        valid_codes.add(row['code'])
                if codes is None:
                    codes = list(valid_codes)
                else:
                    codes = [c for c in codes if c in valid_codes]
                print(f"[PreFilter] 股本 {fs_min_v}~{fs_max_v}亿股: {len(codes)} 只")
                if not codes:
                    return []
            except Exception as e:
                print(f"[PreFilter] 股本筛选失败: {e}")

        return codes if codes else []

        print("StockScreener 初始化成功")

    # ── 单股 public API ──────────────────────────────────────────

    def evaluate_stock(self, code: str, card: dict, date: str = None) -> bool:
        ok, _ = self._evaluate_with_reason(code, card, date)
        return ok

    def evaluate_stock_with_reason(self, code: str, card: dict, date: str = None):
        return self._evaluate_with_reason(code, card, date)

    # ── 批量选股 public API ──────────────────────────────────────

    def load_all_stock_data(self, start_date: str, end_date: str,
                            stock_pool: list = None) -> dict:
        """一次性读取所有（或指定）股票在日期范围内的日线数据。

        Returns:
            { "000001": DataFrame(trade_date索引, 列: open/high/low/close/volume/name), ... }
        """
        df = self._load_all_stock_data_df(start_date, end_date, stock_pool)
        if df.empty:
            return {}

        result = {}
        for code, group in df.groupby('code'):
            g = group.set_index('trade_date').drop(columns=['code'])
            result[code] = g
        return result

    def screen_stocks_batch(self, cards: list, stock_pool: list = None,
                            start_date: str = None, end_date: str = None,
                            logic: str = "AND") -> list:
        """批量选股：对全市场（或指定股票池）执行卡片条件筛选。

        Args:
            cards:      卡片列表，格式同 CARD_TYPE_META
            stock_pool: 可选，股票代码列表
            start_date: 筛选区间起始日期，None 表示最新交易日
            end_date:   筛选区间结束日期，None 表示最新交易日
            logic:      "AND"（所有卡片同时满足）

        Returns:
            [{ "code": "000001", "name": "平安银行", "trigger_date": "2024-01-15",
               "details": {"ma_cross": true, "ma5": 12.34, "ma20": 12.10, ...} }, ...]
        """
        print(f"[Screener] 股票池: {len(stock_pool) if stock_pool else '全市场'} 只")
        print(f"[Screener] 卡片数: {len(cards)}, 逻辑: {logic}")

        # 1. 确定筛选区间结束日期
        if end_date is None:
            with self.db.engine.connect() as conn:
                row = conn.execute(
                    text("SELECT MAX(trade_date) FROM stock_daily_qfq_with_name")
                ).scalar()
            if row is None:
                return []
            end_date = str(row)

        if start_date is None:
            # 默认起始日期为结束日期前推 5 个交易日（粗略用 10 个自然日）
            start_dt = pd.to_datetime(end_date) - timedelta(days=10)
            start_date = start_dt.strftime('%Y-%m-%d')

        print(f"[Screener] 筛选区间: {start_date} ~ {end_date}")

        # 2. 计算指标所需的历史数据跨度
        max_bars = 0
        for card in cards:
            ct = card.get('type', '')
            needed = self._get_needed_bars(ct, card.get('params', {}))
            if needed > max_bars:
                max_bars = needed

        # 数据加载起始日期（从区间起始往前推足够的 K 线）
        data_start = self._bars_to_start_date(start_date, max_bars)
        print(f"[Screener] 加载数据范围: {data_start} ~ {end_date}")

        # 3. 批量加载数据
        df = self._load_all_stock_data_df(data_start, end_date, stock_pool)
        print(f"[Screener] 加载数据: {len(df)} 行, {df['code'].nunique() if not df.empty else 0} 只股票")
        if df.empty:
            print("[Screener] 数据为空，退出")
            return []

        # 4. 预处理：前向填充价格，成交量填0
        df = self._preprocess_data(df)

        # 5. 对每个卡片计算布尔掩码与详情列
        mask_columns = []
        detail_columns = {}   # card_type -> list of column names

        for card in cards:
            card_type = card.get('type', '')
            params = card.get('params', {})
            evaluator = self._batch_evaluators.get(card_type)

            if evaluator is None:
                mask_col = f'_mask_{card_type}'
                df[mask_col] = False
                mask_columns.append(mask_col)
                detail_columns[card_type] = []
                print(f"[Screener] {card_type}: 未实现矢量化，跳过")
                continue

            mask, detail_cols = evaluator(df, params)
            mask_col = f'_mask_{card_type}'
            df[mask_col] = mask.fillna(False)
            mask_columns.append(mask_col)
            detail_columns[card_type] = list(detail_cols.keys())
            print(f"[Screener] {card_type} 掩码命中: {mask.sum()} 行 (总 {len(mask)} 行)")

        # 6. 合并卡片布尔值
        mask_df = df[mask_columns]
        if logic == "AND":
            combined = mask_df.all(axis=1)
        else:
            combined = mask_df.any(axis=1)

        # 7. 限制在筛选区间内，按股票分组取最早触发日
        df['_combined'] = combined
        df['_trade_date'] = df['trade_date']
        start_dt = pd.to_datetime(start_date)
        end_dt = pd.to_datetime(end_date)

        # 筛选区间内满足条件的行
        in_range = (df['_trade_date'] >= start_dt) & (df['_trade_date'] <= end_dt)
        df['_hit_in_range'] = in_range & df['_combined']

        # 按股票聚合：是否存在命中 + 最早触发日
        hit_groups = df[df['_hit_in_range']].groupby('code').agg(
            trigger_date=('_trade_date', 'min'),
            name=('name', 'first'),
            hit_count=('_trade_date', 'count')
        ).reset_index()

        if hit_groups.empty:
            print("[Screener] 区间内无命中股票")
            return []

        print(f"[Screener] 区间命中: {len(hit_groups)} 只股票")
        hit_codes = hit_groups['code'].tolist()
        hit_names = hit_groups['name'].tolist()
        print(f"[Screener] 命中前5: {list(zip(hit_codes[:5], hit_names[:5]))}")

        # 8. 为每只命中股票提取触发日的详情数据
        trigger_map = dict(zip(hit_groups['code'], hit_groups['trigger_date']))
        output = []

        for _, hg in hit_groups.iterrows():
            code = hg['code']
            name = hg.get('name', '')
            trigger_date = hg['trigger_date']
            trigger_date_str = trigger_date.strftime('%Y-%m-%d')

            # 取该股票触发日的行
            trigger_row = df[
                (df['code'] == code) &
                (df['_trade_date'] == trigger_date) &
                (df['_hit_in_range'])
            ]
            if trigger_row.empty:
                trigger_row = df[(df['code'] == code) & (df['_trade_date'] == trigger_date)]
            row = trigger_row.iloc[0] if not trigger_row.empty else None

            details = {}
            if row is not None:
                for card in cards:
                    card_type = card.get('type', '')
                    mask_col = f'_mask_{card_type}'
                    details[card_type] = bool(row.get(mask_col, False))

                    cols = detail_columns.get(card_type, [])
                    for col in cols:
                        val = row.get(col)
                        if isinstance(val, (np.floating, float)):
                            val = round(float(val), 2)
                        elif isinstance(val, np.integer):
                            val = int(val)
                        elif isinstance(val, np.bool_):
                            val = bool(val)
                        elif pd.isna(val):
                            val = None
                        details[col] = val
            else:
                for card in cards:
                    card_type = card.get('type', '')
                    details[card_type] = False

            output.append({
                "code": code,
                "name": name,
                "trigger_date": trigger_date_str,
                "details": details
            })

        return output

    # ── 内部: 数据加载 ───────────────────────────────────────────

    def _load_all_stock_data_df(self, start_date: str, end_date: str,
                                stock_pool: list = None) -> pd.DataFrame:
        """批量读取日线数据到单个 DataFrame（内部用）。"""
        sql = """
            SELECT ts_code, trade_date, open, high, low, close, vol, name, turnover_rate_f
            FROM stock_daily_qfq_with_name
            WHERE trade_date >= :start AND trade_date <= :end
        """
        params = {"start": start_date, "end": end_date}

        if stock_pool is not None:
            # 将纯数字代码转为 ts_code 列表，并去重
            ts_codes = []
            seen = set()
            for code in stock_pool:
                code = str(code).split('.')[0]
                if code.startswith(('000', '001', '002', '003', '300', '301')):
                    ts = f"{code}.SZ"
                elif code.startswith(('600', '601', '603', '605', '688', '689')):
                    ts = f"{code}.SH"
                elif code.startswith('8'):
                    ts = f"{code}.BJ"
                else:
                    ts = f"{code}.SZ"
                if ts not in seen:
                    seen.add(ts)
                    ts_codes.append(ts)

            if not ts_codes:
                return pd.DataFrame()

            # 分批 IN 子句，避免 SQL 过长
            df_list = []
            batch_size = 500
            for i in range(0, len(ts_codes), batch_size):
                batch = ts_codes[i:i + batch_size]
                placeholders = ','.join([f"'{t}'" for t in batch])
                batch_sql = sql + f" AND ts_code IN ({placeholders})"
                df_chunk = pd.read_sql(text(batch_sql), self.db.engine, params=params)
                if not df_chunk.empty:
                    df_list.append(df_chunk)
            df = pd.concat(df_list, ignore_index=True) if df_list else pd.DataFrame()
        else:
            df = pd.read_sql(text(sql), self.db.engine, params=params)

        if df.empty:
            return df

        # 清洗 ts_code → 纯数字代码
        df['code'] = df['ts_code'].str.replace(r'\.(SZ|SH|BJ)$', '', regex=True)
        df['volume'] = df['vol']
        df['trade_date'] = pd.to_datetime(df['trade_date'])
        df = df.drop(columns=['ts_code', 'vol'])

        # 按股票+日期排序（升序，rolling 依赖此顺序）
        df = df.sort_values(['code', 'trade_date']).reset_index(drop=True)
        return df

    def _preprocess_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """前向填充价格（处理停牌缺失），成交量填 0"""
        price_cols = ['open', 'high', 'low', 'close']
        df[price_cols] = df.groupby('code')[price_cols].ffill()
        df['volume'] = df.groupby('code')['volume'].transform(
            lambda x: x.fillna(0)
        )
        df['name'] = df.groupby('code')['name'].ffill()
        if 'turnover_rate_f' in df.columns:
            df['turnover_rate_f'] = df.groupby('code')['turnover_rate_f'].transform(
                lambda x: x.fillna(0)
            )
        return df

    # ── 内部: 工具方法 ───────────────────────────────────────────

    @staticmethod
    def _codes_to_ts_codes(codes: list) -> list:
        """将纯数字代码列表转为带交易所后缀的 ts_code 列表"""
        ts_codes = []
        for c in codes:
            c = str(c).split('.')[0]
            if c.startswith(('000', '001', '002', '003', '300', '301')):
                ts_codes.append(f"{c}.SZ")
            elif c.startswith(('600', '601', '603', '605', '688', '689')):
                ts_codes.append(f"{c}.SH")
            elif c.startswith('8'):
                ts_codes.append(f"{c}.BJ")
            else:
                ts_codes.append(f"{c}.SZ")
                ts_codes.append(f"{c}.SH")
        return ts_codes

    @staticmethod
    def _get_needed_bars(card_type: str, params: dict) -> int:
        """估算卡片指标所需的最少K线数量"""
        if card_type == 'ma_cross':
            return max(int(params.get('fastPeriod', 5)),
                       int(params.get('slowPeriod', 20))) + 2
        if card_type == 'rsi':
            return int(params.get('period', 14)) + 1
        if card_type == 'macd':
            fast = int(params.get('fastPeriod', 12))
            slow = int(params.get('slowPeriod', 26))
            sig = int(params.get('signalPeriod', 9))
            return max(fast, slow) + sig + 3
        if card_type == 'bollinger':
            return int(params.get('period', 20))
        if card_type in ('volume', 'volume_contraction'):
            return int(params.get('period', 20)) + 1
        if card_type == 'kdj':
            n = int(params.get('n', 9))
            m1 = int(params.get('m1', 3))
            m2 = int(params.get('m2', 3))
            return n + max(m1, m2) + 5
        if card_type == 'bollinger_width':
            return int(params.get('period', 20)) + 1
        if card_type == 'day_of_week':
            return 1
        if card_type == 'sar':
            return 10
        if card_type == 'hammer_hanging':
            return 2
        if card_type == 'ma_alignment':
            return max(int(params.get('fastPeriod', 5)),
                       int(params.get('midPeriod', 10)),
                       int(params.get('slowPeriod', 20))) + 1
        if card_type == 'psy':
            return int(params.get('period', 12)) + 1
        if card_type == 'yesterday_change':
            return 3
        if card_type == 'n_day_high':
            return int(params.get('n', 20)) + 1
        if card_type == 'n_day_low':
            return int(params.get('n', 20)) + 1
        if card_type == 'consecutive_up':
            return int(params.get('n', 3)) + 2
        if card_type == 'volume_ratio':
            return 7
        if card_type == 'realtime_change':
            return 1  # 不需要历史K线，仅用于定位股票
        if card_type == 'price_limit':
            return 2
        if card_type == 'atr_breakout':
            return int(params.get('period', 14)) + 2
        # 财务指标 / 概念 / 行业不需要 K线历史
        if card_type in ('pe_below', 'pb_below', 'roe_above',
                         'total_mv_between', 'float_mv_between',
                         'float_shares_between',
                         'concept_contains', 'industry_contains',
                         'fund_flow_single'):
            return 1
        if card_type == 'supertrend':
            return int(params.get('period', 10)) + 5
        if card_type == 'cmf':
            return int(params.get('period', 20)) + 2
        if card_type == 'resonance':
            ma_long = int(params.get('maLong', 20))
            kdj_n = int(params.get('kdjN', 9))
            kdj_m1 = int(params.get('kdjM1', 3))
            kdj_m2 = int(params.get('kdjM2', 3))
            return max(ma_long, kdj_n + kdj_m1 + kdj_m2, 20) + 10
        if card_type in ('vwap_signal', 'median_signal', 'mean_signal'):
            return int(params.get('period', 60)) + 2
        if card_type == 'turnover_threshold':
            return 2
        if card_type == 'turnover_ratio':
            return int(params.get('period', 20)) + 2
        if card_type == 'trend_strength':
            st = params.get('signal_type', 'short_bottom')
            if st == 'golden_finger':
                return 130
            elif st in ('price_above_pressure', 'price_below_support'):
                return 25
            else:
                return 180
        return 100

    @staticmethod
    def _bars_to_start_date(end_date_str: str, bars: int) -> str:
        """根据所需K线数量估算起始日期（含充足缓冲）"""
        end_date = pd.to_datetime(end_date_str)
        days = max(int(bars * 2.5) + 30, 60)
        start_date = end_date - timedelta(days=days)
        return start_date.strftime('%Y-%m-%d')

    # ═══════════════════════════════════════════════════════════════
    #  批量矢量化评估器（groupby + transform / rolling）
    # ═══════════════════════════════════════════════════════════════

    def _batch_ma_cross(self, df, params):
        fast = int(params.get('fastPeriod', 5))
        slow = int(params.get('slowPeriod', 20))
        direction = params.get('direction', 'golden')

        col_f = f'_ma{fast}'
        col_s = f'_ma{slow}'

        # 使用 min_periods 确保有足够数据才计算
        df[col_f] = df.groupby('code')['close'].transform(
            lambda x: x.rolling(fast, min_periods=fast).mean()
        )
        df[col_s] = df.groupby('code')['close'].transform(
            lambda x: x.rolling(slow, min_periods=slow).mean()
        )

        # 前一天的值
        df[f'{col_f}_prev'] = df.groupby('code')[col_f].shift(1)
        df[f'{col_s}_prev'] = df.groupby('code')[col_s].shift(1)

        if direction == 'golden':
            mask = (df[f'{col_f}_prev'] <= df[f'{col_s}_prev']) & (df[col_f] > df[col_s])
        else:
            mask = (df[f'{col_f}_prev'] >= df[f'{col_s}_prev']) & (df[col_f] < df[col_s])

        # 将 mask 中的 NaN 填充为 False
        mask = mask.fillna(False)

        detail_cols = {col_f: df[col_f], col_s: df[col_s]}
        return mask, detail_cols

    def _batch_rsi(self, df, params):
        period = int(params.get('period', 14))
        oversold = float(params.get('oversold', 30))
        overbought = float(params.get('overbought', 70))
        direction = params.get('direction', 'oversold_buy')

        col_rsi = '_rsi'

        def rsi_func(close):
            diff = close.diff()
            gain = diff.clip(lower=0)
            loss = (-diff).clip(lower=0)
            avg_gain = gain.rolling(period, min_periods=period).mean()
            avg_loss = loss.rolling(period, min_periods=period).mean()
            rs = avg_gain / avg_loss.replace(0, np.nan)
            rsi = 100.0 - 100.0 / (1.0 + rs)
            rsi[avg_loss == 0] = 100.0
            return rsi

        df[col_rsi] = df.groupby('code')['close'].transform(rsi_func)

        if direction == 'oversold_buy':
            mask = df[col_rsi] < oversold
        else:
            mask = df[col_rsi] > overbought

        return mask, {col_rsi: df[col_rsi]}

    def _batch_volume(self, df, params):
        period = int(params.get('period', 20))
        multiple = float(params.get('multiple', 1.5))

        col_avg = '_vol_avg'
        col_cur = '_vol_cur'

        # 前 N 日均量（不含当日）
        df[col_avg] = df.groupby('code')['volume'].transform(
            lambda x: x.shift(1).rolling(period, min_periods=period).mean()
        )

        mask = df['volume'] > df[col_avg] * multiple

        return mask, {col_avg: df[col_avg], 'volume': df['volume']}

    def _batch_volume_contraction(self, df, params):
        period = int(params.get('period', 20))
        ratio = float(params.get('ratio', 0.6))

        col_avg = '_vc_avg'

        df[col_avg] = df.groupby('code')['volume'].transform(
            lambda x: x.shift(1).rolling(period, min_periods=period).mean()
        )

        mask = df['volume'] < df[col_avg] * ratio

        return mask, {col_avg: df[col_avg], 'volume': df['volume']}

    def _batch_macd(self, df, params):
        fast = int(params.get('fastPeriod', 12))
        slow = int(params.get('slowPeriod', 26))
        signal = int(params.get('signalPeriod', 9))
        direction = params.get('direction', 'golden')

        # 计算 EMA
        def ema(series, span):
            return series.ewm(span=span, adjust=False).mean()

        grouped = df.groupby('code')
        df['_ema_fast'] = grouped['close'].transform(lambda x: ema(x, fast))
        df['_ema_slow'] = grouped['close'].transform(lambda x: ema(x, slow))
        df['_dif'] = df['_ema_fast'] - df['_ema_slow']
        df['_dea'] = grouped['_dif'].transform(lambda x: ema(x, signal))

        # 前一天的值
        df['_dif_prev'] = grouped['_dif'].shift(1)
        df['_dea_prev'] = grouped['_dea'].shift(1)

        if direction == 'golden':
            mask = (df['_dif_prev'] <= df['_dea_prev']) & (df['_dif'] > df['_dea'])
        else:
            mask = (df['_dif_prev'] >= df['_dea_prev']) & (df['_dif'] < df['_dea'])

        mask = mask.fillna(False)
        detail_cols = {'_dif': df['_dif'], '_dea': df['_dea']}
        return mask, detail_cols

    def _batch_bollinger(self, df, params):
        period = int(params.get('period', 20))
        std_mult = float(params.get('stdMultiplier', 2))
        direction = params.get('direction', 'lower_breakout')  # 'lower_breakout' or 'upper_breakout'

        # 计算中轨 (SMA) 和标准差
        grouped = df.groupby('code')
        df['_mid'] = grouped['close'].transform(
            lambda x: x.rolling(period, min_periods=period).mean()
        )
        df['_std'] = grouped['close'].transform(
            lambda x: x.rolling(period, min_periods=period).std(ddof=0)
        )
        df['_upper'] = df['_mid'] + std_mult * df['_std']
        df['_lower'] = df['_mid'] - std_mult * df['_std']
        df['_close'] = df['close']

        if direction == 'lower_breakout':
            mask = df['_close'] < df['_lower']
        else:
            mask = df['_close'] > df['_upper']

        mask = mask.fillna(False)
        detail_cols = {
            '_mid': df['_mid'],
            '_upper': df['_upper'],
            '_lower': df['_lower'],
        }
        return mask, detail_cols

    def _batch_kdj(self, df, params):
        n = int(params.get('n', 9))
        m1 = int(params.get('m1', 3))
        m2 = int(params.get('m2', 3))
        direction = params.get('direction', 'golden')

        # 计算 RSV
        def _calc_rsv(high, low, close, n):
            high_n = high.rolling(n, min_periods=n).max()
            low_n = low.rolling(n, min_periods=n).min()
            rsv = np.where(
                high_n != low_n,
                (close - low_n) / (high_n - low_n) * 100,
                50.0
            )
            return pd.Series(rsv, index=close.index)

        grouped = df.groupby('code')
        df['_rsv'] = grouped.apply(
            lambda g: _calc_rsv(g['high'], g['low'], g['close'], n)
        ).reset_index(level=0, drop=True)

        # EMA 平滑得到 K, D
        def ema(series, alpha):
            return series.ewm(alpha=alpha, adjust=False).mean()

        alpha1 = 1.0 / m1
        alpha2 = 1.0 / m2

        df['_k'] = grouped['_rsv'].transform(lambda x: ema(x, alpha1))
        df['_d'] = grouped['_k'].transform(lambda x: ema(x, alpha2))
        df['_j'] = 3 * df['_k'] - 2 * df['_d']

        # 前一天的值
        df['_k_prev'] = grouped['_k'].shift(1)
        df['_d_prev'] = grouped['_d'].shift(1)

        if direction == 'golden':
            mask = (df['_k_prev'] <= df['_d_prev']) & (df['_k'] > df['_d'])
        else:
            mask = (df['_k_prev'] >= df['_d_prev']) & (df['_k'] < df['_d'])

        mask = mask.fillna(False)
        detail_cols = {'_k': df['_k'], '_d': df['_d'], '_j': df['_j']}
        return mask, detail_cols

    def _batch_atr_channel(self, df, params):
        period = int(params.get('period', 14))
        multiplier = float(params.get('multiplier', 2))
        direction = params.get('direction', 'upper_breakout')

        # 计算 True Range
        df['_prev_close'] = df.groupby('code')['close'].shift(1)
        df['_tr'] = np.maximum(
            df['high'] - df['low'],
            np.maximum(
                np.abs(df['high'] - df['_prev_close']),
                np.abs(df['low'] - df['_prev_close'])
            )
        )

        # Wilder 平滑 ATR
        def wilder_atr(tr, period):
            atr = tr.rolling(period, min_periods=period).mean()
            # 指数平滑: atr[i] = (atr[i-1]*(period-1) + tr[i]) / period
            for i in range(period, len(atr)):
                if not np.isnan(atr.iloc[i - 1]):
                    atr.iloc[i] = (atr.iloc[i - 1] * (period - 1) + tr.iloc[i]) / period
            return atr

        grouped = df.groupby('code')
        df['_atr'] = grouped['_tr'].transform(lambda x: wilder_atr(x, period))
        df['_mid'] = grouped['close'].transform(
            lambda x: x.rolling(period, min_periods=period).mean()
        )
        df['_upper'] = df['_mid'] + multiplier * df['_atr']
        df['_lower'] = df['_mid'] - multiplier * df['_atr']
        df['_close'] = df['close']

        if direction == 'upper_breakout':
            mask = df['_close'] > df['_upper']
        else:
            mask = df['_close'] < df['_lower']

        mask = mask.fillna(False)
        detail_cols = {'_mid': df['_mid'], '_upper': df['_upper'], '_lower': df['_lower']}
        return mask, detail_cols

    def _batch_cci(self, df, params):
        period = int(params.get('period', 20))
        oversold = float(params.get('oversold', -100))
        overbought = float(params.get('overbought', 100))
        direction = params.get('direction', 'oversold_buy')

        # 典型价格 TP = (high + low + close) / 3
        df['_tp'] = (df['high'] + df['low'] + df['close']) / 3

        grouped = df.groupby('code')
        df['_tp_sma'] = grouped['_tp'].transform(
            lambda x: x.rolling(period, min_periods=period).mean()
        )
        # 平均偏差 MD = mean(|TP - TP_sma|)
        df['_abs_dev'] = (df['_tp'] - df['_tp_sma']).abs()
        df['_md'] = grouped['_abs_dev'].transform(
            lambda x: x.rolling(period, min_periods=period).mean()
        )
        df['_cci'] = np.where(
            df['_md'] != 0,
            (df['_tp'] - df['_tp_sma']) / (0.015 * df['_md']),
            0.0
        )

        if direction == 'oversold_buy':
            mask = df['_cci'] < oversold
        else:
            mask = df['_cci'] > overbought

        mask = mask.fillna(False)
        detail_cols = {'_cci': df['_cci']}
        return mask, detail_cols

    def _batch_williams_r(self, df, params):
        period = int(params.get('period', 14))
        oversold = float(params.get('oversold', -80))
        overbought = float(params.get('overbought', -20))

        grouped = df.groupby('code')
        df['_high_n'] = grouped['high'].transform(
            lambda x: x.rolling(period, min_periods=period).max()
        )
        df['_low_n'] = grouped['low'].transform(
            lambda x: x.rolling(period, min_periods=period).min()
        )
        df['_wr'] = np.where(
            df['_high_n'] != df['_low_n'],
            -100 * (df['_high_n'] - df['close']) / (df['_high_n'] - df['_low_n']),
            -50.0
        )

        # 默认买入信号为超卖 (< -80)
        mask = df['_wr'] < oversold
        mask = mask.fillna(False)
        detail_cols = {'_wr': df['_wr']}
        return mask, detail_cols

    def _batch_obv(self, df, params):
        period = int(params.get('period', 20))

        # OBV 累积计算
        def _calc_obv(close, volume):
            obv = np.zeros(len(close))
            for i in range(1, len(close)):
                if close[i] > close[i - 1]:
                    obv[i] = obv[i - 1] + volume[i]
                elif close[i] < close[i - 1]:
                    obv[i] = obv[i - 1] - volume[i]
                else:
                    obv[i] = obv[i - 1]
            return obv

        grouped = df.groupby('code')
        df['_obv'] = grouped.apply(
            lambda g: pd.Series(_calc_obv(g['close'].values, g['volume'].values), index=g.index)
        ).reset_index(level=0, drop=True)

        df['_obv_ma'] = grouped['_obv'].transform(
            lambda x: x.rolling(period, min_periods=period).mean()
        )
        df['_obv_prev'] = grouped['_obv'].shift(1)
        df['_obv_ma_prev'] = grouped['_obv_ma'].shift(1)

        # 金叉买入：OBV 上穿 MA
        mask = (df['_obv_prev'] <= df['_obv_ma_prev']) & (df['_obv'] > df['_obv_ma'])
        mask = mask.fillna(False)
        detail_cols = {'_obv': df['_obv'], '_obv_ma': df['_obv_ma']}
        return mask, detail_cols

    def _batch_roc(self, df, params):
        period = int(params.get('period', 12))
        use_zero_cross = params.get('useZeroCross', 'true') == 'true'
        threshold = float(params.get('threshold', 5))

        grouped = df.groupby('code')
        df['_roc'] = (df['close'] - df.groupby('code')['close'].shift(period)) / df.groupby('code')['close'].shift(
            period) * 100
        df['_roc_prev'] = grouped['_roc'].shift(1)

        if use_zero_cross:
            # 穿越零轴：昨日 <= 0 且今日 > 0
            mask = (df['_roc_prev'] <= 0) & (df['_roc'] > 0)
        else:
            # 阈值突破
            mask = df['_roc'] > threshold

        mask = mask.fillna(False)
        detail_cols = {'_roc': df['_roc']}
        return mask, detail_cols

    # ── 财务数据批量评估器 ───────────────────────────────────────

    def _load_financial_dict(self) -> dict:
        """加载 stock_financial 表到以 ts_code 为 key 的字典。"""
        try:
            df = pd.read_sql("SELECT * FROM stock_financial", self.db.engine)
            if df.empty:
                return {}
            result = {}
            for _, row in df.iterrows():
                result[row['ts_code']] = {
                    'pe_ttm': row.get('pe_ttm'),
                    'pb': row.get('pb'),
                    'roe': row.get('roe'),
                    'total_mv': row.get('total_mv'),
                    'float_mv': row.get('total_mv'),  # DB 无 float_mv，用 total_mv 近似
                    'float_shares': row.get('float_shares'),
                }
            return result
        except Exception:
            return {}

    def _batch_pe_below(self, df, params):
        max_pe = float(params.get('maxPE', 20))
        fin = self._load_financial_dict()

        def get_mask(code_series):
            result = pd.Series(False, index=code_series.index)
            for idx, code in code_series.items():
                ts_codes = self._codes_to_ts_codes([code])
                for ts in ts_codes:
                    f = fin.get(ts, {})
                    pe = f.get('pe_ttm')
                    if pe is not None and pe > 0 and pe < max_pe:
                        result[idx] = True
                        break
            return result

        mask = df.groupby('code')['code'].transform(get_mask)
        # 添加 PE 值作为详情列（基于当天数据）
        pe_col = '_pe_ttm'
        fin_df = pd.DataFrame([
            {'code': ts.split('.')[0], 'pe_ttm': f.get('pe_ttm')}
            for ts, f in fin.items()
        ])
        if not fin_df.empty:
            df['_tmp_idx'] = df.index
            merged = df[['code', '_tmp_idx']].merge(fin_df, on='code', how='left')
            merged = merged.set_index('_tmp_idx')
            df[pe_col] = merged['pe_ttm'].values
        else:
            df[pe_col] = np.nan

        detail_cols = {pe_col: df[pe_col]}
        return mask, detail_cols

    def _batch_pb_below(self, df, params):
        max_pb = float(params.get('maxPB', 2))
        fin = self._load_financial_dict()

        def get_mask(code_series):
            result = pd.Series(False, index=code_series.index)
            for idx, code in code_series.items():
                ts_codes = self._codes_to_ts_codes([code])
                for ts in ts_codes:
                    f = fin.get(ts, {})
                    pb = f.get('pb')
                    if pb is not None and pb > 0 and pb < max_pb:
                        result[idx] = True
                        break
            return result

        mask = df.groupby('code')['code'].transform(get_mask)
        pb_col = '_pb'
        fin_df = pd.DataFrame([
            {'code': ts.split('.')[0], 'pb': f.get('pb')}
            for ts, f in fin.items()
        ])
        if not fin_df.empty:
            df['_tmp_idx'] = df.index
            merged = df[['code', '_tmp_idx']].merge(fin_df, on='code', how='left')
            merged = merged.set_index('_tmp_idx')
            df[pb_col] = merged['pb'].values
        else:
            df[pb_col] = np.nan

        detail_cols = {pb_col: df[pb_col]}
        return mask, detail_cols

    def _batch_roe_above(self, df, params):
        min_roe = float(params.get('minROE', 15))
        fin = self._load_financial_dict()

        def get_mask(code_series):
            result = pd.Series(False, index=code_series.index)
            for idx, code in code_series.items():
                ts_codes = self._codes_to_ts_codes([code])
                for ts in ts_codes:
                    f = fin.get(ts, {})
                    roe = f.get('roe')
                    if roe is not None and roe > min_roe:
                        result[idx] = True
                        break
            return result

        mask = df.groupby('code')['code'].transform(get_mask)
        roe_col = '_roe'
        fin_df = pd.DataFrame([
            {'code': ts.split('.')[0], 'roe': f.get('roe')}
            for ts, f in fin.items()
        ])
        if not fin_df.empty:
            df['_tmp_idx'] = df.index
            merged = df[['code', '_tmp_idx']].merge(fin_df, on='code', how='left')
            merged = merged.set_index('_tmp_idx')
            df[roe_col] = merged['roe'].values
        else:
            df[roe_col] = np.nan

        detail_cols = {roe_col: df[roe_col]}
        return mask, detail_cols

    def _batch_total_mv_between(self, df, params):
        """总市值区间筛选（单位：亿元）。"""
        min_mv = params.get('min', None)
        max_mv = params.get('max', None)

        # 解析参数：空字符串或 None 表示无界限
        try:
            min_mv = float(min_mv) if min_mv not in (None, '') else None
        except (ValueError, TypeError):
            min_mv = None
        try:
            max_mv = float(max_mv) if max_mv not in (None, '') else None
        except (ValueError, TypeError):
            max_mv = None

        fin = self._load_financial_dict()
        mv_map = {}
        for ts, f in fin.items():
            mv = f.get('total_mv')
            if mv is not None:
                pure = ts.split('.')[0]
                mv_map[pure] = float(mv)

        mv_col = '_total_mv'
        df[mv_col] = df['code'].map(mv_map)

        mask = pd.Series(True, index=df.index)
        if min_mv is not None:
            mask = mask & (df[mv_col] >= min_mv)
        if max_mv is not None:
            mask = mask & (df[mv_col] <= max_mv)
        # NaN 视为不满足
        mask = mask & df[mv_col].notna()
        mask = mask.fillna(False)

        detail_cols = {mv_col: df[mv_col]}
        return mask, detail_cols

    def _batch_float_mv_between(self, df, params):
        """流通市值区间筛选（单位：亿元）。DB 无 float_mv 字段，以 total_mv 近似。"""
        min_mv = params.get('min', None)
        max_mv = params.get('max', None)

        try:
            min_mv = float(min_mv) if min_mv not in (None, '') else None
        except (ValueError, TypeError):
            min_mv = None
        try:
            max_mv = float(max_mv) if max_mv not in (None, '') else None
        except (ValueError, TypeError):
            max_mv = None

        fin = self._load_financial_dict()
        mv_map = {}
        for ts, f in fin.items():
            mv = f.get('float_mv')
            if mv is not None:
                pure = ts.split('.')[0]
                mv_map[pure] = float(mv)

        mv_col = '_float_mv'
        df[mv_col] = df['code'].map(mv_map)

        mask = pd.Series(True, index=df.index)
        if min_mv is not None:
            mask = mask & (df[mv_col] >= min_mv)
        if max_mv is not None:
            mask = mask & (df[mv_col] <= max_mv)
        mask = mask & df[mv_col].notna()
        mask = mask.fillna(False)

        detail_cols = {mv_col: df[mv_col]}
        return mask, detail_cols

    def _batch_float_shares_between(self, df, params):
        """流通股本区间筛选（单位：亿股）。"""
        min_fs = params.get('min', None)
        max_fs = params.get('max', None)

        try:
            min_fs = float(min_fs) if min_fs not in (None, '') else None
        except (ValueError, TypeError):
            min_fs = None
        try:
            max_fs = float(max_fs) if max_fs not in (None, '') else None
        except (ValueError, TypeError):
            max_fs = None

        fin = self._load_financial_dict()
        fs_map = {}
        for ts, f in fin.items():
            fs = f.get('float_shares')
            if fs is not None:
                pure = ts.split('.')[0]
                fs_map[pure] = float(fs)

        fs_col = '_float_shares'
        df[fs_col] = df['code'].map(fs_map)

        mask = pd.Series(True, index=df.index)
        if min_fs is not None:
            mask = mask & (df[fs_col] >= min_fs)
        if max_fs is not None:
            mask = mask & (df[fs_col] <= max_fs)
        mask = mask & df[fs_col].notna()
        mask = mask.fillna(False)

        detail_cols = {fs_col: df[fs_col]}
        return mask, detail_cols

    # ── 概念 / 行业批量评估器 ─────────────────────────────────────

    def _load_concept_dict(self) -> dict:
        """返回 { pure_code: [concept_name1, concept_name2, ...] }，按纯数字代码索引"""
        try:
            sql = """
                SELECT sc.ts_code, c.concept_name
                FROM stock_concept sc
                JOIN concept c ON sc.concept_id = c.concept_id
            """
            df = pd.read_sql(sql, self.db.engine)
            result = {}
            for _, row in df.iterrows():
                code = row['ts_code'].replace('.SZ', '').replace('.SH', '').replace('.BJ', '')
                result.setdefault(code, []).append(row['concept_name'])
            return result
        except Exception:
            return {}

    def _load_industry_dict(self) -> dict:
        """返回 { pure_code: industry_level1 }，按纯数字代码索引"""
        try:
            sql = "SELECT ts_code, industry_level1 FROM stock_industry_detail"
            df = pd.read_sql(sql, self.db.engine)
            result = {}
            for _, row in df.iterrows():
                code = row['ts_code'].replace('.SZ', '').replace('.SH', '').replace('.BJ', '')
                if row['industry_level1']:
                    result[code] = row['industry_level1']
            return result
        except Exception:
            return {}

    def _batch_concept_contains(self, df, params):
        target_concepts = params.get('concepts', [])
        match_mode = params.get('match_mode', 'any')
        if not target_concepts:
            mask = pd.Series(False, index=df.index)
            return mask, {}

        if not hasattr(self, '_concept_cache'):
            self._concept_cache = self._load_concept_dict()

        concept_set = set(target_concepts)
        code_series = df['code']

        if match_mode == 'any':
            mask = code_series.apply(
                lambda c: bool(concept_set & set(self._concept_cache.get(c, [])))
            )
        else:
            mask = code_series.apply(
                lambda c: concept_set <= set(self._concept_cache.get(c, []))
            )

        mask = mask.fillna(False)
        detail_cols = {
            'matched_concepts': code_series.apply(
                lambda c: ','.join(sorted(concept_set & set(self._concept_cache.get(c, []))))
            )
        }
        return mask, detail_cols

    def _batch_industry_contains(self, df, params):
        target_industry = params.get('industry', '')
        if not target_industry:
            mask = pd.Series(False, index=df.index)
            return mask, {}

        if not hasattr(self, '_industry_cache'):
            self._industry_cache = self._load_industry_dict()

        mask = df['code'].apply(
            lambda c: self._industry_cache.get(c) == target_industry
        ).fillna(False)

        detail_cols = {
            'industry': df['code'].apply(lambda c: self._industry_cache.get(c, ''))
        }
        return mask, detail_cols

    def _batch_day_of_week(self, df, params):
        target_day = int(params.get('targetDay', 4))
        mask = df['trade_date'].dt.dayofweek == target_day
        mask = mask.fillna(False)
        detail_cols = {'_day_of_week': df['trade_date'].dt.dayofweek}
        return mask, detail_cols

    def _batch_bollinger_width(self, df, params):
        period = int(params.get('period', 20))
        std_mult = float(params.get('stdMultiplier', 2))
        width_threshold = float(params.get('widthThreshold', 0.1))

        grouped = df.groupby('code')
        mid = grouped['close'].transform(
            lambda x: x.rolling(period, min_periods=period).mean()
        )
        std = grouped['close'].transform(
            lambda x: x.rolling(period, min_periods=period).std(ddof=0)
        )
        width = (2 * std_mult * std) / mid.replace(0, np.nan)

        mask = width < width_threshold
        mask = mask.fillna(False)
        detail_cols = {'_bb_width': width}
        return mask, detail_cols

    def _batch_sar(self, df, params):
        acceleration = float(params.get('acceleration', 0.02))
        max_accel = float(params.get('maxAcceleration', 0.2))

        def calc_sar(group):
            high = group['high'].values
            low = group['low'].values
            n = len(high)
            sar_vals = np.full(n, np.nan)

            if n < 2:
                return pd.Series(sar_vals, index=group.index)

            trend_up = True
            ep = high[0]
            af = acceleration
            sar_vals[0] = low[0]

            for i in range(1, n):
                prev_sar = sar_vals[i - 1]
                if np.isnan(prev_sar):
                    sar_vals[i] = low[i]
                    ep = high[i]
                    af = acceleration
                    continue

                sar_vals[i] = prev_sar + af * (ep - prev_sar)

                if trend_up:
                    sar_vals[i] = min(sar_vals[i], low[i - 1])
                    if i >= 2:
                        sar_vals[i] = min(sar_vals[i], low[i - 2])
                    if high[i] > ep:
                        ep = high[i]
                        af = min(af + acceleration, max_accel)
                    if low[i] < sar_vals[i]:
                        trend_up = False
                        sar_vals[i] = ep
                        ep = low[i]
                        af = acceleration
                else:
                    sar_vals[i] = max(sar_vals[i], high[i - 1])
                    if i >= 2:
                        sar_vals[i] = max(sar_vals[i], high[i - 2])
                    if low[i] < ep:
                        ep = low[i]
                        af = min(af + acceleration, max_accel)
                    if high[i] > sar_vals[i]:
                        trend_up = True
                        sar_vals[i] = ep
                        ep = high[i]
                        af = acceleration

            return pd.Series(sar_vals, index=group.index)

        grouped = df.groupby('code')
        df['_sar'] = grouped.apply(calc_sar).reset_index(level=0, drop=True)
        df['_close_prev'] = grouped['close'].shift(1)
        df['_sar_prev'] = grouped['_sar'].shift(1)

        mask = (df['_close_prev'] <= df['_sar_prev']) & (df['close'] > df['_sar'])
        mask = mask.fillna(False)
        detail_cols = {'_sar': df['_sar']}
        return mask, detail_cols

    def _batch_hammer_hanging(self, df, params):
        body_ratio_max = float(params.get('bodyRatio', 0.3))
        shadow_ratio_min = float(params.get('shadowRatio', 0.6))

        body = (df['close'] - df['open']).abs()
        total_range = df['high'] - df['low']
        upper_shadow = df['high'] - df[['open', 'close']].max(axis=1)
        lower_shadow = df[['open', 'close']].min(axis=1) - df['low']

        valid = total_range > 0
        tr = total_range.replace(0, np.nan)
        br = body / tr
        lsr = lower_shadow / tr
        usr = upper_shadow / tr

        # Hammer: small body, long lower shadow, small upper shadow
        mask = valid & (br <= body_ratio_max) & (lsr >= shadow_ratio_min) & (usr <= 0.3)
        mask = mask.fillna(False)
        detail_cols = {'_body_ratio': br, '_lower_shadow': lsr}
        return mask, detail_cols

    def _batch_ma_alignment(self, df, params):
        fast = int(params.get('fastPeriod', 5))
        mid_p = int(params.get('midPeriod', 10))
        slow = int(params.get('slowPeriod', 20))
        direction = params.get('direction', 'bullish')

        grouped = df.groupby('code')
        ma_fast = grouped['close'].transform(
            lambda x: x.rolling(fast, min_periods=fast).mean()
        )
        ma_mid = grouped['close'].transform(
            lambda x: x.rolling(mid_p, min_periods=mid_p).mean()
        )
        ma_slow = grouped['close'].transform(
            lambda x: x.rolling(slow, min_periods=slow).mean()
        )

        if direction == 'bullish':
            mask = (ma_fast > ma_mid) & (ma_mid > ma_slow)
        else:
            mask = (ma_fast < ma_mid) & (ma_mid < ma_slow)

        mask = mask.fillna(False)
        detail_cols = {'_ma_fast': ma_fast, '_ma_mid': ma_mid, '_ma_slow': ma_slow}
        return mask, detail_cols

    def _batch_psy(self, df, params):
        period = int(params.get('period', 12))
        oversold = float(params.get('oversold', 25))

        grouped = df.groupby('code')
        is_up = (df['close'] > grouped['close'].shift(1)).astype(int)
        psy = is_up.groupby(df['code']).transform(
            lambda x: x.rolling(period, min_periods=period).mean() * 100
        )

        mask = psy < oversold
        mask = mask.fillna(False)
        detail_cols = {'_psy': psy}
        return mask, detail_cols

    def _batch_price_limit(self, df, params):
        limit_type = params.get('limitType', 'no_buy_on_limit_up')

        grouped = df.groupby('code')
        prev_close = grouped['close'].shift(1)
        limit_up = (prev_close * 1.10).round(2)
        limit_down = (prev_close * 0.90).round(2)

        is_limit_up = df['high'] >= limit_up
        is_limit_down = df['low'] <= limit_down

        if limit_type == 'no_buy_on_limit_up':
            mask = ~is_limit_up
        elif limit_type == 'no_sell_on_limit_down':
            mask = ~is_limit_down
        else:
            mask = ~is_limit_up & ~is_limit_down

        mask = mask.fillna(True)
        detail_cols = {'_is_limit_up': is_limit_up, '_is_limit_down': is_limit_down}
        return mask, detail_cols

    def _batch_yesterday_change(self, df, params):
        min_change = float(params.get('minChange', 3))
        max_change = float(params.get('maxChange', 10))
        include_limit_up = params.get('includeLimitUp', 'yes') == 'yes'
        direction = params.get('direction', 'up')

        grouped = df.groupby('code')
        prev_close = grouped['close'].shift(1)
        pct_change = (df['close'] - prev_close) / prev_close.replace(0, np.nan) * 100

        if direction == 'up':
            mask = (pct_change >= min_change) & (pct_change <= max_change)
        elif direction == 'down':
            min_change_abs = abs(min_change)
            max_change_abs = abs(max_change)
            mask = (pct_change <= -min_change_abs) & (pct_change >= -max_change_abs)
        else:
            abs_ch = pct_change.abs()
            mask = (abs_ch >= abs(min_change)) & (abs_ch <= abs(max_change))

        if not include_limit_up:
            limit_up_price = (prev_close * 1.10).round(2)
            is_limit_up = df['close'] >= limit_up_price
            mask = mask & ~is_limit_up

        mask = mask.fillna(False)
        detail_cols = {'_pct_change': pct_change}
        return mask, detail_cols

    def _batch_n_day_high(self, df, params):
        n = int(params.get('n', 20))

        grouped = df.groupby('code')
        rolling_max = grouped['high'].transform(
            lambda x: x.rolling(n, min_periods=n).max()
        )
        prev_max = grouped['high'].transform(
            lambda x: x.shift(1).rolling(n - 1, min_periods=n - 1).max()
        )

        mask = (df['high'] >= rolling_max) & (df['high'] > prev_max.fillna(-np.inf))
        mask = mask.fillna(False)
        detail_cols = {'_n_high': df['high'], '_n_max': rolling_max}
        return mask, detail_cols

    def _batch_n_day_low(self, df, params):
        n = int(params.get('n', 20))

        grouped = df.groupby('code')
        rolling_min = grouped['low'].transform(
            lambda x: x.rolling(n, min_periods=n).min()
        )
        prev_min = grouped['low'].transform(
            lambda x: x.shift(1).rolling(n - 1, min_periods=n - 1).min()
        )

        mask = (df['low'] <= rolling_min) & (df['low'] < prev_min.fillna(np.inf))
        mask = mask.fillna(False)
        detail_cols = {'_n_low': df['low'], '_n_min': rolling_min}
        return mask, detail_cols

    def _batch_consecutive_up(self, df, params):
        n = int(params.get('n', 3))

        grouped = df.groupby('code')
        df['_is_up'] = (df['close'] > grouped['close'].shift(1)).astype(int)
        consec = grouped['_is_up'].transform(
            lambda x: x.rolling(n, min_periods=n).sum()
        )

        mask = consec >= n
        mask = mask.fillna(False)
        detail_cols = {'_consec_up': consec}
        return mask, detail_cols

    def _batch_volume_ratio(self, df, params):
        min_ratio = float(params.get('minRatio', 1.5))
        max_ratio = float(params.get('maxRatio', 5))

        grouped = df.groupby('code')
        avg_vol_5 = grouped['volume'].transform(
            lambda x: x.shift(1).rolling(5, min_periods=5).mean()
        )
        vol_ratio = df['volume'] / avg_vol_5.replace(0, np.nan)

        mask = (vol_ratio >= min_ratio) & (vol_ratio <= max_ratio)
        mask = mask.fillna(False)
        detail_cols = {'_vol_ratio': vol_ratio}
        return mask, detail_cols

    def _get_realtime_quotes_cached(self, codes):
        """获取实时行情（带缓存）。

        TTL 内已缓存的代码直接复用，只对过期/缺失的代码发起批量请求。
        """
        now = time.time()
        result = {}
        miss = []

        for c in codes:
            entry = self._realtime_cache.get(c)
            if entry and (now - entry[0]) < self._CACHE_TTL:
                result[c] = entry[1]
            else:
                miss.append(c)

        if miss:
            print(f"[Screener] 实时行情缓存未命中: {len(miss)} 只，正在批量获取...")
            fetched = self.data_feed.get_realtime_quotes_batch(miss)
            for c, data in fetched.items():
                self._realtime_cache[c] = (now, data)
                result[c] = data
            # 获取失败的代码也标记（避免短时间内重复请求同一批失败代码）
            for c in miss:
                if c not in fetched:
                    self._realtime_cache[c] = (now, None)

        return result

    def _batch_realtime_change(self, df, params):
        """批量评估实时涨跌幅条件。

        通过腾讯批量接口获取实时行情，使用 10 秒缓存避免重复请求。
        不依赖K线历史数据，仅对 DataFrame 中的股票代码进行实时查询。

        :param df: 包含 code 列的 DataFrame
        :param params: {minChange, maxChange}
        :return: (mask, detail_cols)
        """
        min_change = float(params.get('minChange', -20))
        max_change = float(params.get('maxChange', 20))

        # 获取唯一代码列表 → 批量查询实时行情
        codes = df['code'].unique().tolist()
        quotes = self._get_realtime_quotes_cached(codes)

        # 构建 code → change_pct 映射
        change_map = {}
        for code, q in quotes.items():
            if q and q.get('change_pct') is not None:
                change_map[code] = q['change_pct']

        if not change_map:
            # 全部获取失败，返回全 False
            df['_rt_change'] = np.nan
            mask = pd.Series(False, index=df.index)
            detail_cols = {'_rt_change': df['_rt_change']}
            return mask, detail_cols

        # 映射到每一行
        df['_rt_change'] = df['code'].map(change_map)

        # 范围筛选
        mask = (df['_rt_change'] >= min_change) & (df['_rt_change'] <= max_change)
        mask = mask.fillna(False)

        detail_cols = {'_rt_change': df['_rt_change']}
        return mask, detail_cols

    def _batch_fund_flow_single(self, df, params):
        """批量筛选单日资金流向。
        从 fund_flow_history 表中取基准日期的数据；若无则取最近一日。
        """
        field = params.get('field', 'main_net')
        direction = params.get('direction', 'gt')
        threshold = float(params.get('threshold', 5000))

        target_date = df['trade_date'].max().strftime('%Y-%m-%d')

        sql = text("""
            SELECT ts_code, trade_date, main_net, super_net, big_net, medium_net, small_net
            FROM fund_flow_history
            WHERE trade_date <= :target_date
            ORDER BY trade_date DESC
        """)
        try:
            with self.db.engine.connect() as conn:
                rows = conn.execute(sql, {"target_date": target_date}).fetchall()
        except Exception as e:
            print(f"[Screener] 资金流向数据查询失败: {e}")
            df['_ff_value'] = None
            mask = pd.Series(False, index=df.index)
            return mask, {'_ff_value': df['_ff_value']}

        if not rows:
            print("[Screener] fund_flow_history 无数据")
            df['_ff_value'] = None
            mask = pd.Series(False, index=df.index)
            return mask, {'_ff_value': df['_ff_value']}

        ff_df = pd.DataFrame(rows, columns=['ts_code', 'trade_date', 'main_net', 'super_net', 'big_net', 'medium_net', 'small_net'])
        ff_df = ff_df.drop_duplicates(subset=['ts_code'], keep='first')
        ff_df['code'] = ff_df['ts_code'].str.replace(r'\.(SZ|SH|BJ)$', '', regex=True)

        detail_key = f'_fund_flow_{field}'
        val_map = dict(zip(ff_df['code'], ff_df[field]))
        df[detail_key] = df['code'].map(val_map)

        if direction == 'gt':
            mask = df[detail_key] > threshold
        else:
            mask = df[detail_key] < threshold

        mask = mask.fillna(False)
        print(f"[Screener] fund_flow_single 掩码命中: {mask.sum()} 行 (总 {len(mask)} 行)")
        detail_cols = {detail_key: df[detail_key]}
        return mask, detail_cols

    # ── 超级趋势 ───────────────────────────────────────────────

    def _batch_supertrend(self, df, params):
        period = int(params.get('period', 10))
        multiplier = float(params.get('multiplier', 3))
        direction = params.get('direction', 'trend_up')

        def calc_supertrend(group):
            high = group['high'].values
            low = group['low'].values
            close = group['close'].values
            n = len(high)

            if n <= period:
                return pd.DataFrame({
                    '_supertrend_trend': np.full(n, np.nan),
                    '_supertrend_line': np.full(n, np.nan),
                }, index=group.index)

            prev_close = np.roll(close, 1)
            prev_close[0] = close[0]
            tr = np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))

            atr = np.full(n, np.nan)
            atr[period] = np.mean(tr[1:period + 1])
            for j in range(period + 1, n):
                atr[j] = (atr[j - 1] * (period - 1) + tr[j]) / period

            src = (high + low + close) / 3
            basic_upper = src + multiplier * atr
            basic_lower = src - multiplier * atr

            trend = np.zeros(n)
            trend_line = np.zeros(n)
            curr_trend = 1
            start = period
            trend[start] = curr_trend
            trend_line[start] = basic_lower[start] if curr_trend == 1 else basic_upper[start]
            for j in range(start + 1, n):
                if curr_trend == 1:
                    if close[j] > trend_line[j - 1]:
                        trend[j] = 1
                        trend_line[j] = max(basic_lower[j], trend_line[j - 1])
                    else:
                        curr_trend = -1
                        trend[j] = -1
                        trend_line[j] = basic_upper[j]
                else:
                    if close[j] < trend_line[j - 1]:
                        trend[j] = -1
                        trend_line[j] = min(basic_upper[j], trend_line[j - 1])
                    else:
                        curr_trend = 1
                        trend[j] = 1
                        trend_line[j] = basic_lower[j]

            return pd.DataFrame({
                '_supertrend_trend': trend,
                '_supertrend_line': trend_line,
            }, index=group.index)

        result = df.groupby('code', group_keys=False).apply(calc_supertrend)
        df['_supertrend_trend'] = result['_supertrend_trend']
        df['_supertrend_line'] = result['_supertrend_line']

        if direction == 'trend_up':
            mask = df['_supertrend_trend'] == 1
        else:
            mask = df['_supertrend_trend'] == -1

        mask = mask.fillna(False)
        detail_cols = {'_supertrend_trend': df['_supertrend_trend'], '_supertrend_line': df['_supertrend_line']}
        return mask, detail_cols

    # ── CMF 资金流指标 ─────────────────────────────────────────

    def _batch_cmf(self, df, params):
        period = int(params.get('period', 20))
        threshold = float(params.get('threshold', 0.1))
        direction = params.get('direction', 'gt')

        h_l_range = df['high'] - df['low']
        h_l_range = h_l_range.replace(0, 1e-10)
        df['_mfm'] = ((df['close'] - df['low']) - (df['high'] - df['close'])) / h_l_range
        df['_mfv'] = df['_mfm'] * df['volume']

        grouped = df.groupby('code')
        df['_sum_mfv'] = grouped['_mfv'].transform(
            lambda x: x.rolling(period, min_periods=period).sum()
        )
        df['_sum_vol'] = grouped['volume'].transform(
            lambda x: x.rolling(period, min_periods=period).sum()
        )
        df['_cmf_value'] = df['_sum_mfv'] / df['_sum_vol'].replace(0, 1)

        if direction == 'gt':
            mask = df['_cmf_value'] > threshold
        else:
            mask = df['_cmf_value'] < -threshold

        mask = mask.fillna(False)
        detail_cols = {'_cmf_value': df['_cmf_value']}
        return mask, detail_cols

    # ── 共振指标 ───────────────────────────────────────────────

    def _batch_resonance(self, df, params):
        rsi_oversold = float(params.get('rsiOversold', 30))
        ma_short = int(params.get('maShort', 5))
        ma_mid = int(params.get('maMid', 10))
        ma_long = int(params.get('maLong', 20))
        kdj_n = int(params.get('kdjN', 9))
        kdj_m1 = int(params.get('kdjM1', 3))
        kdj_m2 = int(params.get('kdjM2', 3))
        res_threshold = int(params.get('threshold', 3))

        max_period = max(ma_long, kdj_n + kdj_m1 + kdj_m2, 20)

        def calc_resonance(group):
            high = group['high'].values
            low = group['low'].values
            close = group['close'].values
            n = len(close)

            score = np.full(n, np.nan)
            if n < max_period + 5:
                return pd.DataFrame({'_resonance_score': score}, index=group.index)

            # RSI (Wilder smoothed, period=14)
            rsi = np.full(n, np.nan)
            delta = np.diff(close)
            gain = np.where(delta > 0, delta, 0)
            loss = np.where(delta < 0, -delta, 0)
            if n > 14:
                avg_gain = np.mean(gain[:14])
                avg_loss = np.mean(loss[:14])
                rsi[14] = 100 - 100 / (1 + avg_gain / avg_loss) if avg_loss > 0 else 100
                for j in range(15, n):
                    avg_gain = (avg_gain * 13 + gain[j - 1]) / 14
                    avg_loss = (avg_loss * 13 + loss[j - 1]) / 14
                    rsi[j] = 100 - 100 / (1 + avg_gain / avg_loss) if avg_loss > 0 else 100

            # KDJ
            k_arr = np.full(n, np.nan)
            d_arr = np.full(n, np.nan)
            if n > kdj_n:
                low_n = np.array([np.min(low[max(0, j - kdj_n + 1):j + 1]) for j in range(n)])
                high_n = np.array([np.max(high[max(0, j - kdj_n + 1):j + 1]) for j in range(n)])
                rsv = np.where(high_n - low_n > 0, (close - low_n) / (high_n - low_n) * 100, 50)
                k_arr[kdj_n - 1] = 50
                d_arr[kdj_n - 1] = 50
                for j in range(kdj_n, n):
                    k_arr[j] = k_arr[j - 1] * (kdj_m1 - 1) / kdj_m1 + rsv[j] / kdj_m1
                    d_arr[j] = d_arr[j - 1] * (kdj_m2 - 1) / kdj_m2 + k_arr[j] / kdj_m2

            # MACD (EMA 12/26/9)
            dif = np.full(n, np.nan)
            dea = np.full(n, np.nan)
            if n >= 34:
                ema12 = np.full(n, np.nan)
                ema26 = np.full(n, np.nan)
                ema12[11] = np.mean(close[:12])
                ema26[25] = np.mean(close[:26])
                for j in range(12, n):
                    ema12[j] = close[j] * 2 / 13 + ema12[j - 1] * 11 / 13
                for j in range(26, n):
                    ema26[j] = close[j] * 2 / 27 + ema26[j - 1] * 25 / 27
                dif = ema12 - ema26
                dea[33] = np.mean(dif[26:34])
                for j in range(34, n):
                    dea[j] = dif[j] * 2 / 10 + dea[j - 1] * 8 / 10

            # MA
            ma_s = np.convolve(close, np.ones(ma_short) / ma_short, 'valid')
            ma_m = np.convolve(close, np.ones(ma_mid) / ma_mid, 'valid')
            ma_l = np.convolve(close, np.ones(ma_long) / ma_long, 'valid')

            # Score
            score_start = max(ma_long - 1, kdj_n + 1, 34)
            for j in range(score_start, n):
                cnt = 0
                if not np.isnan(rsi[j]) and rsi[j] < rsi_oversold:
                    cnt += 1
                if not np.isnan(k_arr[j]) and not np.isnan(d_arr[j]) and j >= 1:
                    if k_arr[j - 1] <= d_arr[j - 1] and k_arr[j] > d_arr[j]:
                        cnt += 1
                if not np.isnan(dif[j]) and not np.isnan(dea[j]) and j >= 1:
                    if dif[j - 1] <= dea[j - 1] and dif[j] > dea[j]:
                        cnt += 1
                ma_s_idx = j - (ma_short - 1)
                ma_m_idx = j - (ma_mid - 1)
                ma_l_idx = j - (ma_long - 1)
                if ma_s_idx >= 0 and ma_m_idx >= 0 and ma_l_idx >= 0:
                    if ma_s[ma_s_idx] > ma_m[ma_m_idx] and ma_m[ma_m_idx] > ma_l[ma_l_idx]:
                        cnt += 1
                score[j] = cnt

            return pd.DataFrame({'_resonance_score': score}, index=group.index)

        result = df.groupby('code', group_keys=False).apply(calc_resonance)
        df['_resonance_score'] = result['_resonance_score']

        mask = df['_resonance_score'] >= res_threshold
        mask = mask.fillna(False)
        detail_cols = {'_resonance_score': df['_resonance_score']}
        return mask, detail_cols

    # ── 七脉神剑 ───────────────────────────────────────────────

    def _batch_seven_swords(self, df, params):
        min_bullish = int(params.get('minBullish', 4))
        use_vol = params.get('useVol', 'true') != 'false'
        use_cci = params.get('useCCI', 'true') != 'false'
        use_macd = params.get('useMACD', 'true') != 'false'
        use_sar = params.get('useSAR', 'true') != 'false'
        use_rsi = params.get('useRSI', 'true') != 'false'
        use_kdj = params.get('useKDJ', 'true') != 'false'
        use_cjdx = params.get('useCJDX', 'true') != 'false'

        def calc_seven_swords(group):
            h = group['high'].values
            l = group['low'].values
            c = group['close'].values
            v = group['volume'].values
            n = len(c)
            swords = np.zeros(7, dtype=int)

            # 1. VOL: MA5 > MA10
            if use_vol and n >= 10:
                v_ref = v if v is not None and len(v) == n else c
                vma5 = np.mean(v_ref[-5:])
                vma10 = np.mean(v_ref[-10:])
                swords[0] = 1 if vma5 > vma10 else -1

            # 2. CCI(14): TP = (H+L+C)/3
            if use_cci and n >= 14:
                tp = (h + l + c) / 3
                tp_ma14 = np.mean(tp[-14:])
                md14 = np.mean(np.abs(tp[-14:] - tp_ma14))
                cci = (tp[-1] - tp_ma14) / (0.015 * md14) if md14 > 0 else 0
                if cci < -100:
                    swords[1] = 1
                elif cci > 100:
                    swords[1] = -1

            # 3. MACD(12,26,9): DIF > DEA
            if use_macd and n >= 34:
                ema12 = np.full(n, np.nan); ema26 = np.full(n, np.nan)
                ema12[11] = np.mean(c[:12]); ema26[25] = np.mean(c[:26])
                for j in range(12, n):
                    ema12[j] = c[j] * 2 / 13 + ema12[j - 1] * 11 / 13
                for j in range(26, n):
                    ema26[j] = c[j] * 2 / 27 + ema26[j - 1] * 25 / 27
                _dif = ema12 - ema26
                _dea = np.full(n, np.nan)
                _dea[33] = np.mean(_dif[26:34])
                for j in range(34, n):
                    _dea[j] = _dif[j] * 2 / 10 + _dea[j - 1] * 8 / 10
                swords[2] = 1 if _dif[-1] > _dea[-1] else -1

            # 4. SAR(0.02, 0.2)
            if use_sar and n >= 2:
                sar_val = l[0]; ep = h[0]; af = 0.02; up = True
                for j in range(1, n):
                    prev_sar = sar_val
                    if up:
                        sar_val = prev_sar + af * (ep - prev_sar)
                        sar_val = min(sar_val, l[j - 1])
                        if j > 1: sar_val = min(sar_val, l[j - 2])
                    else:
                        sar_val = prev_sar + af * (ep - prev_sar)
                        sar_val = max(sar_val, h[j - 1])
                        if j > 1: sar_val = max(sar_val, h[j - 2])
                    if up:
                        if h[j] > ep: ep = h[j]; af = min(af + 0.02, 0.2)
                        if l[j] < sar_val: up = False; sar_val = ep; ep = l[j]; af = 0.02
                    else:
                        if l[j] < ep: ep = l[j]; af = min(af + 0.02, 0.2)
                        if h[j] > sar_val: up = True; sar_val = ep; ep = h[j]; af = 0.02
                swords[3] = 1 if c[-1] > sar_val else -1

            # 5. RSI(6)
            if use_rsi and n >= 7:
                delta6 = np.diff(c[-7:])
                gain6 = np.mean(np.where(delta6 > 0, delta6, 0))
                loss6 = np.mean(np.where(delta6 < 0, -delta6, 0))
                rsi6 = 100 - 100 / (1 + gain6 / loss6) if loss6 > 0 else 100
                if rsi6 < 30: swords[4] = 1
                elif rsi6 > 70: swords[4] = -1

            # 6. KDJ(9,3,3): K > D
            k9_arr = np.full(n, np.nan); d9_arr = np.full(n, np.nan)
            j9_arr = np.full(n, np.nan)
            if (use_kdj or use_cjdx) and n >= 10:
                low9 = np.array([np.min(l[max(0, j - 8):j + 1]) for j in range(n)])
                high9 = np.array([np.max(h[max(0, j - 8):j + 1]) for j in range(n)])
                rsv = np.where(high9 - low9 > 0, (c - low9) / (high9 - low9) * 100, 50)
                for j in range(1, n):
                    k9_arr[j] = k9_arr[j - 1] * 2 / 3 + rsv[j] / 3
                    d9_arr[j] = d9_arr[j - 1] * 2 / 3 + k9_arr[j] / 3
                    j9_arr[j] = 3 * k9_arr[j] - 2 * d9_arr[j]
                if use_kdj:
                    swords[5] = 1 if k9_arr[-1] > d9_arr[-1] else -1
                if use_cjdx and n >= 11:
                    swords[6] = 1 if j9_arr[-1] > j9_arr[-2] else -1

            bull_cnt = int(np.sum(swords == 1))
            return pd.Series({
                '_ss_total': bull_cnt,
                '_ss_vol': swords[0], '_ss_cci': swords[1], '_ss_macd': swords[2],
                '_ss_sar': swords[3], '_ss_rsi': swords[4], '_ss_kdj': swords[5], '_ss_cjdx': swords[6]
            })

        result = df.groupby('code', group_keys=False).apply(calc_seven_swords)
        for col in ['_ss_total', '_ss_vol', '_ss_cci', '_ss_macd', '_ss_sar', '_ss_rsi', '_ss_kdj', '_ss_cjdx']:
            if col in result.columns:
                df[col] = result[col]

        mask = (df['_ss_total'].fillna(0) >= min_bullish)
        detail_cols = {
            '_ss_total': df['_ss_total'], '_ss_vol': df['_ss_vol'],
            '_ss_cci': df['_ss_cci'], '_ss_macd': df['_ss_macd'],
            '_ss_sar': df['_ss_sar'], '_ss_rsi': df['_ss_rsi'],
            '_ss_kdj': df['_ss_kdj'], '_ss_cjdx': df['_ss_cjdx']
        }
        return mask, detail_cols

    # ── 趋势强度 ───────────────────────────────────────────────

    def _batch_trend_strength(self, df, params):
        signal_type = params.get('signal_type', 'short_bottom')

        if signal_type == 'short_bottom':
            def calc_short_bottom(group):
                high = group['high'].values
                low = group['low'].values
                close = group['close'].values
                n = len(close)
                if n < 168:
                    return pd.Series(np.full(n, False), index=group.index)

                low_168 = np.array([np.min(low[max(0, j - 167):j + 1]) for j in range(n)])
                high_21 = np.array([np.max(high[max(0, j - 20):j + 1]) for j in range(n)])
                denom = high_21 - low_168
                denom[denom == 0] = 1
                norm = (close - low_168) / denom
                ema = np.zeros(n)
                ema[0] = norm[0]
                for j in range(1, n):
                    ema[j] = ema[j - 1] * 0.9 + norm[j] * 0.1
                result = np.full(n, False)
                for j in range(1, n):
                    result[j] = norm[j] > ema[j] and norm[j - 1] <= ema[j - 1]
                return pd.Series(result, index=group.index)

            mask = df.groupby('code', group_keys=False).apply(calc_short_bottom)
            detail_cols = {}

        elif signal_type == 'golden_finger':
            def calc_golden_finger(group):
                close = group['close'].values
                n = len(close)
                if n < 121:
                    return pd.Series(np.full(n, False), index=group.index)
                ma20 = np.convolve(close, np.ones(20) / 20, 'valid')
                ma120 = np.convolve(close, np.ones(120) / 120, 'valid')
                result = np.full(n, False)
                for j in range(120, n):
                    idx20 = j - 20
                    idx120 = j - 120
                    if idx20 > 0 and idx120 > 0:
                        result[j] = ma20[idx20] > ma120[idx120] and ma20[idx20 - 1] <= ma120[idx120 - 1]
                return pd.Series(result, index=group.index)

            mask = df.groupby('code', group_keys=False).apply(calc_golden_finger)
            detail_cols = {}

        elif signal_type == 'price_above_pressure':
            grouped = df.groupby('code')
            high_20 = grouped['high'].transform(
                lambda x: x.rolling(20, min_periods=20).max()
            )
            mask = df['close'] > high_20
            mask = mask.fillna(False)
            detail_cols = {'_trend_strength_pressure': high_20}

        elif signal_type == 'price_below_support':
            grouped = df.groupby('code')
            low_20 = grouped['low'].transform(
                lambda x: x.rolling(20, min_periods=20).min()
            )
            mask = df['close'] < low_20
            mask = mask.fillna(False)
            detail_cols = {'_trend_strength_support': low_20}

        else:
            mask = pd.Series(False, index=df.index)
            detail_cols = {}

        mask = mask.fillna(False)
        return mask, detail_cols

    # ── VWAP / 中位数 / 算术平均 ────────────────────────────────

    def _batch_vwap_signal(self, df, params):
        period = int(params.get('period', 60))
        direction = params.get('direction', 'above')

        df['_typical'] = (df['high'] + df['low'] + df['close']) / 3.0
        df['_typical_vol'] = df['_typical'] * df['volume']

        grouped = df.groupby('code')
        df['_tv_sum'] = grouped['_typical_vol'].transform(
            lambda x: x.rolling(period, min_periods=period).sum().shift(1)
        )
        df['_vol_sum'] = grouped['volume'].transform(
            lambda x: x.rolling(period, min_periods=period).sum().shift(1)
        )
        col_vwap = '_vwap'
        df[col_vwap] = df['_tv_sum'] / df['_vol_sum'].replace(0, np.nan)

        if direction == 'above':
            mask = df['close'] > df[col_vwap]
        else:
            mask = df['close'] < df[col_vwap]

        mask = mask.fillna(False)
        return mask, {col_vwap: df[col_vwap]}

    def _batch_median_signal(self, df, params):
        period = int(params.get('period', 60))
        direction = params.get('direction', 'above')

        col_median = '_median'
        df[col_median] = df.groupby('code')['close'].transform(
            lambda x: x.rolling(period, min_periods=period).median().shift(1)
        )

        if direction == 'above':
            mask = df['close'] > df[col_median]
        else:
            mask = df['close'] < df[col_median]

        mask = mask.fillna(False)
        return mask, {col_median: df[col_median]}

    def _batch_mean_signal(self, df, params):
        period = int(params.get('period', 60))
        direction = params.get('direction', 'above')

        col_mean = '_mean'
        df[col_mean] = df.groupby('code')['close'].transform(
            lambda x: x.rolling(period, min_periods=period).mean().shift(1)
        )

        if direction == 'above':
            mask = df['close'] > df[col_mean]
        else:
            mask = df['close'] < df[col_mean]

        mask = mask.fillna(False)
        return mask, {col_mean: df[col_mean]}

    # ── 换手率 ──────────────────────────────────────────────────

    def _batch_turnover_threshold(self, df, params):
        threshold = float(params.get('threshold', 5))
        direction = params.get('direction', 'above')

        col_turn = '_turnover_rate_f'
        if 'turnover_rate_f' not in df.columns:
            mask = pd.Series(False, index=df.index)
            return mask, {}

        if direction == 'above':
            mask = df['turnover_rate_f'] > threshold
        else:
            mask = df['turnover_rate_f'] < threshold

        mask = mask.fillna(False)
        return mask, {col_turn: df['turnover_rate_f']}

    def _batch_turnover_ratio(self, df, params):
        period = int(params.get('period', 20))
        ratio = float(params.get('ratio', 1.5))
        direction = params.get('direction', 'above')

        col_turn = '_turnover_rate_f'
        col_avg = '_turnover_avg'
        if 'turnover_rate_f' not in df.columns:
            mask = pd.Series(False, index=df.index)
            return mask, {}

        grouped = df.groupby('code')
        df[col_avg] = grouped['turnover_rate_f'].transform(
            lambda x: x.shift(1).rolling(period, min_periods=period).mean()
        )

        if direction == 'above':
            mask = df['turnover_rate_f'] > df[col_avg] * ratio
        else:
            mask = df['turnover_rate_f'] < df[col_avg] * ratio

        mask = mask.fillna(False)
        return mask, {col_turn: df['turnover_rate_f'], col_avg: df[col_avg]}

    def _evaluate_with_reason(self, code, card, date):
        card_type = card.get('type', '')
        params = card.get('params', {})

        evaluator = self._evaluators.get(card_type)
        if evaluator is None:
            return False, f"不支持的卡片类型: {card_type}"

        try:
            return evaluator(code, params, date)
        except Exception:
            import traceback
            traceback.print_exc()
            return False, "计算异常"

    def _get_data(self, code, date, min_bars):
        limit = max(min_bars, 300)
        if date is not None:
            raw = self.data_feed.get_kline_json(code, end_date=date, limit=limit)
        else:
            raw = self.data_feed.get_kline_json(code, limit=limit)

        data = json.loads(raw)
        if 'error' in data:
            return None
        if len(data['dates']) < min_bars:
            return None
        return data

    @staticmethod
    def _vals(data, idx):
        return np.array([v[idx] for v in data['values']])

    def _eval_ma_cross(self, code, params, date):
        fast = int(params.get('fastPeriod', 5))
        slow = int(params.get('slowPeriod', 20))
        direction = params.get('direction', 'golden')

        needed = max(fast, slow) + 2
        data = self._get_data(code, date, needed)
        if data is None:
            return False, "数据不足"

        closes = self._vals(data, 1)
        ma_fast = pd.Series(closes).rolling(fast).mean().values
        ma_slow = pd.Series(closes).rolling(slow).mean().values

        if np.isnan([ma_fast[-1], ma_slow[-1], ma_fast[-2], ma_slow[-2]]).any():
            return False, "均线尚未计算出有效值"

        pf, cf = ma_fast[-2], ma_fast[-1]
        ps, cs = ma_slow[-2], ma_slow[-1]

        if direction == 'golden':
            ok = pf <= ps and cf > cs
            label = "金叉" if ok else "未金叉"
        else:
            ok = pf >= ps and cf < cs
            label = "死叉" if ok else "未死叉"

        reason = f"均线{label}: MA{fast}({cf:.2f}) vs MA{slow}({cs:.2f})"
        return ok, reason

    def _eval_rsi(self, code, params, date):
        period = int(params.get('period', 14))
        oversold = float(params.get('oversold', 30))
        overbought = float(params.get('overbought', 70))
        direction = params.get('direction', 'oversold_buy')

        needed = period + 1
        data = self._get_data(code, date, needed)
        if data is None:
            return False, "数据不足"

        closes = self._vals(data, 1)
        diffs = np.diff(closes)
        gains = np.where(diffs > 0, diffs, 0)
        losses = np.where(diffs < 0, -diffs, 0)
        avg_gain = gains.mean()
        avg_loss = losses.mean()

        if avg_loss == 0:
            rsi = 100.0
        else:
            rsi = 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)

        if direction == 'oversold_buy':
            ok = rsi < oversold
            label = "超卖" if ok else "未超卖"
            reason = f"RSI{label}: RSI({rsi:.1f}) {'<' if ok else '>='} {oversold}"
        else:
            ok = rsi > overbought
            label = "超买" if ok else "未超买"
            reason = f"RSI{label}: RSI({rsi:.1f}) {'>' if ok else '<='} {overbought}"

        return ok, reason

    def _eval_macd(self, code, params, date):
        fast = int(params.get('fastPeriod', 12))
        slow = int(params.get('slowPeriod', 26))
        signal = int(params.get('signalPeriod', 9))
        direction = params.get('direction', 'golden')

        needed = max(fast, slow) + signal + 3
        data = self._get_data(code, date, needed)
        if data is None:
            return False, "数据不足"

        closes = self._vals(data, 1)
        ema_fast = pd.Series(closes).ewm(span=fast, adjust=False).mean().values
        ema_slow = pd.Series(closes).ewm(span=slow, adjust=False).mean().values
        dif = ema_fast - ema_slow
        dea = pd.Series(dif).ewm(span=signal, adjust=False).mean().values

        if direction == 'golden':
            ok = dif[-2] <= dea[-2] and dif[-1] > dea[-1]
            label = "金叉" if ok else "未金叉"
        else:
            ok = dif[-2] >= dea[-2] and dif[-1] < dea[-1]
            label = "死叉" if ok else "未死叉"

        reason = f"MACD{label}: DIF({dif[-1]:.3f}) vs DEA({dea[-1]:.3f})"
        return ok, reason

    def _eval_bollinger(self, code, params, date):
        period = int(params.get('period', 20))
        std_mult = float(params.get('stdMultiplier', 2))
        direction = params.get('direction', 'lower_breakout')

        needed = period
        data = self._get_data(code, date, needed)
        if data is None:
            return False, "数据不足"

        closes = self._vals(data, 1)
        mid = closes.mean()
        std = closes.std(ddof=0)
        upper = mid + std_mult * std
        lower = mid - std_mult * std
        last_close = closes[-1]

        if direction == 'lower_breakout':
            ok = last_close < lower
            label = "下轨突破" if ok else "未突破下轨"
            reason = f"布林带{label}: 收盘({last_close:.2f}) {'<' if ok else '>='} 下轨({lower:.2f})"
        else:
            ok = last_close > upper
            label = "上轨突破" if ok else "未突破上轨"
            reason = f"布林带{label}: 收盘({last_close:.2f}) {'>' if ok else '<='} 上轨({upper:.2f})"

        return ok, reason

    def _eval_volume(self, code, params, date):
        period = int(params.get('period', 20))
        multiple = float(params.get('multiple', 1.5))

        needed = period + 1
        data = self._get_data(code, date, needed)
        if data is None:
            return False, "数据不足"

        vols = self._vals(data, 4)
        avg_vol = vols[:-1].mean()
        cur_vol = vols[-1]
        threshold = avg_vol * multiple

        ok = cur_vol > threshold
        label = "成交量放大" if ok else "成交量未放大"
        reason = f"{label}: 当日量({cur_vol:.0f}) {'>' if ok else '<='} {multiple}×均量({avg_vol:.0f})"
        return ok, reason

    def _eval_volume_contraction(self, code, params, date):
        period = int(params.get('period', 20))
        ratio = float(params.get('ratio', 0.6))

        needed = period + 1
        data = self._get_data(code, date, needed)
        if data is None:
            return False, "数据不足"

        vols = self._vals(data, 4)
        avg_vol = vols[:-1].mean()
        cur_vol = vols[-1]
        threshold = avg_vol * ratio

        ok = cur_vol < threshold
        label = "成交量萎缩" if ok else "成交量未萎缩"
        reason = f"{label}: 当日量({cur_vol:.0f}) {'<' if ok else '>='} {ratio}×均量({avg_vol:.0f})"
        return ok, reason

    def _eval_fund_flow_single(self, code, params, date):
        field = params.get('field', 'main_net')
        direction = params.get('direction', 'gt')
        threshold = float(params.get('threshold', 5000))

        try:
            history = self.db.get_fund_flow_history(code, limit=1)
            if not history:
                return False, "无资金流向数据"
            val = history[0].get(field)
            if val is None:
                return False, f"缺少 {field} 字段"

            ok = (val > threshold) if direction == 'gt' else (val < threshold)
            dir_text = "大于" if direction == 'gt' else "小于"
            reason = f"资金流向: {field}={val:.0f}万元 {dir_text} {threshold}万元，条件{'满足' if ok else '不满足'}"
            return ok, reason
        except Exception as e:
            return False, f"评估异常: {str(e)}"

    def _eval_kdj(self, code, params, date):
        n = int(params.get('n', 9))
        m1 = int(params.get('m1', 3))
        m2 = int(params.get('m2', 3))
        direction = params.get('direction', 'golden')

        needed = n + max(m1, m2) + 5
        data = self._get_data(code, date, needed)
        if data is None:
            return False, "数据不足"

        highs = self._vals(data, 3)
        lows = self._vals(data, 2)
        closes = self._vals(data, 1)

        high_n = pd.Series(highs).rolling(n).max().values[n - 1:]
        low_n = pd.Series(lows).rolling(n).min().values[n - 1:]
        close_n = closes[n - 1:]

        rsv = np.where(
            high_n != low_n,
            (close_n - low_n) / (high_n - low_n) * 100,
            50.0
        )
        k_vals = pd.Series(rsv).ewm(alpha=1.0 / m1, adjust=False).mean().values
        d_vals = pd.Series(k_vals).ewm(alpha=1.0 / m2, adjust=False).mean().values

        if len(k_vals) < 2:
            return False, "KDJ数据不足"

        kp, kc = k_vals[-2], k_vals[-1]
        dp, dc = d_vals[-2], d_vals[-1]

        if direction == 'golden':
            ok = kp <= dp and kc > dc
            label = "金叉" if ok else "未金叉"
        else:
            ok = kp >= dp and kc < dc
            label = "死叉" if ok else "未死叉"

        reason = f"KDJ{label}: K({kc:.2f}) vs D({dc:.2f})"
        return ok, reason

    def _eval_supertrend(self, code, params, date):
        period = int(params.get('period', 10))
        multiplier = float(params.get('multiplier', 3))
        direction = params.get('direction', 'trend_up')

        needed = period + 5
        data = self._get_data(code, date, needed)
        if data is None:
            return False, "数据不足"

        highs = self._vals(data, 3)
        lows = self._vals(data, 2)
        closes = self._vals(data, 1)
        n = len(closes)

        if n <= period:
            return False, "数据不足"

        prev_close = np.roll(closes, 1)
        prev_close[0] = closes[0]
        tr = np.maximum(highs - lows, np.maximum(np.abs(highs - prev_close), np.abs(lows - prev_close)))

        atr = np.full(n, np.nan)
        atr[period] = np.mean(tr[1:period + 1])
        for j in range(period + 1, n):
            atr[j] = (atr[j - 1] * (period - 1) + tr[j]) / period

        src = (highs + lows + closes) / 3
        basic_upper = src + multiplier * atr
        basic_lower = src - multiplier * atr

        trend = np.zeros(n)
        trend_line = np.zeros(n)
        curr_trend = 1
        start = period
        trend[start] = curr_trend
        trend_line[start] = basic_lower[start] if curr_trend == 1 else basic_upper[start]
        for j in range(start + 1, n):
            if curr_trend == 1:
                if closes[j] > trend_line[j - 1]:
                    trend[j] = 1
                    trend_line[j] = max(basic_lower[j], trend_line[j - 1])
                else:
                    curr_trend = -1
                    trend[j] = -1
                    trend_line[j] = basic_upper[j]
            else:
                if closes[j] < trend_line[j - 1]:
                    trend[j] = -1
                    trend_line[j] = min(basic_upper[j], trend_line[j - 1])
                else:
                    curr_trend = 1
                    trend[j] = 1
                    trend_line[j] = basic_lower[j]

        if np.isnan(trend[-1]):
            return False, "超级趋势尚未计算出有效值"

        if direction == 'trend_up':
            ok = trend[-1] == 1
            label = "上升趋势" if ok else "下降趋势"
        else:
            ok = trend[-1] == -1
            label = "下降趋势" if ok else "上升趋势"

        reason = f"超级趋势{label}: 趋势={int(trend[-1])}, 趋势线={trend_line[-1]:.2f}"
        return ok, reason

    def _eval_cmf(self, code, params, date):
        period = int(params.get('period', 20))
        threshold = float(params.get('threshold', 0.1))
        direction = params.get('direction', 'gt')

        needed = period + 2
        data = self._get_data(code, date, needed)
        if data is None:
            return False, "数据不足"

        highs = self._vals(data, 3)
        lows = self._vals(data, 2)
        closes = self._vals(data, 1)
        volumes = self._vals(data, 4)

        h_l_range = highs - lows
        h_l_range[h_l_range == 0] = 1e-10
        mfm = ((closes - lows) - (highs - closes)) / h_l_range
        mfv = mfm * volumes

        sum_mfv = pd.Series(mfv).rolling(period, min_periods=period).sum().values
        sum_vol = pd.Series(volumes).rolling(period, min_periods=period).sum().values

        cmf_val = sum_mfv[-1] / sum_vol[-1] if sum_vol[-1] != 0 else 0

        if direction == 'gt':
            ok = cmf_val > threshold
            dir_text = "大于"
        else:
            ok = cmf_val < -threshold
            dir_text = "小于"
            threshold = -threshold

        reason = f"CMF: {cmf_val:.3f} {dir_text} {threshold:.2f}，条件{'满足' if ok else '不满足'}"
        return ok, reason

    def _eval_resonance(self, code, params, date):
        rsi_oversold = float(params.get('rsiOversold', 30))
        ma_short = int(params.get('maShort', 5))
        ma_mid = int(params.get('maMid', 10))
        ma_long = int(params.get('maLong', 20))
        kdj_n = int(params.get('kdjN', 9))
        kdj_m1 = int(params.get('kdjM1', 3))
        kdj_m2 = int(params.get('kdjM2', 3))
        res_threshold = int(params.get('threshold', 3))

        max_period = max(ma_long, kdj_n + kdj_m1 + kdj_m2, 20)
        needed = max_period + 10
        data = self._get_data(code, date, needed)
        if data is None:
            return False, "数据不足"

        highs = self._vals(data, 3)
        lows = self._vals(data, 2)
        closes = self._vals(data, 1)
        n = len(closes)

        if n < max_period + 5:
            return False, "数据不足"

        # RSI (Wilder smoothed, period=14)
        rsi = np.full(n, np.nan)
        delta = np.diff(closes)
        gain = np.where(delta > 0, delta, 0)
        loss = np.where(delta < 0, -delta, 0)
        if n > 14:
            avg_gain = np.mean(gain[:14])
            avg_loss = np.mean(loss[:14])
            rsi[14] = 100 - 100 / (1 + avg_gain / avg_loss) if avg_loss > 0 else 100
            for j in range(15, n):
                avg_gain = (avg_gain * 13 + gain[j - 1]) / 14
                avg_loss = (avg_loss * 13 + loss[j - 1]) / 14
                rsi[j] = 100 - 100 / (1 + avg_gain / avg_loss) if avg_loss > 0 else 100

        # KDJ
        k_arr = np.full(n, np.nan)
        d_arr = np.full(n, np.nan)
        if n > kdj_n:
            low_n = np.array([np.min(lows[max(0, j - kdj_n + 1):j + 1]) for j in range(n)])
            high_n = np.array([np.max(highs[max(0, j - kdj_n + 1):j + 1]) for j in range(n)])
            rsv = np.where(high_n - low_n > 0, (closes - low_n) / (high_n - low_n) * 100, 50)
            k_arr[kdj_n - 1] = 50
            d_arr[kdj_n - 1] = 50
            for j in range(kdj_n, n):
                k_arr[j] = k_arr[j - 1] * (kdj_m1 - 1) / kdj_m1 + rsv[j] / kdj_m1
                d_arr[j] = d_arr[j - 1] * (kdj_m2 - 1) / kdj_m2 + k_arr[j] / kdj_m2

        # MACD (EMA 12/26/9)
        dif = np.full(n, np.nan)
        dea = np.full(n, np.nan)
        if n >= 34:
            ema12 = np.full(n, np.nan)
            ema26 = np.full(n, np.nan)
            ema12[11] = np.mean(closes[:12])
            ema26[25] = np.mean(closes[:26])
            for j in range(12, n):
                ema12[j] = closes[j] * 2 / 13 + ema12[j - 1] * 11 / 13
            for j in range(26, n):
                ema26[j] = closes[j] * 2 / 27 + ema26[j - 1] * 25 / 27
            dif = ema12 - ema26
            dea[33] = np.mean(dif[26:34])
            for j in range(34, n):
                dea[j] = dif[j] * 2 / 10 + dea[j - 1] * 8 / 10

        # MA
        ma_s = np.convolve(closes, np.ones(ma_short) / ma_short, 'valid')
        ma_m = np.convolve(closes, np.ones(ma_mid) / ma_mid, 'valid')
        ma_l = np.convolve(closes, np.ones(ma_long) / ma_long, 'valid')

        # Score
        score_start = max(ma_long - 1, kdj_n + 1, 34)
        last_score = 0
        j = n - 1
        if j >= score_start:
            cnt = 0
            if not np.isnan(rsi[j]) and rsi[j] < rsi_oversold:
                cnt += 1
            if not np.isnan(k_arr[j]) and not np.isnan(d_arr[j]) and j >= 1:
                if k_arr[j - 1] <= d_arr[j - 1] and k_arr[j] > d_arr[j]:
                    cnt += 1
            if not np.isnan(dif[j]) and not np.isnan(dea[j]) and j >= 1:
                if dif[j - 1] <= dea[j - 1] and dif[j] > dea[j]:
                    cnt += 1
            ma_s_idx = j - (ma_short - 1)
            ma_m_idx = j - (ma_mid - 1)
            ma_l_idx = j - (ma_long - 1)
            if ma_s_idx >= 0 and ma_m_idx >= 0 and ma_l_idx >= 0:
                if ma_s[ma_s_idx] > ma_m[ma_m_idx] and ma_m[ma_m_idx] > ma_l[ma_l_idx]:
                    cnt += 1
            last_score = cnt

        ok = last_score >= res_threshold
        reason = f"共振指标: 分数={last_score}, 阈值={res_threshold}, 条件{'满足' if ok else '不满足'}"
        return ok, reason

    def _eval_seven_swords(self, code, params, date):
        """单股七脉神剑评估（委托 _batch_seven_swords 批量处理）。"""

        min_bullish = int(params.get('minBullish', 4))
        # 单股模式下构建 mini DataFrame 调用批量方法
        data = self._get_data(code, date, 40)
        if data is None:
            return False, "数据不足"

        close_vals = self._vals(data, 1)
        if len(close_vals) < 30:
            return False, "数据不足"

        import pandas as pd
        mini_df = pd.DataFrame({
            'code': [code] * len(data),
            'high': self._vals(data, 3),
            'low': self._vals(data, 2),
            'close': self._vals(data, 1),
            'volume': self._vals(data, 0)
        })

        mask, detail_cols = self._batch_seven_swords(mini_df, params)
        ok = bool(mask.iloc[-1]) if not mask.empty else False
        total = detail_cols['_ss_total'].iloc[-1] if '_ss_total' in detail_cols else 0
        reason = f"七脉神剑: 多头数={int(total)}/7, 阈值={min_bullish}, 条件{'满足' if ok else '不满足'}"
        return ok, reason

    def _eval_trend_strength(self, code, params, date):
        signal_type = params.get('signal_type', 'short_bottom')

        if signal_type == 'short_bottom':
            needed = 180
        elif signal_type == 'golden_finger':
            needed = 130
        else:
            needed = 25

        data = self._get_data(code, date, needed)
        if data is None:
            return False, "数据不足"

        highs = self._vals(data, 3)
        lows = self._vals(data, 2)
        closes = self._vals(data, 1)
        n = len(closes)

        if signal_type == 'short_bottom':
            if n < 168:
                return False, "数据不足"
            low_168 = np.array([np.min(lows[max(0, j - 167):j + 1]) for j in range(n)])
            high_21 = np.array([np.max(highs[max(0, j - 20):j + 1]) for j in range(n)])
            denom = high_21 - low_168
            denom[denom == 0] = 1
            norm = (closes - low_168) / denom
            ema = np.zeros(n)
            ema[0] = norm[0]
            for j in range(1, n):
                ema[j] = ema[j - 1] * 0.9 + norm[j] * 0.1
            ok = norm[-1] > ema[-1] and norm[-2] <= ema[-2]
            reason = f"趋势强度短底: norm={norm[-1]:.3f}, ema={ema[-1]:.3f}, {'上穿' if ok else '未上穿'}"
            return ok, reason

        elif signal_type == 'golden_finger':
            if n < 121:
                return False, "数据不足"
            ma20 = np.convolve(closes, np.ones(20) / 20, 'valid')
            ma120 = np.convolve(closes, np.ones(120) / 120, 'valid')
            idx20 = n - 20
            idx120 = n - 120
            if idx20 <= 0 or idx120 <= 0:
                return False, "数据不足"
            ok = ma20[idx20] > ma120[idx120] and ma20[idx20 - 1] <= ma120[idx120 - 1]
            reason = f"趋势强度金手指: MA20={ma20[idx20]:.2f}, MA120={ma120[idx120]:.2f}, {'金叉' if ok else '未金叉'}"
            return ok, reason

        elif signal_type == 'price_above_pressure':
            high_20 = pd.Series(highs).rolling(20, min_periods=20).max().values[-1]
            if np.isnan(high_20):
                return False, "数据不足"
            ok = closes[-1] > high_20
            reason = f"趋势强度突破压力: 收盘={closes[-1]:.2f}, 20日高={high_20:.2f}, {'突破' if ok else '未突破'}"
            return ok, reason

        elif signal_type == 'price_below_support':
            low_20 = pd.Series(lows).rolling(20, min_periods=20).min().values[-1]
            if np.isnan(low_20):
                return False, "数据不足"
            ok = closes[-1] < low_20
            reason = f"趋势强度跌破支撑: 收盘={closes[-1]:.2f}, 20日低={low_20:.2f}, {'跌破' if ok else '未跌破'}"
            return ok, reason

        else:
            return False, f"不支持的趋势强度信号类型: {signal_type}"


# ── 临时测试入口 ────────────────────────────────────────────────
if __name__ == '__main__':


    from backend.data_feed import DataFeed
    df = DataFeed()
    screener = StockScreener(df)

    # 测试1: 单只股票 MA 金叉

    card = {
        "type": "ma_cross",
        "params": {"fastPeriod": 5, "slowPeriod": 20, "direction": "golden"}
    }
    ok, reason = screener.evaluate_stock_with_reason("000001", card)



    results = screener.screen_stocks_batch(
        cards=[card],
        stock_pool=["000001", "000858"],
        logic="AND"
    )

    for r in results:
        print(f"  {r['code']} {r['name']}: {r['details']}")

    # 测试3: 批量筛选 - 沪深300模拟（部分成分股）
    print("\n[Test 3] 批量筛选 MA5 上穿 MA20（部分沪深300成分股）")
    hs300_sample = ["000001", "000002", "000333", "000651", "000858",
                    "600519", "600036", "601318", "300750", "002415"]
    results3 = screener.screen_stocks_batch(
        cards=[card],
        stock_pool=hs300_sample,
        logic="AND"
    )
    print(f"  命中数量: {len(results3)}")
    for r in results3:
        details = r['details']
        ma5 = details.get('_ma5', 'N/A')
        ma20 = details.get('_ma20', 'N/A')
        print(f"  {r['code']} {r['name']}: MA5={ma5}, MA20={ma20}, 金叉={details.get('ma_cross')}")

    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)
