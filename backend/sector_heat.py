"""Sector heat calculator — SQL-aggregated sector metrics from fund_flow + K-line data."""
from sqlalchemy import text


class SectorHeatCalculator:
    """Compute sector heat rankings using SQL aggregation, not per-stock loops."""

    def __init__(self, db_engine):
        self.engine = db_engine

    # ── public API ──

    def compute(self, sector_type, metric="fund_flow", days=5, realtime=False):
        """Return ranked list of sector heat dicts.

        Args:
            sector_type: 'concept' or 'industry'
            metric: 'fund_flow' | 'change_pct' | 'volume_ratio' |
                    'advance_decline' | 'heat_score'
            days: lookback window (ponytail: fund_flow uses 1 day, rest use N)
        """
        if metric == "fund_flow":
            return self._compute_fund_flow(sector_type)
        # 其他指标：走 K 线聚合
        return self._compute_kline_metrics(sector_type, metric, days)

    def get_sector_detail(self, sector_type, sector_name):
        """Return top-20 component stocks with fund flow for one sector."""
        return self._get_sector_detail(sector_type, sector_name)

    # ── fund_flow: single SQL aggregation ──

    def _compute_fund_flow(self, sector_type):
        """One query: JOIN fund_flow_history → GROUP BY sector → return ranked list."""
        latest_date_sql = "SELECT MAX(trade_date) FROM fund_flow_history"

        if sector_type == "concept":
            sql = text(f"""
                SELECT c.concept_name AS sector_name,
                       SUM(ffh.main_net) AS total_fund_flow,
                       COUNT(DISTINCT sc.ts_code) AS stock_count
                FROM stock_concept sc
                JOIN concept c ON sc.concept_id = c.concept_id
                JOIN fund_flow_history ffh ON sc.ts_code = ffh.ts_code
                WHERE ffh.trade_date = ({latest_date_sql})
                GROUP BY c.concept_name
                ORDER BY total_fund_flow DESC
            """)
        else:
            sql = text(f"""
                SELECT COALESCE(sid.industry_level1, si.industry) AS sector_name,
                       SUM(ffh.main_net) AS total_fund_flow,
                       COUNT(DISTINCT COALESCE(sid.ts_code, si.ts_code)) AS stock_count
                FROM fund_flow_history ffh
                LEFT JOIN stock_industry_detail sid ON ffh.ts_code = sid.ts_code
                LEFT JOIN stock_industry si ON ffh.ts_code = si.ts_code
                WHERE ffh.trade_date = ({latest_date_sql})
                GROUP BY sector_name
                HAVING sector_name IS NOT NULL AND sector_name != ''
                ORDER BY total_fund_flow DESC
            """)

        with self.engine.connect() as conn:
            rows = conn.execute(sql).fetchall()

        sectors = []
        for row in rows:
            sectors.append({
                "name": row[0],
                "total_fund_flow": round(float(row[1] or 0) / 10000, 2),  # 万元→亿元
                "stock_count": row[2],
                "avg_change_pct": 0,
                "volume_ratio": 0,
                "advance_decline": 0,
                "heat_score": 0,
                "top_stock": {"code": "", "name": "", "change_pct": 0},
            })

        # sort by fund_flow desc
        sectors.sort(key=lambda s: s["total_fund_flow"], reverse=True)
        return sectors

    # ── K-line metrics: bulk per sector ──

    def _compute_kline_metrics(self, sector_type, metric, days):
        """Aggregate K-line metrics per sector. Bulk fetch per sector, not per stock."""
        mapping = self._get_sector_stocks(sector_type)

        sectors = []
        for sector_name, codes in mapping.items():
            if len(codes) < 1:
                continue
            m = self._compute_one_sector_kline(codes, days)
            if m is None:
                continue
            m["name"] = sector_name
            m["stock_count"] = len(codes)
            sectors.append(m)

        # heat_score
        self._add_heat_scores(sectors)

        sort_key = {
            "change_pct": "avg_change_pct",
            "volume_ratio": "volume_ratio",
            "advance_decline": "advance_decline",
            "heat_score": "heat_score",
        }.get(metric, "heat_score")
        sectors.sort(key=lambda s: s.get(sort_key, 0), reverse=True)
        return sectors

    def _compute_one_sector_kline(self, codes, days):
        """Bulk K-line query for all stocks in one sector. Returns dict or None."""
        code_patterns = [f"'{c}.%'" for c in codes[:200]]  # ponytail: cap 200 stocks
        if not code_patterns:
            return None

        in_clause = " OR ts_code LIKE ".join(code_patterns)
        sql = text(f"""
            SELECT ts_code, name, trade_date, close, amount
            FROM stock_daily_qfq_with_name
            WHERE ts_code LIKE {in_clause}
            ORDER BY ts_code, trade_date
        """)

        with self.engine.connect() as conn:
            rows = conn.execute(sql).fetchall()

        if not rows:
            return None

        # group by stock
        stock_data = {}
        for r in rows:
            code = r[0].split(".")[0]
            if code not in stock_data:
                stock_data[code] = {"name": r[1] or code, "dates": [], "closes": [], "amounts": []}
            stock_data[code]["dates"].append(r[2])
            stock_data[code]["closes"].append(float(r[3] or 0))
            stock_data[code]["amounts"].append(float(r[4] or 0))

        # compute per-stock metrics
        changes = []
        vol_ratios = []
        up_count = 0
        total_ff = 0
        top_stock = {"code": "", "name": "", "change_pct": -999}

        for code, sd in stock_data.items():
            if len(sd["closes"]) < 2:
                continue
            closes = sd["closes"]
            period = closes[-days:] if len(closes) >= days else closes
            first = period[0]
            last = period[-1]
            if first == 0:
                continue
            chg = (last - first) / first * 100
            changes.append(chg)
            if chg > top_stock["change_pct"]:
                top_stock = {"code": code, "name": sd["name"], "change_pct": round(chg, 2)}
            if chg > 0:
                up_count += 1

            # volume ratio
            amounts = sd["amounts"]
            period_a = amounts[-days:] if len(amounts) >= days else amounts
            prior_a = amounts[-days*2:-days] if len(amounts) >= days*2 else amounts[:len(amounts)//2]
            avg_p = sum(period_a) / len(period_a) if period_a else 0
            avg_r = sum(prior_a) / len(prior_a) if prior_a else 1
            vol_ratios.append(avg_p / avg_r if avg_r > 0 else 1.0)

            # fund flow (single query per sector, not per stock)
            ff = self._get_stock_fund_flow_bulk(code, days)
            total_ff += ff

        n = len(changes)
        if n == 0:
            return None

        return {
            "avg_change_pct": round(sum(changes) / n, 2),
            "total_fund_flow": round(total_ff, 2),
            "volume_ratio": round(sum(vol_ratios) / n, 2) if vol_ratios else 0,
            "advance_decline": round(up_count / n, 2),
            "top_stock": top_stock,
        }

    def _get_stock_fund_flow_bulk(self, code, days=5):
        """Single-stock fund flow sum. Fast per-stock, but called less often now."""
        try:
            sql = text("""
                SELECT COALESCE(SUM(main_net), 0) FROM (
                    SELECT main_net FROM fund_flow_history
                    WHERE ts_code LIKE :code_pattern
                    ORDER BY trade_date DESC LIMIT :days
                )
            """)
            with self.engine.connect() as conn:
                val = conn.execute(sql, {
                    "code_pattern": f"{code}.%",
                    "days": days,
                }).scalar()
            return round(float(val or 0) / 10000, 2)
        except Exception:
            return 0.0

    # ── sector detail ──

    def _get_sector_detail(self, sector_type, sector_name):
        """Top-20 component stocks by fund flow for one sector."""
        latest_date_sql = "SELECT MAX(trade_date) FROM fund_flow_history"

        if sector_type == "concept":
            sql = text(f"""
                SELECT ffh.ts_code, COALESCE(sb.name, ffh.ts_code) AS stock_name,
                       ffh.main_net
                FROM stock_concept sc
                JOIN concept c ON sc.concept_id = c.concept_id
                JOIN fund_flow_history ffh ON sc.ts_code = ffh.ts_code
                LEFT JOIN stock_basic sb ON REPLACE(REPLACE(ffh.ts_code, '.SH',''),'.SZ','') = sb.code
                WHERE c.concept_name = :sector_name
                  AND ffh.trade_date = ({latest_date_sql})
                ORDER BY ffh.main_net DESC
                LIMIT 20
            """)
        else:
            sql = text(f"""
                SELECT ffh.ts_code, COALESCE(sb.name, ffh.ts_code) AS stock_name,
                       ffh.main_net
                FROM fund_flow_history ffh
                LEFT JOIN stock_industry_detail sid ON ffh.ts_code = sid.ts_code
                LEFT JOIN stock_basic sb ON REPLACE(REPLACE(ffh.ts_code, '.SH',''),'.SZ','') = sb.code
                WHERE sid.industry_level1 = :sector_name
                  AND ffh.trade_date = ({latest_date_sql})
                ORDER BY ffh.main_net DESC
                LIMIT 20
            """)

        with self.engine.connect() as conn:
            rows = conn.execute(sql, {"sector_name": sector_name}).fetchall()

        stocks = []
        for r in rows:
            code = r[0].split(".")[0] if "." in r[0] else r[0]
            stocks.append({
                "code": code,
                "name": r[1] or code,
                "change_pct": 0,
                "fund_flow": round(float(r[2] or 0) / 10000, 2) if r[2] else 0,
            })

        return {"name": sector_name, "stocks": stocks}

    # ── sector→stocks mapping ──

    def _get_sector_stocks(self, sector_type):
        if sector_type == "concept":
            return self._get_concept_stocks()
        elif sector_type == "industry":
            return self._get_industry_stocks()
        return {}

    def _get_concept_stocks(self):
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
            code = row[1].replace(".SZ", "").replace(".SH", "").replace(".BJ", "")
            if name not in mapping:
                mapping[name] = []
            mapping[name].append(code)
        return mapping

    def _get_industry_stocks(self):
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
            sql = text(
                "SELECT industry, ts_code FROM stock_industry "
                "WHERE industry IS NOT NULL AND industry != ''"
            )
        with self.engine.connect() as conn:
            rows = conn.execute(sql).fetchall()
        mapping = {}
        for row in rows:
            name = row[0]
            code = row[1].replace(".SZ", "").replace(".SH", "").replace(".BJ", "")
            if name not in mapping:
                mapping[name] = []
            mapping[name].append(code)
        return mapping

    # ── heat score ──

    def _add_heat_scores(self, sectors):
        if not sectors:
            return
        ff_vals = [s["total_fund_flow"] for s in sectors]
        ff_min, ff_max = min(ff_vals), max(ff_vals)
        ff_range = ff_max - ff_min if ff_max != ff_min else 1
        for s in sectors:
            ff_norm = (s["total_fund_flow"] - ff_min) / ff_range * 100
            s["heat_score"] = round(
                s["avg_change_pct"] * 0.4
                + ff_norm * 0.3
                + s["volume_ratio"] * 0.15
                + s["advance_decline"] * 0.15,
                2,
            )
