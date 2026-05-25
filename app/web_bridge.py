import json
import sys
import os
import re
import time
import shutil
import subprocess
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np
import pandas as pd
from PySide6.QtCore import QObject, Slot
from backend.data_feed import DataFeed
from backend.strategy_engine import StrategyEngine
from backend.trade_simulation import TradeSimulation
from backend.db import Database
from backend.strategy_storage import StrategyStorage
from backend.backtest_executor import BacktestExecutor   # 新增导入
from backend.multi_backtest_executor import MultiBacktestExecutor # 多股回测
from backend.stock_screener import StockScreener
from sqlalchemy import text

class WebBridge(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.data_feed = DataFeed()
        self.strategy_engine = StrategyEngine()
        self.trade = TradeSimulation()
        self.db = Database()
        self.strategy_storage = StrategyStorage()
        self.backtest_executor = BacktestExecutor(self.data_feed)   # 初始化
        self.multi_backtest_executor = MultiBacktestExecutor(self.data_feed)   # 多股回测
        self.stock_screener = StockScreener(self.data_feed)
        self._update_process = None   # 日线数据更新子进程句柄
        self._financial_update_process = None  # 财务数据更新子进程句柄

        df = DataFeed()


    @Slot(result=str)
    def ping(self):
        return "pong"

    @Slot(str, str, result=str)
    def test_evaluate_stock(self, code_json, card_json):
        """测试选股条件接口：接收股票代码JSON和卡片JSON，返回选股结果"""
        try:
            code = json.loads(code_json)
            card = json.loads(card_json)
            if isinstance(code, list):
                code = code[0] if len(code) > 0 else ""
            ok, reason = self.stock_screener.evaluate_stock_with_reason(code, card)
            return json.dumps({"code": code, "result": ok, "reason": reason})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"code": "", "result": False, "reason": str(e)})

    @Slot(str, str, str, result=str)
    def screen_stocks(self, cards_json, stock_pool_json, date):
        """批量选股接口：接收卡片列表JSON、股票池JSON、基准日期，返回筛选结果"""
        try:
            cards = json.loads(cards_json) if isinstance(cards_json, str) else cards_json
            stock_pool = json.loads(stock_pool_json) if isinstance(stock_pool_json, str) and stock_pool_json else None
            if not date or date.strip() == '':
                date = None

            stocks = self.stock_screener.screen_stocks_batch(
                cards=cards,
                stock_pool=stock_pool if stock_pool else None,
                date=date,
                logic="AND"
            )

            return json.dumps({
                "success": True,
                "total": len(stocks),
                "stocks": stocks
            }, ensure_ascii=False)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "total": 0, "stocks": [], "error": str(e)},
                              ensure_ascii=False)

    @Slot(result=str)
    def get_latest_trading_date(self):
        """返回数据库中全局最新交易日期。"""
        try:
            with self.db.engine.connect() as conn:
                row = conn.execute(
                    text("SELECT MAX(trade_date) FROM stock_daily_qfq_with_name")
                ).scalar()
            return json.dumps({"success": True, "date": str(row) if row else None})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, str, str, int, str, result=str)
    def get_kline_data(self, code, start_date="2010-01-01", end_date="2026-12-31", limit=0, period="daily"):
        try:
            raw = self.data_feed.get_kline_json(code, start_date, end_date, limit, period)
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and 'dates' in parsed and 'values' in parsed:
                return raw
            return self._mock_kline_json(code)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return self._mock_kline_json(code)

    def _mock_kline_json(self, code):
        n_dates = pd.date_range("2010-01-01", "2026-12-31", freq='W')
        n = len(n_dates)
        np.random.seed(42)
        base = 12.0
        opens = base + np.cumsum(np.random.randn(n) * 0.5)
        closes = opens + np.random.randn(n) * 0.6
        highs = np.maximum(opens, closes) + np.random.rand(n) * 0.5
        lows = np.minimum(opens, closes) - np.random.rand(n) * 0.5
        values = [[round(opens[i],2), round(closes[i],2), round(lows[i],2), round(highs[i],2)] for i in range(n)]
        data = {
            "dates": [d.strftime('%Y-%m-%d') for d in n_dates],
            "values": values
        }
        if len(data['dates']) > 2000:
            data['dates'] = data['dates'][-2000:]
            data['values'] = data['values'][-2000:]
        return json.dumps(data)

    @Slot(str, result=str)
    def get_latest_price(self, code):
        try:
            result = self.data_feed.get_latest_price(code)
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(str, result=str)
    def get_realtime_quote(self, code):
        """获取实时行情（腾讯接口优先），失败时降级到数据库最近收盘价。"""
        try:
            result = self.data_feed.get_realtime_price(code)
            if result and result.get('price', 0) > 0:
                change = round(result['price'] - result['prev_close'], 2)
                return json.dumps({
                    "success": True,
                    "source": "realtime",
                    "code": code,
                    "price": result['price'],
                    "prev_close": result['prev_close'],
                    "open": result.get('open', 0),
                    "change": change,
                    "change_pct": result.get('change_pct', 0),
                    "high": result.get('high', 0),
                    "low": result.get('low', 0),
                    "volume": result.get('volume', 0),
                    "amount": result.get('amount', 0),
                })
            # 降级：使用数据库中的最近收盘价
            fallback = self.data_feed.get_latest_price(code)
            if 'error' not in fallback:
                fallback['success'] = True
                fallback['source'] = 'db'
                fallback['code'] = code
                return json.dumps(fallback)
            return json.dumps({"success": False, "error": fallback.get('error', '获取行情失败')})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, str, result=str)
    def get_limit_status(self, code, target_date=""):
        """预留接口：获取股票在指定日期的涨跌停状态。

        :param code: 股票代码
        :param target_date: 'YYYY-MM-DD' 日期字符串
        :return: JSON 字符串，含 is_limit_up / is_limit_down / limit_up_price / limit_down_price
        """
        try:
            prev_close = self.data_feed.get_prev_close(code, target_date if target_date else None)
            if prev_close is None:
                return json.dumps({"is_limit_up": False, "is_limit_down": False,
                                   "limit_up_price": 0, "limit_down_price": 0,
                                   "prev_close": 0, "note": "无法获取前收盘价"})
            limit_up = round(prev_close * 1.1, 2)
            limit_down = round(prev_close * 0.9, 2)
            return json.dumps({
                "is_limit_up": False,
                "is_limit_down": False,
                "limit_up_price": limit_up,
                "limit_down_price": limit_down,
                "prev_close": prev_close,
                "note": "涨跌停价格已计算，实际涨停/跌停状态需结合当日最高/最低价判断"
            })
        except Exception as e:
            return json.dumps({"error": str(e)})

    @Slot(str, result=str)
    def get_industry(self, code):
        try:
            industry = self.db.get_industry_by_code(code)
            return json.dumps({"industry": industry if industry else "未知"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"industry": "未知"})

    @Slot(str, result=str)
    def get_stocks_by_industry(self, industry_name):
        try:
            stocks = self.db.get_stocks_by_industry(industry_name)
            return json.dumps(stocks)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps([])

    @Slot(str, result=str)
    def get_stock_financial(self, code):
        """获取个股财务数据（最新）"""
        try:
            code_pure = code.split('.')[0]
            # 生成 ts_code
            if code_pure.startswith(('6', '9')):
                ts_code = f"{code_pure}.SH"
            elif code_pure.startswith('8'):
                ts_code = f"{code_pure}.BJ"
            else:
                ts_code = f"{code_pure}.SZ"

            sql = text("""
                SELECT pe_ttm, pb, roe, total_mv, net_profit, float_shares, update_date
                FROM stock_financial
                WHERE ts_code = :ts_code
            """)
            with self.db.engine.connect() as conn:
                row = conn.execute(sql, {"ts_code": ts_code}).fetchone()
            if row:
                result = {
                    "success": True,
                    "pe_ttm": row[0],
                    "pb": row[1],
                    "roe": row[2],
                    "total_mv": row[3],
                    "net_profit": row[4],
                    "float_shares": row[5],
                    "update_date": row[6],
                }
            else:
                result = {"success": False, "error": "无财务数据"}
            return json.dumps(result, ensure_ascii=False)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_all_stocks(self):
        """返回所有股票代码列表（从 stock_basic 读取）"""
        try:
            from sqlalchemy import text
            sql = text("SELECT DISTINCT code FROM stock_basic ORDER BY code")
            with self.db.engine.connect() as conn:
                rows = conn.execute(sql).fetchall()
            result = [str(row[0]) for row in rows]
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps([])

    @Slot(str, result=str)
    def get_index_stocks(self, index_code):
        """返回指数成分股代码列表（从数据库读取）"""
        try:
            sql = text("SELECT stock_code FROM index_components WHERE index_code = :index_code ORDER BY stock_code")
            with self.db.engine.connect() as conn:
                rows = conn.execute(sql, {"index_code": index_code}).fetchall()
            if rows:
                codes = [row[0] for row in rows]
                return json.dumps(codes)
            else:
                # 如果没有数据，尝试触发一次更新（异步或直接调用，但注意性能）
                # 简单起见，返回空数组并提示用户手动更新
                return json.dumps([])
        except Exception as e:
            traceback.print_exc()
            return json.dumps([])

    @Slot(str, str, str, result=str)
    def run_backtest(self, code, start_date="2010-01-01", end_date="2026-12-31"):
        try:
            signals, ma_data = self.strategy_engine.run_backtest(code, start_date, end_date)
            equity_curve = self._get_equity_curve(code)
            return json.dumps({"success": True, "signals": signals, "ma_data": ma_data, "equity_curve": equity_curve})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, result=str)
    def get_stocks_by_prefix(self, prefix):
        """获取股票代码以指定前缀开头的股票列表（纯数字代码）"""
        try:
            sql = text("SELECT code FROM stock_basic WHERE code LIKE :prefix")
            with self.db.engine.connect() as conn:
                rows = conn.execute(sql, {"prefix": f"{prefix}%"}).fetchall()
            codes = [row[0] for row in rows]
            return json.dumps(codes)
        except Exception as e:
            traceback.print_exc()
            return json.dumps([])

    # ---- 新增自定义策略回测槽 ----
    @Slot(str, result=str)
    def run_custom_backtest(self, params_json):
        """
        接收 JSON 字符串，格式:
        {
            "code": "...",          # 策略代码
            "stock": "000001",     # 股票代码
            "start": "2010-01-01",
            "end": "2026-12-31",
            "cash": 1000000
        }
        返回 JSON:
        {
            "success": True,
            "signals": [...],
            "equity_curve": [...],
            "metrics": {...}
        }
        """
        try:
            params = json.loads(params_json)
            user_code = params.get("code", "")
            stock_code = params.get("stock", "000001")
            start = params.get("start", "2010-01-01")
            end = params.get("end", "2026-12-31")
            cash = params.get("cash", 1000000)
            slippage = params.get("slippage", "close")
            commission = params.get("commission_rate", 0.0003)
            stamp_tax = params.get("stamp_tax_rate", 0.001)
            slippage_cost_type = params.get("slippage_cost_type", "percent")
            slippage_cost_value = params.get("slippage_cost_value", 0.1)

            # 调试日志：输出接收到的策略代码信息


            result = self.backtest_executor.run(user_code, stock_code, start, end, initial_cash=cash, slippage=slippage,
                                                commission_rate=commission, stamp_tax_rate=stamp_tax,
                                                slippage_cost_type=slippage_cost_type, slippage_cost_value=slippage_cost_value)

            # 输出后端日志最后5条
            print(f"[Bridge] 后端日志(最后5条): {result.get('logs', [])[-5:]}", flush=True)

            if "error" in result:
                return json.dumps({"success": False, "error": result["error"]})
            return json.dumps({
                "success": True,
                "signals": result.get("signals", []),
                "equity_curve": result.get("equity_curve", []),
                "metrics": result.get("metrics", {}),
                "logs": result.get("logs", [])
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    # ---- 多股组合回测槽 ----
    @Slot(str, result=str)
    def run_multi_backtest(self, params_json):
        """
        接收 JSON 字符串，格式:
        {
            "code": "...",              # 策略代码（含 STOCK_CODE_PLACEHOLDER 占位符）
            "stocks": ["000001","000858","300750"],
            "start": "2020-01-01",
            "end": "2025-12-31",
            "cash": 1000000,
            "slippage": "close"
        }
        返回 JSON:
        {
            "success": true,
            "signals": [{"date":"...","code":"000001","type":"buy","price":12.35,"shares":800}, ...],
            "equity_curve": [{"date":"...","value":1000000}, ...],
            "metrics": {...},
            "logs": [...],
            "errors": []
        }
        """
        try:
            params = json.loads(params_json)
            user_code = params.get("code", "")
            stocks = params.get("stocks", [])
            start = params.get("start", "2010-01-01")
            end = params.get("end", "2026-12-31")
            cash = params.get("cash", 1000000)
            slippage = params.get("slippage", "close")
            commission = params.get("commission_rate", 0.0003)
            stamp_tax = params.get("stamp_tax_rate", 0.001)
            slippage_cost_type = params.get("slippage_cost_type", "percent")
            slippage_cost_value = params.get("slippage_cost_value", 0.1)

            if not user_code:
                return json.dumps({"success": False, "error": "策略代码为空"})
            if not stocks or len(stocks) == 0:
                return json.dumps({"success": False, "error": "股票列表为空"})

            # 去重并清理股票代码
            stocks = list(dict.fromkeys([s.split('.')[0] for s in stocks]))

            result = self.multi_backtest_executor.run(
                user_code, stocks, start, end,
                initial_cash=cash, slippage=slippage,
                commission_rate=commission, stamp_tax_rate=stamp_tax,
                slippage_cost_type=slippage_cost_type, slippage_cost_value=slippage_cost_value
            )

            print(f"[Bridge] 多股回测完成: {len(stocks)}只股票, 信号{len(result.get('signals',[]))}个", flush=True)

            if not result.get("success"):
                return json.dumps({"success": False, "error": result.get("error", "回测失败")})

            return json.dumps({
                "success": True,
                "signals": result.get("signals", []),
                "equity_curve": result.get("equity_curve", []),
                "metrics": result.get("metrics", {}),
                "logs": result.get("logs", []),
                "errors": result.get("errors", []),
                "stock_performance": result.get("stock_performance", [])
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    # ---- 多策略对比回测 ----

    @Slot(str, result=str)
    def run_compare_backtest(self, params_json):
        """
        接收 JSON 字符串，格式:
        {
            "stock_code": "000001",
            "start": "2020-01-01",
            "end": "2025-12-31",
            "cash": 1000000,
            "slippage": "close",
            "commission_rate": 0.0003,
            "stamp_tax_rate": 0.001,
            "slippage_cost_type": "percent",
            "slippage_cost_value": 0.1,
            "variations": [
                { "name": "MA5-MA20", "code": "import numpy as np\\n..." },
                { "name": "MA10-MA30", "code": "import numpy as np\\n..." }
            ]
        }
        返回 JSON:
        {
            "success": true,
            "results": [{ name, equity_curve, metrics, signals }],
            "errors": []
        }
        """
        try:
            params = json.loads(params_json)
            stock_code = params.get("stock_code", "000001")
            start = params.get("start", "2010-01-01")
            end = params.get("end", "2026-12-31")
            cash = params.get("cash", 1000000)
            slippage = params.get("slippage", "close")
            commission = params.get("commission_rate", 0.0003)
            stamp_tax = params.get("stamp_tax_rate", 0.001)
            slippage_cost_type = params.get("slippage_cost_type", "percent")
            slippage_cost_value = params.get("slippage_cost_value", 0.1)
            variations = params.get("variations", [])

            if not variations or len(variations) == 0:
                return json.dumps({"success": False, "error": "变体列表为空"})

            results = []
            errors = []

            def run_single_variation(variation):
                """执行单个变体回测，返回 (name, result_dict, error_str)。"""
                name = variation.get("name", "未命名")
                code = variation.get("code", "")
                try:
                    if not code:
                        return (name, None, "变体代码为空")

                    from backend.data_feed import DataFeed
                    from backend.backtest_executor import BacktestExecutor
                    data_feed = DataFeed()
                    executor = BacktestExecutor(data_feed)
                    result = executor.run(
                        code, stock_code, start, end,
                        initial_cash=cash, slippage=slippage,
                        commission_rate=commission, stamp_tax_rate=stamp_tax,
                        slippage_cost_type=slippage_cost_type,
                        slippage_cost_value=slippage_cost_value
                    )

                    if "error" in result:
                        return (name, None, result["error"])

                    return (name, {
                        "name": name,
                        "equity_curve": result.get("equity_curve", []),
                        "metrics": result.get("metrics", {}),
                        "signals": result.get("signals", []),
                        "logs": result.get("logs", [])
                    }, None)
                except Exception as e:
                    traceback.print_exc(file=sys.stderr)
                    return (name, None, str(e))

            # 并行执行（最多5个线程）
            with ThreadPoolExecutor(max_workers=min(len(variations), 5)) as executor:
                futures = {executor.submit(run_single_variation, v): v for v in variations}
                for future in as_completed(futures):
                    name, result_dict, error_str = future.result()
                    if result_dict is not None:
                        results.append(result_dict)
                    if error_str is not None:
                        errors.append({"name": name, "error": error_str})

            # 保持变体原始顺序
            results.sort(key=lambda r: [v.get("name", "") for v in variations].index(r["name"])
                         if r["name"] in [v.get("name", "") for v in variations] else 999)



            return json.dumps({
                "success": True,
                "results": results,
                "errors": errors
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, result=str)
    def get_stock_concepts(self, code):
        """获取股票的概念题材列表"""
        try:
            pure_code = code.split('.')[0]
            if pure_code.startswith(('6', '9')):
                ts_code = f"{pure_code}.SH"
            elif pure_code.startswith('8'):
                ts_code = f"{pure_code}.BJ"
            else:
                ts_code = f"{pure_code}.SZ"
            sql = text("""
                SELECT c.concept_name
                FROM stock_concept sc
                JOIN concept c ON sc.concept_id = c.concept_id
                WHERE sc.ts_code = :ts_code
            """)
            with self.db.engine.connect() as conn:
                rows = conn.execute(sql, {"ts_code": ts_code}).fetchall()
            concepts = [row[0] for row in rows]
            return json.dumps({"success": True, "concepts": concepts})
        except Exception as e:
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_concept_list(self):
        """返回所有概念名称列表，用于前端下拉框"""
        try:
            df = pd.read_sql("SELECT concept_name FROM concept ORDER BY concept_name", self.db.engine)
            return json.dumps(df['concept_name'].tolist(), ensure_ascii=False)
        except Exception as e:
            return json.dumps([])

    @Slot(result=str)
    def get_industry_list(self):
        """返回所有一级行业列表"""
        try:
            df = pd.read_sql(
                "SELECT DISTINCT industry_level1 FROM stock_industry_detail "
                "WHERE industry_level1 IS NOT NULL AND industry_level1 != '' "
                "ORDER BY industry_level1",
                self.db.engine
            )
            return json.dumps(df['industry_level1'].tolist(), ensure_ascii=False)
        except Exception as e:
            return json.dumps([])

    @Slot(str, str, str, result=str)
    def filter_stocks_by_concepts(self, codes_json, concepts_json, match_mode="any"):
        """根据概念过滤股票列表，返回匹配的纯数字代码列表"""
        try:
            codes = json.loads(codes_json) if isinstance(codes_json, str) else codes_json
            concepts = json.loads(concepts_json) if isinstance(concepts_json, str) else concepts_json
            if not codes or not concepts:
                return json.dumps(codes if codes else [])

            ts_codes = []
            for c in codes:
                c = str(c).split('.')[0].zfill(6)
                if c.startswith(('000', '001', '002', '003', '300', '301')):
                    ts_codes.append(f"{c}.SZ")
                elif c.startswith(('600', '601', '603', '605', '688', '689')):
                    ts_codes.append(f"{c}.SH")
                elif c.startswith('8'):
                    ts_codes.append(f"{c}.BJ")
                else:
                    ts_codes.append(f"{c}.SZ")

            if not ts_codes:
                return json.dumps([])

            placeholders = ','.join([f"'{t}'" for t in ts_codes])
            concept_placeholders = ','.join([f"'{c}'" for c in concepts])

            if match_mode == 'all':
                sql = text(f"""
                    SELECT sc.ts_code
                    FROM stock_concept sc
                    JOIN concept c ON sc.concept_id = c.concept_id
                    WHERE sc.ts_code IN ({placeholders})
                      AND c.concept_name IN ({concept_placeholders})
                    GROUP BY sc.ts_code
                    HAVING COUNT(DISTINCT c.concept_name) = :cnt
                """)
                params = {"cnt": len(concepts)}
            else:
                sql = text(f"""
                    SELECT DISTINCT sc.ts_code
                    FROM stock_concept sc
                    JOIN concept c ON sc.concept_id = c.concept_id
                    WHERE sc.ts_code IN ({placeholders})
                      AND c.concept_name IN ({concept_placeholders})
                """)
                params = {}

            with self.db.engine.connect() as conn:
                rows = conn.execute(sql, params).fetchall()

            result = [row[0].replace('.SZ', '').replace('.SH', '').replace('.BJ', '') for row in rows]
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(str, str, result=str)
    def filter_stocks_by_industry(self, codes_json, industry):
        """根据一级行业过滤股票列表，返回匹配的纯数字代码列表"""
        try:
            codes = json.loads(codes_json) if isinstance(codes_json, str) else codes_json
            if not codes or not industry:
                return json.dumps(codes if codes else [])

            ts_codes = []
            for c in codes:
                c = str(c).split('.')[0].zfill(6)
                if c.startswith(('000', '001', '002', '003', '300', '301')):
                    ts_codes.append(f"{c}.SZ")
                elif c.startswith(('600', '601', '603', '605', '688', '689')):
                    ts_codes.append(f"{c}.SH")
                elif c.startswith('8'):
                    ts_codes.append(f"{c}.BJ")
                else:
                    ts_codes.append(f"{c}.SZ")

            if not ts_codes:
                return json.dumps([])

            placeholders = ','.join([f"'{t}'" for t in ts_codes])
            sql = text(f"""
                SELECT DISTINCT ts_code
                FROM stock_industry_detail
                WHERE ts_code IN ({placeholders})
                  AND industry_level1 = :industry
            """)

            with self.db.engine.connect() as conn:
                rows = conn.execute(sql, {"industry": industry}).fetchall()

            result = [row[0].replace('.SZ', '').replace('.SH', '').replace('.BJ', '') for row in rows]
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(str, str, str, result=str)
    def filter_stocks_by_market_cap(self, codes_json, min_cap="", max_cap=""):
        """按总市值区间过滤股票列表（单位：亿元），空值表示不限制"""
        try:
            codes = json.loads(codes_json) if isinstance(codes_json, str) else codes_json
            if not codes:
                return json.dumps([])

            min_val = float(min_cap) if min_cap and str(min_cap).strip() else None
            max_val = float(max_cap) if max_cap and str(max_cap).strip() else None

            if min_val is None and max_val is None:
                return json.dumps(codes)

            ts_codes = []
            for c in codes:
                c = str(c).split('.')[0].zfill(6)
                if c.startswith(('000', '001', '002', '003', '300', '301')):
                    ts_codes.append(f"{c}.SZ")
                elif c.startswith(('600', '601', '603', '605', '688', '689')):
                    ts_codes.append(f"{c}.SH")
                elif c.startswith('8'):
                    ts_codes.append(f"{c}.BJ")
                else:
                    ts_codes.append(f"{c}.SZ")

            if not ts_codes:
                return json.dumps([])

            placeholders = ','.join([f"'{t}'" for t in ts_codes])
            conditions = ["total_mv IS NOT NULL"]
            params = {}
            if min_val is not None:
                conditions.append("total_mv >= :min_val")
                params['min_val'] = min_val
            if max_val is not None:
                conditions.append("total_mv <= :max_val")
                params['max_val'] = max_val

            sql = text(f"""
                SELECT ts_code FROM stock_financial
                WHERE ts_code IN ({placeholders})
                  AND {' AND '.join(conditions)}
            """)

            with self.db.engine.connect() as conn:
                rows = conn.execute(sql, params).fetchall()

            result = [row[0].replace('.SZ', '').replace('.SH', '').replace('.BJ', '') for row in rows]
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(str, str, str, result=str)
    def filter_stocks_by_float_shares(self, codes_json, min_shares="", max_shares=""):
        """按流通股本区间过滤股票列表（单位：亿股），空值表示不限制"""
        try:
            codes = json.loads(codes_json) if isinstance(codes_json, str) else codes_json
            if not codes:
                return json.dumps([])

            min_val = float(min_shares) if min_shares and str(min_shares).strip() else None
            max_val = float(max_shares) if max_shares and str(max_shares).strip() else None

            if min_val is None and max_val is None:
                return json.dumps(codes)

            ts_codes = []
            for c in codes:
                c = str(c).split('.')[0].zfill(6)
                if c.startswith(('000', '001', '002', '003', '300', '301')):
                    ts_codes.append(f"{c}.SZ")
                elif c.startswith(('600', '601', '603', '605', '688', '689')):
                    ts_codes.append(f"{c}.SH")
                elif c.startswith('8'):
                    ts_codes.append(f"{c}.BJ")
                else:
                    ts_codes.append(f"{c}.SZ")

            if not ts_codes:
                return json.dumps([])

            placeholders = ','.join([f"'{t}'" for t in ts_codes])
            conditions = ["float_shares IS NOT NULL"]
            params = {}
            if min_val is not None:
                conditions.append("float_shares >= :min_val")
                params['min_val'] = min_val
            if max_val is not None:
                conditions.append("float_shares <= :max_val")
                params['max_val'] = max_val

            sql = text(f"""
                SELECT ts_code FROM stock_financial
                WHERE ts_code IN ({placeholders})
                  AND {' AND '.join(conditions)}
            """)

            with self.db.engine.connect() as conn:
                rows = conn.execute(sql, params).fetchall()

            result = [row[0].replace('.SZ', '').replace('.SH', '').replace('.BJ', '') for row in rows]
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(str, result=str)
    def get_signals(self, code):
        try:
            return json.dumps({"signals": self.strategy_engine.get_signals(code)})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(str, str, int, float, str, result=str)
    def execute_trade(self, code, action, shares, price, trade_date=""):
        try:
            return json.dumps(self.trade.execute_trade(code, action, shares, price, trade_date if trade_date else None))
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": str(e)})

    @Slot(result=str)
    def get_portfolio(self):
        try:
            portfolio = self.trade.get_portfolio()
            holdings = portfolio.get("holdings")
            if isinstance(holdings, dict):
                holdings_list = []
                for code, info in holdings.items():
                    item = info.copy()
                    item['code'] = code
                    holdings_list.append(item)
                holdings = holdings_list
                portfolio['holdings'] = holdings
            total_market = portfolio.get('cash', 0.0)
            for h in holdings:
                code = h['code']
                try:
                    latest = self.data_feed.get_latest_price(code)
                    if 'error' not in latest:
                        price = latest['price']
                        h['price'] = price
                        shares = h['shares']
                        cost = h['cost']
                        market_value = round(price * shares, 2)
                        h['profit'] = round(market_value - cost * shares, 2)
                except Exception:
                    pass
                total_market += h.get('market_value', h.get('price', h['cost']) * h['shares'])
            portfolio['total_assets'] = round(total_market, 2)
            if isinstance(holdings, dict):
                enhanced_holdings = {}
                for code, info in holdings.items():
                    display = self.db.get_name_by_code(code)
                    enhanced_holdings[code] = info
                    if isinstance(enhanced_holdings[code], dict):
                        enhanced_holdings[code]["display"] = display
                    else:
                        enhanced_holdings[code] = {"value": info, "display": display}
                portfolio["holdings"] = enhanced_holdings
            elif isinstance(holdings, list):
                enhanced_holdings = []
                for item in holdings:
                    if isinstance(item, dict) and 'code' in item:
                        code = item['code']
                        display = self.db.get_name_by_code(code)
                        item["display"] = display
                    enhanced_holdings.append(item)
                portfolio["holdings"] = enhanced_holdings
            return json.dumps(portfolio)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(result=str)
    def test_db_connection(self):
        try:
            return json.dumps(self.db.connection_status())
        except Exception as e:
            return json.dumps({"connected": False, "message": str(e)})

    @Slot(result=str)
    def get_traded_stocks(self):
        try:
            portfolio = self.trade.get_portfolio()
            holdings = portfolio.get("holdings", [])
            codes = []
            if isinstance(holdings, dict):
                raw_codes = list(holdings.keys())
                for code in raw_codes:
                    display = self.db.get_name_by_code(code)
                    codes.append({"code": code, "display": display})
            elif isinstance(holdings, list):
                for item in holdings:
                    if isinstance(item, dict) and 'code' in item:
                        code = item['code']
                        display = self.db.get_name_by_code(code)
                        codes.append({"code": code, "display": display})
            return json.dumps({"stocks": codes})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"stocks": []})

    @Slot(str, result=str)
    def search_stock(self, keyword):
        try:
            result = self.db.search_stock(keyword)
            for item in result:
                item["display"] = f"{item['name']} ({item['code']})"
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps([])

    # ---------- 策略相关 Slot ----------
    @Slot(result=str)
    def list_strategies(self):
        try:
            return json.dumps(self.strategy_storage.list_strategies())
        except Exception as e:
            return json.dumps([])

    @Slot(int, result=str)
    def load_strategy(self, strategy_id):
        try:
            s = self.strategy_storage.get_strategy(strategy_id)
            if s:
                return json.dumps(s)
            return json.dumps({"error": "未找到"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(str, str, int, result=str)
    def save_strategy(self, name, code, strategy_id):
        try:
            new_obj = self.strategy_storage.save_strategy(name, code, strategy_id)
            return json.dumps({"success": True, "id": new_obj['id']})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": str(e)})

    @Slot(int, result=str)
    def delete_strategy(self, strategy_id):
        try:
            ok = self.strategy_storage.delete_strategy(strategy_id)
            return json.dumps({"success": ok})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": str(e)})
    # ----------------------------------------

    @Slot(result=str)
    def trigger_data_update(self):
        """手动触发数据更新（独立子进程，避免 Baostock 与 QtWebEngine 冲突）"""
        if self._update_process is not None and self._update_process.poll() is None:
            return json.dumps({"success": False, "message": "已有更新进程正在运行，请稍后再试"})

        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        script_path = os.path.join(base_dir, 'backend', 'standalone_updater.py')
        if not os.path.exists(script_path):
            return json.dumps({"success": False, "message": f"更新脚本不存在: {script_path}"})

        try:
            startupinfo = None
            if sys.platform == 'win32':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = subprocess.SW_HIDE
            self._update_process = subprocess.Popen(
                [sys.executable, script_path, '--quiet'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                startupinfo=startupinfo
            )
            self._read_update_output()
            return json.dumps({"success": True, "message": "数据更新已在后台启动，请稍后查看后端日志"})
        except Exception as e:
            return json.dumps({"success": False, "message": f"启动更新失败: {str(e)}"})

    @Slot(result=str)
    def trigger_financial_update(self):
        """手动触发财务数据更新（独立子进程，更新 PE/PB/ROE/总市值/流通股本等）。"""
        if self._financial_update_process is not None and self._financial_update_process.poll() is None:
            return json.dumps({"success": False, "message": "财务数据更新已在运行中，请稍后再试"})

        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        script_path = os.path.join(base_dir, 'backend', 'standalone_updater.py')
        if not os.path.exists(script_path):
            return json.dumps({"success": False, "message": f"更新脚本不存在: {script_path}"})

        try:
            startupinfo = None
            if sys.platform == 'win32':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = subprocess.SW_HIDE
            self._financial_update_process = subprocess.Popen(
                [sys.executable, script_path, '--type', 'financial', '--quiet'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                startupinfo=startupinfo
            )
            # 异步读取输出，完成后自动清空进程句柄
            threading.Thread(target=self._read_financial_update_output, daemon=True).start()
            return json.dumps({"success": True, "message": "财务数据更新已在后台启动（预计 3-10 分钟），请稍后查看后端日志"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": f"启动财务更新失败: {str(e)}"})

    def _read_financial_update_output(self):
        """后台线程读取财务更新子进程输出"""
        proc = self._financial_update_process
        if proc is None:
            return
        for line in proc.stdout:
            print(f"[FinancialUpdater] {line.decode('utf-8', errors='replace').strip()}")
        for line in proc.stderr:
            print(f"[FinancialUpdater Error] {line.decode('utf-8', errors='replace').strip()}")
        proc.wait()
        success = (proc.returncode == 0)
        msg = "财务数据更新成功" if success else f"财务数据更新失败 (返回码: {proc.returncode})"
        print(f"[WebBridge] 财务更新子进程退出，{msg}")
        self._financial_update_process = None

    # ---------- 报告导出 ----------
    @Slot(str, result=str)
    def export_report(self, data_json):
        """接收回测数据 JSON，生成 Excel 和 PDF 报告，弹出目录选择对话框保存。"""
        try:
            data = json.loads(data_json)
            # 兼容下划线命名（多股回测结果使用 snake_case）
            if 'equity_curve' in data and 'equityCurve' not in data:
                data['equityCurve'] = data['equity_curve']
            if 'stock_performance' in data and 'stockPerformance' not in data:
                data['stockPerformance'] = data['stock_performance']
            from backend.report_exporter import export_to_excel, export_to_pdf
            from PySide6.QtWidgets import QFileDialog

            base_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'temp_reports')
            os.makedirs(base_dir, exist_ok=True)

            timestamp = int(time.time())
            excel_name = f'report_{timestamp}.xlsx'
            pdf_name = f'report_{timestamp}.pdf'
            excel_path = os.path.join(base_dir, excel_name)
            pdf_path = os.path.join(base_dir, pdf_name)

            export_to_excel(data, excel_path)
            export_to_pdf(data, pdf_path)

            # 弹出目录选择对话框
            dest_dir = QFileDialog.getExistingDirectory(None, '选择保存目录')
            if not dest_dir:
                # 用户取消，清理临时文件
                os.remove(excel_path)
                os.remove(pdf_path)
                return json.dumps({"success": False, "cancelled": True})

            # 复制文件到目标目录
            dest_excel = os.path.join(dest_dir, excel_name)
            dest_pdf = os.path.join(dest_dir, pdf_name)
            shutil.copy2(excel_path, dest_excel)
            shutil.copy2(pdf_path, dest_pdf)

            # 清理临时文件
            os.remove(excel_path)
            os.remove(pdf_path)

            return json.dumps({
                "success": True,
                "excel": dest_excel,
                "pdf": dest_pdf,
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, str, result=str)
    def save_text_file(self, content, suggested_name):
        """弹出原生保存对话框，将文本内容写入用户选择的文件。"""
        try:
            from PySide6.QtWidgets import QFileDialog

            dest_path, _ = QFileDialog.getSaveFileName(
                None, "保存文件", suggested_name,
                "CSV 文件 (*.csv);;文本文件 (*.txt);;Python 文件 (*.py);;所有文件 (*)"
            )
            if not dest_path:
                return json.dumps({"success": False, "cancelled": True})

            # CSV 文件使用 utf-8-sig (含 BOM)，确保 Excel 正确打开中文
            encoding = 'utf-8-sig' if dest_path.lower().endswith('.csv') else 'utf-8'
            with open(dest_path, 'w', encoding=encoding) as f:
                f.write(content)

            return json.dumps({"success": True, "path": dest_path})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    def _read_update_output(self):
        """读取子进程输出并打印到控制台（后台线程，不阻塞 UI）"""
        def read_output():
            proc = self._update_process
            if proc is None:
                return
            for line in proc.stdout:
                print(f"[Updater] {line.decode('utf-8').strip()}")
            for line in proc.stderr:
                print(f"[Updater Error] {line.decode('utf-8').strip()}")
            proc.wait()
            print(f"[Updater] 子进程退出，返回码: {proc.returncode}")
            self._update_process = None
        threading.Thread(target=read_output, daemon=True).start()

    def _get_equity_curve(self, code):
        try:
            df = self.data_feed.get_kline_json(code)
            if not hasattr(df, 'to_dict'):
                return []
            df = df.tail(30)
            initial_cash = 1000000.0
            curve = []
            for i, row in df.iterrows():
                base_close = df.iloc[0]['close']
                ratio = row['close'] / base_close
                equity = initial_cash * ratio
                curve.append({"date": row['trade_date'].strftime('%Y-%m-%d'), "value": round(equity,2)})
            return curve
        except Exception:
            return []
