"""Sector heat calculator — aggregates per-sector metrics from concept/industry membership."""
from sqlalchemy import text
import pandas as pd
import numpy as np


class SectorHeatCalculator:
    """Compute sector heat rankings for concept boards and industry classifications."""

    def __init__(self, db_engine):
        self.engine = db_engine

    # ── public API ──

    def compute(self, sector_type, metric, days=5, realtime=False):
        """Return ranked list of sector heat dicts.

        Args:
            sector_type: 'concept' or 'industry'
            metric: 'change_pct' | 'fund_flow' | 'volume_ratio' |
                    'advance_decline' | 'heat_score'
            days: lookback window for K-line metrics
            realtime: if True, use stock_realtime table (ponytail: not yet)

        Returns:
            [{name, stock_count, avg_change_pct, total_fund_flow,
              volume_ratio, advance_decline, heat_score,
              top_stock: {code, name, change_pct}}]
        """
        sector_stocks = self._get_sector_stocks(sector_type)
        if not sector_stocks:
            return []

        sectors = []
        for sector_name, codes in sector_stocks.items():
            if len(codes) == 0:
                continue
            m = self._compute_sector_metrics(codes, days)
            if m is None:
                continue
            m['name'] = sector_name
            m['stock_count'] = len(codes)
            sectors.append(m)

        # compute heat_score
        self._add_heat_scores(sectors)

        # sort
        sort_key = {
            'change_pct': 'avg_change_pct',
            'fund_flow': 'total_fund_flow',
            'volume_ratio': 'volume_ratio',
            'advance_decline': 'advance_decline',
            'heat_score': 'heat_score',
        }.get(metric, 'heat_score')
        sectors.sort(key=lambda s: s.get(sort_key, 0), reverse=True)

        return sectors

    def get_sector_detail(self, sector_type, sector_name):
        """Return top-20 component stocks with individual metrics for one sector."""
        sector_stocks = self._get_sector_stocks(sector_type)
        codes = sector_stocks.get(sector_name, [])
        if not codes:
            return {'name': sector_name, 'stocks': []}

        stocks = self._get_stock_details(codes)
        return {'name': sector_name, 'stocks': stocks}

    # ── sector→stocks mapping ──

    def _get_sector_stocks(self, sector_type):
        """Return {sector_name: [ts_code, ...]} dict."""
        if sector_type == 'concept':
            return self._get_concept_stocks()
        elif sector_type == 'industry':
            return self._get_industry_stocks()
        return {}

    def _get_concept_stocks(self):
        """concept table + stock_concept table → {concept_name: [ts_code]}"""
        sql = text("""
            SELECT c.concept_name, sc.ts_code
            FROM stock_concept sc
            JOIN concept c ON sc.concept_id = c.concept_id
            ORDER BY c.concept_name
        """)
        with self.engine.connect() as conn:
            rows = conn.execute(sql).fetchall()

        mapping = {}
        for row in rows:
            name = row[0]
            code = row[1].replace('.SZ', '').replace('.SH', '').replace('.BJ', '')
            if name not in mapping:
                mapping[name] = []
            mapping[name].append(code)
        return mapping

    def _get_industry_stocks(self):
        """stock_industry_detail table → {industry_level1: [ts_code]}.
        Falls back to stock_industry if detail table is empty.
        """
        # Try industry_detail first
        with self.engine.connect() as conn:
            cnt = conn.execute(text(
                "SELECT COUNT(*) FROM stock_industry_detail"
            )).scalar()

        if cnt and cnt > 0:
            sql = text(
                "SELECT industry_level1, ts_code FROM stock_industry_detail "
                "WHERE industry_level1 IS NOT NULL AND industry_level1 != ''"
            )
        else:
            # fallback: old stock_industry table
            sql = text(
                "SELECT industry, ts_code FROM stock_industry "
                "WHERE industry IS NOT NULL AND industry != ''"
            )

        with self.engine.connect() as conn:
            rows = conn.execute(sql).fetchall()

        mapping = {}
        for row in rows:
            name = row[0]
            code = row[1].replace('.SZ', '').replace('.SH', '').replace('.BJ', '')
            if name not in mapping:
                mapping[name] = []
            mapping[name].append(code)
        return mapping

    # ── per-sector metric computation ──

    def _compute_sector_metrics(self, codes, days):
        """Compute aggregate metrics for a list of stock codes over N days.
        Returns dict or None if no data.
        """
        # Get K-line data for codes in [start, end]
        stock_metrics = []
        for code in codes:
            m = self._compute_stock_metrics(code, days)
            if m is not None:
                stock_metrics.append(m)

        if not stock_metrics:
            return None

        n = len(stock_metrics)
        avg_change = sum(m['change_pct'] for m in stock_metrics) / n
        total_ff = sum(m['fund_flow'] for m in stock_metrics)
        avg_vol_ratio = sum(m['volume_ratio'] for m in stock_metrics) / n
        up_count = sum(1 for m in stock_metrics if m['change_pct'] > 0)
        ad_ratio = up_count / n if n > 0 else 0

        # Find top stock by change%
        top = max(stock_metrics, key=lambda m: m['change_pct'])

        return {
            'avg_change_pct': round(avg_change, 2),
            'total_fund_flow': round(total_ff, 2),
            'volume_ratio': round(avg_vol_ratio, 2),
            'advance_decline': round(ad_ratio, 2),
            'top_stock': {
                'code': top['code'],
                'name': top['name'],
                'change_pct': round(top['change_pct'], 2),
            },
        }

    def _compute_stock_metrics(self, code, days):
        """Compute single-stock metrics over N days. Returns dict or None."""
        # Query K-line: last N trading days + prior N days for volume ratio
        sql = text("""
            SELECT trade_date, open, close, amount, name
            FROM stock_daily_qfq_with_name
            WHERE ts_code LIKE :code_pattern
            ORDER BY trade_date DESC
            LIMIT :limit
        """)

        with self.engine.connect() as conn:
            rows = conn.execute(sql, {
                'code_pattern': f'{code}.%',
                'limit': days * 2 + 5,
            }).fetchall()

        if len(rows) < 2:
            return None

        name_from_kline = rows[0][4] if rows and len(rows[0]) > 4 else code
        rows = [(r[0], float(r[1]), float(r[2]), float(r[3] or 0)) for r in rows]
        rows.sort(key=lambda r: r[0])

        # Recent N days
        period = rows[-days:] if len(rows) >= days else rows
        prior = rows[-days*2:-days] if len(rows) >= days * 2 else rows[:len(rows)//2]

        first_close = period[0][2]
        last_close = period[-1][2]
        if first_close == 0:
            return None
        change_pct = (last_close - first_close) / first_close * 100

        # volume ratio
        period_amounts = [r[3] for r in period]
        prior_amounts = [r[3] for r in prior]
        avg_period = sum(period_amounts) / len(period_amounts) if period_amounts else 0
        avg_prior = sum(prior_amounts) / len(prior_amounts) if prior_amounts else 1
        vol_ratio = avg_period / avg_prior if avg_prior > 0 else 1.0

        # fund flow (try fund_flow_history table)
        fund_flow = self._get_stock_fund_flow(code, days)

        name = name_from_kline or code

        return {
            'code': code,
            'name': name,
            'change_pct': change_pct,
            'fund_flow': fund_flow,
            'volume_ratio': vol_ratio,
        }

    def _get_stock_fund_flow(self, code, days=5):
        """Sum main_net fund flow for the stock over recent N days. Returns float (in 100M yuan)."""
        try:
            sql = text("""
                SELECT COALESCE(SUM(main_net), 0) FROM (
                    SELECT main_net FROM fund_flow_history
                    WHERE ts_code LIKE :code_pattern
                    ORDER BY trade_date DESC
                    LIMIT :days
                )
            """)
            with self.engine.connect() as conn:
                val = conn.execute(sql, {
                    'code_pattern': f'{code}.%',
                    'days': days,
                }).scalar()
            return round(float(val or 0) / 10000, 2)  # 万元 → 亿元
        except Exception:
            return 0.0

    def _get_stock_details(self, codes):
        """Return individual stock detail list (top 20 by change%)."""
        results = []
        for code in codes:
            m = self._compute_stock_metrics(code, days=5)
            if m:
                results.append(m)
        results.sort(key=lambda x: x['change_pct'], reverse=True)
        return results[:20]

    # ── composite score ──

    def _add_heat_scores(self, sectors):
        """Add heat_score to each sector dict in-place."""
        if not sectors:
            return

        # Min-max normalize fund_flow for scoring
        ff_vals = [s['total_fund_flow'] for s in sectors]
        ff_min, ff_max = min(ff_vals), max(ff_vals)
        ff_range = ff_max - ff_min if ff_max != ff_min else 1

        for s in sectors:
            ff_norm = (s['total_fund_flow'] - ff_min) / ff_range * 100
            s['heat_score'] = round(
                s['avg_change_pct'] * 0.4 +
                ff_norm * 0.3 +
                s['volume_ratio'] * 0.15 +
                s['advance_decline'] * 0.15,
                2
            )
