import json
import sys
import os
import re
import secrets
import time
import shutil
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np
import pandas as pd
from PySide6.QtCore import QObject, Slot, Signal
from backend.data_feed import DataFeed
from backend.strategy_engine import StrategyEngine
from backend.trade_simulation import TradeSimulation
from backend.db import Database
from backend.strategy_storage import StrategyStorage
from backend.backtest_executor import BacktestExecutor   # 新增导入
from backend.multi_backtest_executor import MultiBacktestExecutor # 多股回测
from backend.stock_screener import StockScreener
from backend.realtime_strategy_engine import RealtimeStrategyEngine
from backend.multi_realtime_strategy_engine import MultiRealtimeStrategyEngine
from backend.realtime_quote_fetcher import RealtimeQuoteFetcher
from backend.fund_flow_fetcher import FundFlowFetcher
from backend import realtime_config
from backend.config_manager import load_config, save_config, get_progress_path
from backend.stock_updater import update_stock_if_needed, IdleUpdater
from backend.auto_trader import create_auto_trader
from backend.auto_trade_config import load_auto_trade_config, save_auto_trade_config
from backend.backtest_worker import BacktestWorker
from backend.backtest_job_manager import BacktestJobManager
from backend.optimization import OptunaWorker
from backend.sector_heat import SectorHeatCalculator
from sqlalchemy import text
import threading
import time
from PySide6.QtCore import Slot, Signal

try:
    import win32gui
    import win32con
    from pynput import mouse
    MOUSE_LISTENER_AVAILABLE = True
except ImportError:
    MOUSE_LISTENER_AVAILABLE = False
    print("警告: pynput 或 pywin32 未安装，窗口标题捕获功能不可用")

from PySide6.QtCore import QThread


class DataUpdateWorker(QThread):
    """后台线程：执行日线数据更新，不阻塞 UI。"""

    def __init__(self, db_engine, fetcher, options, parent=None):
        super().__init__(parent)
        self.db_engine = db_engine
        self.fetcher = fetcher
        self.options = options

    def run(self):
        from backend.data_updater.daily_kline_updater import StockDailyUpdater
        try:
            updater = StockDailyUpdater(self.db_engine, fetcher=self.fetcher)
            updater._update_options = self.options
            success, msg = updater._safe_run()
            print(f"[DataUpdateWorker] 更新完成: success={success}, msg={msg}")
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            print(f"[DataUpdateWorker] 更新异常: {e}")


class FinancialUpdateWorker(QThread):
    """后台线程：执行财务数据更新，不阻塞 UI。"""

    def __init__(self, updater, parent=None):
        super().__init__(parent)
        self.updater = updater

    def run(self):
        try:
            success, msg = self.updater._safe_run()
            print(f"[FinancialUpdateWorker] 更新完成: success={success}, msg={msg}")
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            print(f"[FinancialUpdateWorker] 更新异常: {e}")


class ConceptUpdateWorker(QThread):
    """后台线程：执行概念题材数据更新，不阻塞 UI。"""

    def __init__(self, db_engine, parent=None):
        super().__init__(parent)
        self.db_engine = db_engine

    def run(self):
        from backend.data_updater.concept_updater import ConceptUpdater
        try:
            updater = ConceptUpdater(self.db_engine)
            success, msg = updater._safe_run()
            print(f"[ConceptUpdateWorker] 概念题材更新完成: success={success}, msg={msg}")
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            print(f"[ConceptUpdateWorker] 概念题材更新异常: {e}")


class IndustryUpdateWorker(QThread):
    """后台线程：执行行业分类数据更新，不阻塞 UI。"""

    def __init__(self, db_engine, parent=None):
        super().__init__(parent)
        self.db_engine = db_engine

    def run(self):
        try:
            from backend.industry import download_industry_components
            df = download_industry_components()
            print(f"[IndustryUpdateWorker] 行业分类更新完成: {len(df) if df is not None else 0} 条")
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            print(f"[IndustryUpdateWorker] 行业分类更新异常: {e}")


class WebBridge(QObject):
    coordinate_captured = Signal(int, int, str)
    window_title_captured = Signal(str)
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
        # In-memory caches for fast page-load (avoid DB queries on every nav click)
        self._concept_list_cache = None
        self._industry_list_cache = None
        self._latest_trade_date_cache = None
        self._realtime_engine = None   # 实时策略引擎实例
        self._multi_realtime_engine = None  # 多股实时策略引擎
        self._quote_fetcher = RealtimeQuoteFetcher()  # 批量行情获取器
        self._all_realtime_signals = []   # 所有实时信号历史
        self._update_thread = None   # 日线数据更新后台线程
        self._fin_update_thread = None  # 财务数据更新后台线程
        self._optimization_jobs = {}  # job_id -> {worker, progress, result, status}
        self._concept_update_thread = None  # 概念题材更新后台线程
        self._industry_update_thread = None  # 行业分类更新后台线程
        self._idle_updater = None     # 空闲后台更新器
        self._user_active = True      # 用户活动标志

        self.auto_trader = create_auto_trader(self.db.engine)
        self.auto_trader.notification.connect(self._on_auto_trade_notification)
        self.auto_trader.request_confirm.connect(self._on_auto_trade_confirm_request)

        self._backtest_job_manager = BacktestJobManager(self)

        self._capturing_coordinate = False
        self._capture_target = ''
        self._capture_thread = None
        self.coordinate_captured.connect(self._on_coordinate_captured)

        self._capturing_title = False
        self._mouse_listener = None
        self.window_title_captured.connect(self._on_window_title_captured)

        df = DataFeed()

        # Ensure trade_date index exists for fast MAX lookup
        try:
            with self.db.engine.connect() as conn:
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS idx_sd_trade_date "
                    "ON stock_daily_qfq_with_name(trade_date)"
                ))
                conn.commit()
        except Exception:
            pass  # non-critical, best-effort

    def _prewarm_kline_cache(self):
        """Pre-load common stock data into DataFeed cache (background thread, non-blocking)."""
        from concurrent.futures import ThreadPoolExecutor
        common = ['000001', '000858', '600519', '300750', '000333',
                  '601318', '000651', '002415', '600036', '601012']
        def _load():
            for code in common:
                try:
                    self.data_feed.get_kline_json(code)
                except Exception:
                    pass
        ThreadPoolExecutor(max_workers=1).submit(_load)

    @Slot()
    def start_capture_window_title(self):
        """启动窗口标题捕获模式（监听全局鼠标点击）。"""
        if not MOUSE_LISTENER_AVAILABLE:
            self.window_title_captured.emit("")
            return

        if self._capturing_title:
            return

        self._capturing_title = True

        def on_click(x, y, button, pressed):
            if not self._capturing_title:
                return False
            if pressed and button == mouse.Button.left:
                # 获取点击位置的窗口句柄
                hwnd = win32gui.WindowFromPoint((x, y))
                # 获取窗口标题
                title = win32gui.GetWindowText(hwnd)
                if title:
                    self.window_title_captured.emit(title)
                else:
                    self.window_title_captured.emit("")
                self._stop_capture()
                return False  # 停止监听
            return True

        # 在后台线程启动监听器
        def run_listener():
            with mouse.Listener(on_click=on_click) as listener:
                self._mouse_listener = listener
                listener.join()
            self._mouse_listener = None

        threading.Thread(target=run_listener, daemon=True).start()

        # 设置超时自动取消（如10秒）
        def auto_timeout():
            time.sleep(10)
            if self._capturing_title:
                self._stop_capture()
                self.window_title_captured.emit("")  # 超时返回空

        threading.Thread(target=auto_timeout, daemon=True).start()

    def _stop_capture(self):
        self._capturing_title = False
        if self._mouse_listener:
            self._mouse_listener.stop()
            self._mouse_listener = None

    @Slot()
    def cancel_capture_window_title(self):
        """取消捕获（前端可调用）。"""
        self._stop_capture()
        self.window_title_captured.emit("")

    def _on_window_title_captured(self, title):
        """窗口标题捕获结果 → 推送到前端。"""
        try:
            safe = json.dumps(title) if title else '""'
            js = f"if(window.onWindowTitleCaptured)window.onWindowTitleCaptured({safe})"
            self.web_view.page().runJavaScript(js)
        except Exception:
            pass

    @staticmethod
    def _to_json_safe(obj):
        """递归转换 numpy 类型为 Python 原生类型，确保 JSON 可序列化。"""
        if isinstance(obj, dict):
            return {k: WebBridge._to_json_safe(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [WebBridge._to_json_safe(v) for v in obj]
        if isinstance(obj, (bool,)):
            return bool(obj)
        try:
            import numpy as _np
            if isinstance(obj, (_np.integer,)):
                return int(obj)
            if isinstance(obj, (_np.floating,)):
                return float(obj)
            if isinstance(obj, (_np.bool_,)):
                return bool(obj)
            if isinstance(obj, _np.ndarray):
                return obj.tolist()
        except ImportError:
            pass
        return obj

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

    @Slot(str, str, str, str, str, result=str)
    def screen_stocks(self, cards_json, stock_pool_json, start_date, end_date, pre_filters_json=""):
        """批量选股接口：接收卡片列表JSON、股票池JSON、起止日期、预筛选JSON，返回筛选结果"""
        try:
            cards = json.loads(cards_json) if isinstance(cards_json, str) else cards_json
            stock_pool = json.loads(stock_pool_json) if isinstance(stock_pool_json, str) and stock_pool_json else None
            pre_filters = json.loads(pre_filters_json) if isinstance(pre_filters_json, str) and pre_filters_json else None
            if not start_date or start_date.strip() == '':
                start_date = None
            if not end_date or end_date.strip() == '':
                end_date = None

            stocks = self.stock_screener.screen_stocks_batch(
                cards=cards,
                stock_pool=stock_pool if stock_pool else None,
                start_date=start_date,
                end_date=end_date,
                logic="AND",
                pre_filters=pre_filters
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
        """返回数据库中全局最新交易日期（带缓存，索引加速）"""
        if self._latest_trade_date_cache is not None:
            return self._latest_trade_date_cache
        try:
            with self.db.engine.connect() as conn:
                row = conn.execute(
                    text("SELECT MAX(trade_date) FROM stock_daily_qfq_with_name")
                ).scalar()
            self._latest_trade_date_cache = json.dumps(
                {"success": True, "date": str(row) if row else None}
            )
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            self._latest_trade_date_cache = json.dumps({"success": False, "error": str(e)})
        return self._latest_trade_date_cache

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

    @Slot(str, str, str, result=str)
    def get_index_data(self, code, start_date="2010-01-01", end_date="2026-12-31"):
        try:
            df = self.db.get_index_kline(code, start_date, end_date)
            if df is None or df.empty:
                return json.dumps({"error": "无数据"})
            dates = df['trade_date'].tolist()
            values = []
            amounts = []
            for _, row in df.iterrows():
                values.append([
                    float(row['open']) if pd.notna(row['open']) else 0.0,
                    float(row['close']) if pd.notna(row['close']) else 0.0,
                    float(row['low']) if pd.notna(row['low']) else 0.0,
                    float(row['high']) if pd.notna(row['high']) else 0.0,
                    int(float(row['volume'])) if pd.notna(row['volume']) else 0
                ])
                amounts.append(float(row['amount']) if pd.notna(row['amount']) else 0.0)
            return json.dumps({"dates": dates, "values": values, "amounts": amounts})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

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
        """获取个股财务数据（最新）+ 行业/概念补充信息"""
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

            # 补充行业信息（含 Baostock 更新日期）
            try:
                ind_sql = text("SELECT industry, update_date FROM stock_industry WHERE ts_code = :ts_code LIMIT 1")
                with self.db.engine.connect() as conn:
                    ind_row = conn.execute(ind_sql, {"ts_code": ts_code}).fetchone()
                if ind_row:
                    result["industry_name"] = ind_row[0]
                    result["industry_update_date"] = ind_row[1]
            except Exception:
                pass

            # 补充概念数量
            try:
                cnt_sql = text("SELECT COUNT(*) FROM stock_concept WHERE ts_code = :ts_code")
                with self.db.engine.connect() as conn:
                    result["concept_count"] = conn.execute(cnt_sql, {"ts_code": ts_code}).scalar() or 0
            except Exception:
                result["concept_count"] = 0

            # 补充全局更新时间戳
            config = load_config()
            result["last_concept_update"] = config.get("last_concept_update", "")
            result["last_industry_update"] = config.get("last_industry_update", "")

            return json.dumps(result, ensure_ascii=False)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    # ---------- 资金流向 Slot ----------
    @Slot(str, result=str)
    def get_fund_flow(self, code):
        """获取单只股票实时资金流向及建议。

        :param code: 股票代码
        :return: JSON 字符串，含 data 和 suggestion 字段
        """
        try:
            pure_code = FundFlowFetcher._normalize_code(code)
            if pure_code is None:
                return json.dumps({"success": False, "error": f"无效代码: {code}"})

            fetcher = FundFlowFetcher(cache_ttl=60)
            data = fetcher.get_fund_flow(pure_code)
            if data is None:
                return json.dumps({"success": False, "error": "获取资金流向失败"})

            # 查询近 5 日历史（不含当日），用于生成建议
            today = data.get("date", "")
            history = self.db.get_fund_flow_history(pure_code, end_date=today, limit=6)
            # 过滤掉当日数据（如果历史表中已有）
            history = [h for h in history if h.get("date", "") != today]
            recent = history[-5:] if len(history) > 5 else history

            suggestion = self._generate_suggestion(data, recent)

            return json.dumps({
                "success": True,
                "data": data,
                "suggestion": suggestion,
            }, ensure_ascii=False)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, result=str)
    def get_batch_fund_flow(self, codes_json):
        """批量获取资金流向（最多 50 只）。

        :param codes_json: JSON 数组字符串，如 '["000001","600519"]'
        :return: JSON 字符串，含 quotes 字典
        """
        try:
            codes = json.loads(codes_json) if isinstance(codes_json, str) else codes_json
            if not codes:
                return json.dumps({"success": False, "error": "代码列表为空"})

            codes = codes[:50]  # 限制最多 50 只
            normalized = []
            for c in codes:
                pure = FundFlowFetcher._normalize_code(c)
                if pure:
                    normalized.append(pure)

            if not normalized:
                return json.dumps({"success": False, "error": "无有效代码"})

            fetcher = FundFlowFetcher(cache_ttl=60)
            quotes = fetcher.get_batch_fund_flow(normalized)

            return json.dumps({
                "success": True,
                "quotes": quotes,
            }, ensure_ascii=False)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @staticmethod
    def _generate_suggestion(current, history):
        """根据当日资金流向和历史趋势生成中文建议。

        Args:
            current: 当日资金流向 dict，含 main_net(万元) 等字段
            history: 近 N 日历史记录列表（按日期升序），每条含 main_net 等字段

        Returns:
            str: 中文建议文案
        """
        main_net = current.get("main_net") if current else None
        source = current.get("source", "") if current else ""

        if main_net is None:
            return "今日主力资金流向数据暂缺，建议观望"

        # 计算历史趋势
        hist_values = [h.get("main_net") for h in (history or []) if h.get("main_net") is not None]

        def _fmt(val):
            """格式化金额，大额用「亿」，小额用「万」。"""
            if val is None:
                return "0万"
            abs_val = abs(val)
            if abs_val >= 10000:
                return f"{abs_val/10000:.2f}亿"
            return f"{abs_val:.0f}万"

        direction = "流入" if main_net > 0 else "流出"
        abs_main = _fmt(main_net)

        # 无历史数据时的简单建议
        if not hist_values:
            if main_net > 5000:
                return f"主力净流入{abs_main}，大额资金进场，建议关注"
            if main_net < -3000:
                return f"主力净流出{abs_main}，资金离场明显，注意风险"
            if abs(main_net) < 2000:
                return f"主力小幅净{direction}{abs_main}，建议观望"
            return f"主力净{direction}{abs_main}"

        # 计算最近连续同向天数
        recent = hist_values[-3:]  # 最近 3 日
        same_dir = 0
        for v in reversed(recent):
            if (main_net > 0 and v > 0) or (main_net < 0 and v < 0):
                same_dir += 1
            else:
                break

        # 计算累计
        cumulative = main_net + sum(recent)
        cum_str = _fmt(cumulative)

        # 规则 1：主力单日大幅净流入 + 连续同向
        if main_net > 5000:
            if same_dir >= 2:
                return f"主力连续{same_dir + 1}日净流入（含今日），累计+{cum_str}，资金持续进场，建议关注"
            return f"主力净流入{abs_main}，大额资金进场，建议关注"

        # 规则 2：主力单日大幅净流出 + 连续同向
        if main_net < -3000:
            if same_dir >= 2:
                return f"主力连续{same_dir + 1}日净流出（含今日），累计-{cum_str}，注意风险"
            return f"主力净流出{abs_main}，资金离场明显，注意风险"

        # 规则 3：主力小幅净流入（0~2000万）
        if 0 < main_net < 2000:
            if same_dir >= 1:
                return f"主力连续小幅净流入，累计+{cum_str}，建议观望"
            return f"主力小幅净流入{abs_main}，建议观望"

        # 规则 4：主力小幅净流出
        if -2000 < main_net < 0:
            if same_dir >= 1:
                return f"主力连续小幅净流出，累计-{cum_str}，建议观望"
            return f"主力小幅净流出{abs_main}，建议观望"

        # 默认
        if main_net > 0:
            return f"主力净流入{abs_main}，近{same_dir + 1}日持续流入，累计+{cum_str}"
        else:
            return f"主力净流出{abs_main}，近{same_dir + 1}日持续流出，累计-{cum_str}"

    @Slot(str, int, result=str)
    def get_fund_flow_history(self, code, days=5):
        """查询某只股票近 N 日资金流向历史。

        :param code: 股票代码
        :param days: 返回最近多少天的数据
        :return: JSON 字符串，含 history 数组
        """
        try:
            pure_code = FundFlowFetcher._normalize_code(code)
            if pure_code is None:
                return json.dumps({"success": False, "error": f"无效代码: {code}"})

            today = __import__('datetime').datetime.now().strftime("%Y-%m-%d")
            history = self.db.get_fund_flow_history(pure_code, end_date=today, limit=days)

            return json.dumps({
                "success": True,
                "code": pure_code,
                "history": history,
            }, ensure_ascii=False)
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
            return json.dumps({"success": True, "signa ls": signals, "ma_data": ma_data, "equity_curve": equity_curve})
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

    # ---- 基准指数列表 ----
    @Slot(result=str)
    def get_benchmark_list(self):
        """返回可用的基准指数列表。"""
        benchmarks = [
            {"code": "000300.SH", "name": "沪深300"},
            {"code": "000001.SH", "name": "上证指数"},
            {"code": "399001.SZ", "name": "深证成指"},
            {"code": "000905.SH", "name": "中证500"},
            {"code": "399006.SZ", "name": "创业板指"},
        ]
        return json.dumps(benchmarks, ensure_ascii=False)

    # ---- 新增自定义策略回测槽（异步：立即返回 job_id，后台执行） ----
    @Slot(str, result=str)
    def run_custom_backtest(self, params_json):
        """Start single-stock backtest in background QThread. Returns {success, job_id} immediately."""
        try:
            params = json.loads(params_json)
            params["mode"] = "single"
            worker = BacktestWorker(params)
            job_id = self._backtest_job_manager.start_job(worker)
            return json.dumps({"success": True, "job_id": job_id, "message": "回测已启动"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    # ---- 多股组合回测槽（异步） ----
    @Slot(str, result=str)
    def run_multi_backtest(self, params_json):
        """Start multi-stock backtest in background QThread. Returns {success, job_id} immediately."""
        try:
            params = json.loads(params_json)
            params["mode"] = "multi"
            worker = BacktestWorker(params)
            job_id = self._backtest_job_manager.start_job(worker)
            return json.dumps({"success": True, "job_id": job_id, "message": "多股回测已启动"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    # ---- 多策略对比回测（异步） ----

    @Slot(str, result=str)
    def run_compare_backtest(self, params_json):
        """Start compare backtest in background QThread. Returns {success, job_id} immediately."""
        try:
            params = json.loads(params_json)
            stock_pool = params.get("stock_pool", None)
            stock_code = params.get("stock_code", "000001")

            variations = params.get("variations", [])
            if not variations:
                return json.dumps({"success": False, "error": "变体列表为空"})

            if stock_pool and isinstance(stock_pool, list) and len(stock_pool) > 0:
                stock_pool = list(dict.fromkeys([s.split('.')[0] for s in stock_pool]))
            else:
                stock_pool = [stock_code.split('.')[0]]

            params["mode"] = "compare"
            params["stock_pool"] = stock_pool
            params["use_multi"] = len(stock_pool) > 1

            worker = BacktestWorker(params)
            job_id = self._backtest_job_manager.start_job(worker)
            return json.dumps({"success": True, "job_id": job_id, "message": "对比回测已启动"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    # ── 异步回测进度/结果/取消 ──

    @Slot(str, result=str)
    def get_backtest_progress(self, job_id):
        """Poll progress of a running backtest job. Returns {status, current, total}."""
        try:
            progress = self._backtest_job_manager.get_progress(job_id)
            return json.dumps(progress)
        except Exception as e:
            return json.dumps({"status": "error", "error": str(e)})

    @Slot(str, result=str)
    def get_backtest_result(self, job_id):
        """Get the completed backtest result. Returns {ready: false} if still running."""
        try:
            result = self._backtest_job_manager.get_result(job_id)
            if result is None:
                return json.dumps({"ready": False})
            return json.dumps({"ready": True, "result": WebBridge._to_json_safe(result)})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"ready": False, "error": str(e)})

    @Slot(str, result=str)
    def cancel_backtest(self, job_id):
        """Cancel a running backtest job."""
        try:
            self._backtest_job_manager.cancel_job(job_id)
            return json.dumps({"success": True})
        except Exception as e:
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, result=str)
    def cleanup_backtest(self, job_id):
        """Remove a finished job from memory."""
        try:
            self._backtest_job_manager.cleanup_job(job_id)
            return json.dumps({"success": True})
        except Exception as e:
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
        """返回所有概念名称列表，用于前端下拉框（带缓存）"""
        if self._concept_list_cache is not None:
            return self._concept_list_cache
        try:
            df = pd.read_sql("SELECT concept_name FROM concept ORDER BY concept_name", self.db.engine)
            self._concept_list_cache = json.dumps(df['concept_name'].tolist(), ensure_ascii=False)
        except Exception as e:
            self._concept_list_cache = json.dumps([])
        return self._concept_list_cache

    @Slot(result=str)
    def get_industry_list(self):
        """返回所有一级行业列表（带缓存）"""
        if self._industry_list_cache is not None:
            return self._industry_list_cache
        try:
            df = pd.read_sql(
                "SELECT DISTINCT industry_level1 FROM stock_industry_detail "
                "WHERE industry_level1 IS NOT NULL AND industry_level1 != '' "
                "ORDER BY industry_level1",
                self.db.engine
            )
            self._industry_list_cache = json.dumps(df['industry_level1'].tolist(), ensure_ascii=False)
        except Exception as e:
            self._industry_list_cache = json.dumps([])
        return self._industry_list_cache

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
    def get_portfolio_summary(self):
        """返回持仓汇总：总市值、总成本、浮动盈亏"""
        try:
            raw = self.trade.get_portfolio()
            holdings = raw.get("holdings", {})
            total_cost = 0.0
            total_market_value = 0.0
            items = []
            if isinstance(holdings, dict):
                for code, info in holdings.items():
                    items.append({"code": code, "shares": info["shares"], "cost": info["cost"]})
            else:
                items = holdings

            for h in items:
                code = h["code"]
                shares = h["shares"]
                cost = h["cost"]
                total_cost += cost * shares
                price = cost
                try:
                    latest = self.data_feed.get_latest_price(code)
                    if "error" not in latest:
                        price = latest["price"]
                except Exception:
                    pass
                total_market_value += price * shares

            total_cost = round(total_cost, 2)
            total_market_value = round(total_market_value, 2)
            total_profit = round(total_market_value - total_cost, 2)
            profit_pct = round(total_profit / total_cost * 100, 2) if total_cost > 0 else 0.0

            return json.dumps({
                "success": True,
                "total_market_value": total_market_value,
                "total_cost": total_cost,
                "total_profit": total_profit,
                "profit_pct": profit_pct
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def close_all_positions(self):
        """一键平仓：卖出所有持仓"""
        try:
            raw = self.trade.get_portfolio()
            holdings = raw.get("holdings", {})
            items = []
            if isinstance(holdings, dict):
                for code, info in holdings.items():
                    items.append({"code": code, "shares": info["shares"], "cost": info["cost"]})
            else:
                items = holdings

            if not items:
                return json.dumps({"success": True, "message": "没有持仓需要平仓", "closed": 0, "failed": 0})

            today = __import__('datetime').datetime.now().strftime("%Y-%m-%d")
            closed = 0
            failed = 0
            for h in items:
                code = h["code"]
                shares = h["shares"]
                price = h["cost"]
                try:
                    latest = self.data_feed.get_latest_price(code)
                    if "error" not in latest:
                        price = latest["price"]
                except Exception:
                    pass
                result = self.trade.execute_trade(code, "sell", shares, price, today)
                if result.get("success"):
                    closed += 1
                else:
                    failed += 1

            return json.dumps({
                "success": True,
                "message": f"平仓完成：成功 {closed} 只，失败 {failed} 只",
                "closed": closed,
                "failed": failed
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def reset_portfolio(self):
        """重置模拟盘：清空持仓和交易记录，恢复初始资金"""
        try:
            self.trade = TradeSimulation()
            return json.dumps({"success": True, "message": "模拟盘已重置，初始资金 1,000,000 元"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_daily_assets(self):
        """返回基于交易历史重构的每日净资产曲线"""
        try:
            from datetime import datetime, timedelta
            history = list(self.trade.history)
            if not history:
                return json.dumps({
                    "success": True, "dates": [], "cash": [],
                    "total_assets": [], "daily_returns": [], "cumulative_returns": []
                })

            sorted_hist = sorted(history, key=lambda x: x['date'])
            first_date = sorted_hist[0]['date']
            last_date = sorted_hist[-1]['date']

            start = datetime.strptime(first_date, '%Y-%m-%d')
            end = datetime.strptime(last_date, '%Y-%m-%d')

            # Limit range to avoid excessive iteration
            max_days = 600
            if (end - start).days > max_days:
                start = end - timedelta(days=max_days)

            # Group trades by date
            trades_by_date = {}
            for t in sorted_hist:
                d = t['date']
                if d not in trades_by_date:
                    trades_by_date[d] = []
                trades_by_date[d].append(t)

            cash = 1000000.0
            holdings = {}  # {code: shares}
            cost_basis = {}  # {code: avg_cost}

            dates_out = []
            cash_out = []
            assets_out = []

            current = start
            prev_total = 1000000.0
            price_cache = {}  # {code: {date: price}}

            while current <= end:
                date_str = current.strftime('%Y-%m-%d')

                # Apply trades for this date
                if date_str in trades_by_date:
                    for t in trades_by_date[date_str]:
                        code = t['code']
                        shares = t['shares']
                        price = t['price']
                        if t['type'] == '买入':
                            cost = price * shares
                            cash -= cost
                            old_shares = holdings.get(code, 0)
                            old_cost = cost_basis.get(code, 0)
                            new_shares = old_shares + shares
                            holdings[code] = new_shares
                            cost_basis[code] = round((old_cost * old_shares + cost) / new_shares, 2) if new_shares > 0 else 0
                        else:
                            cash += price * shares
                            holdings[code] = holdings.get(code, 0) - shares
                            if holdings[code] <= 0:
                                holdings.pop(code, None)
                                cost_basis.pop(code, None)

                # Calculate market value of current holdings
                market_value = 0.0
                for code, shares in holdings.items():
                    if shares > 0:
                        if code not in price_cache:
                            price_cache[code] = {}
                        if date_str not in price_cache[code]:
                            p = self.data_feed.get_close_price_on_date(code, date_str)
                            price_cache[code][date_str] = p
                        close_p = price_cache[code].get(date_str)
                        if close_p is None:
                            close_p = cost_basis.get(code, 0)
                        market_value += close_p * shares

                total_assets = round(cash + market_value, 2)

                dates_out.append(date_str)
                cash_out.append(round(cash, 2))
                assets_out.append(total_assets)

                current += timedelta(days=1)

            # Calculate returns
            initial = 1000000.0
            daily_returns = []
            cumulative_returns = []
            prev_assets = initial
            for i, ta in enumerate(assets_out):
                dr = round((ta - prev_assets) / prev_assets * 100, 2) if prev_assets != 0 else 0
                cr = round((ta - initial) / initial * 100, 2)
                daily_returns.append(dr)
                cumulative_returns.append(cr)
                prev_assets = ta

            return json.dumps({
                "success": True,
                "dates": dates_out,
                "cash": cash_out,
                "total_assets": assets_out,
                "daily_returns": daily_returns,
                "cumulative_returns": cumulative_returns
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

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

    # ---------- 实时策略 Slot ----------
    @Slot(str, result=str)
    def start_realtime_strategy(self, params_json):
        """启动实时策略引擎。
        params_json: {"stock_code":"000001","strategy_code":"...","cash":100000,"interval":3}
        """
        try:
            params = json.loads(params_json)
            stock_code = params.get("stock_code", "")
            strategy_code = params.get("strategy_code", "")
            cash = float(params.get("cash", 100000))
            interval = float(params.get("interval", 3))

            if not stock_code or not strategy_code:
                return json.dumps({"success": False, "message": "股票代码或策略代码为空"})

            if self._realtime_engine and self._realtime_engine.running:
                return json.dumps({"success": False, "message": "已有实时策略正在运行，请先停止"})

            self._realtime_engine = RealtimeStrategyEngine(
                stock_code=stock_code,
                user_code=strategy_code,
                trade_sim=self.trade,
                initial_cash=cash,
                quote_interval=interval,
                on_signal=self._on_realtime_signal,
                on_log=None,
                auto_trader=self.auto_trader,
            )
            self._realtime_engine.start()
            return json.dumps({"success": True, "message": "实时策略已启动"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": str(e)})

    @Slot(result=str)
    def stop_realtime_strategy(self):
        """停止实时策略引擎。"""
        try:
            if not self._realtime_engine or not self._realtime_engine.running:
                return json.dumps({"success": False, "message": "没有正在运行的实时策略"})
            self._realtime_engine.stop()
            return json.dumps({"success": True, "message": "实时策略已停止"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": str(e)})

    @Slot(result=str)
    def get_realtime_signals(self):
        """获取实时策略产生的新交易信号。"""
        try:
            if not self._realtime_engine:
                return json.dumps({"success": True, "signals": [], "running": False})
            signals = self._realtime_engine.get_new_signals()
            return json.dumps({
                "success": True,
                "signals": signals,
                "running": self._realtime_engine.running,
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_realtime_logs(self):
        """获取实时策略引擎产生的新日志。"""
        try:
            if not self._realtime_engine:
                return json.dumps({"success": True, "logs": [], "running": False})
            logs = self._realtime_engine.get_new_logs()
            return json.dumps({
                "success": True,
                "logs": logs,
                "running": self._realtime_engine.running,
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    # ---------- 信号回调与历史 ----------
    def _on_realtime_signal(self, signal):
        self._all_realtime_signals.append(signal)

    @Slot(result=str)
    def get_realtime_signals_history(self):
        """获取所有实时信号历史（供 K 线页面叠加显示）。"""
        try:
            return json.dumps({
                "success": True,
                "signals": self._all_realtime_signals
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    # ---------- 多股实时策略 Slot ----------
    @Slot(str, result=str)
    def start_multi_realtime_strategy(self, params_json):
        """启动多股实时策略引擎。"""
        try:
            params = json.loads(params_json)
            stock_codes = params.get("stock_codes", [])
            strategy_code = params.get("strategy_code", "")
            cash = float(params.get("cash", 100000))
            interval = float(params.get("interval", 3))
            commission_rate = float(params.get("commission_rate", 0.0003))
            stamp_tax_rate = float(params.get("stamp_tax_rate", 0.001))
            slippage_cost_type = params.get("slippage_cost_type", "percent")
            slippage_cost_value = float(params.get("slippage_cost_value", 0.1))

            if not stock_codes:
                return json.dumps({"success": False, "message": "股票池为空"})
            if not strategy_code:
                return json.dumps({"success": False, "message": "策略代码为空"})

            if self._multi_realtime_engine and self._multi_realtime_engine.running:
                return json.dumps({"success": False, "message": "已有策略正在运行，请先停止"})

            self._multi_realtime_engine = MultiRealtimeStrategyEngine(
                stock_codes=stock_codes,
                user_code=strategy_code,
                trade_sim=self.trade,
                initial_cash=cash,
                quote_interval=interval,
                on_signal=self._on_realtime_signal,
                commission_rate=commission_rate,
                stamp_tax_rate=stamp_tax_rate,
                slippage_cost_type=slippage_cost_type,
                slippage_cost_value=slippage_cost_value,
                auto_trader=self.auto_trader,
            )
            self._multi_realtime_engine.start()

            # 持久化配置
            realtime_config.save_config({
                "type": "multi",
                "stock_codes": stock_codes,
                "strategy_code": strategy_code,
                "cash": cash,
                "interval": interval,
                "commission_rate": commission_rate,
                "stamp_tax_rate": stamp_tax_rate,
                "slippage_cost_type": slippage_cost_type,
                "slippage_cost_value": slippage_cost_value,
                "start_time": __import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                "running": True,
            })

            return json.dumps({"success": True, "message": f"多股策略已启动 ({len(stock_codes)} 只股票)"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": str(e)})

    @Slot(result=str)
    def stop_multi_realtime_strategy(self):
        """停止多股实时策略引擎。"""
        try:
            if not self._multi_realtime_engine or not self._multi_realtime_engine.running:
                return json.dumps({"success": False, "message": "没有正在运行的策略"})
            self._multi_realtime_engine.stop()
            realtime_config.clear_config()
            return json.dumps({"success": True, "message": "多股策略已停止"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": str(e)})

    @Slot(result=str)
    def get_multi_realtime_signals(self):
        """获取多股实时策略的新交易信号。"""
        try:
            if not self._multi_realtime_engine:
                return json.dumps({"success": True, "signals": [], "running": False})
            signals = self._multi_realtime_engine.get_new_signals()
            return json.dumps({
                "success": True,
                "signals": signals,
                "running": self._multi_realtime_engine.running,
                "stock_codes": self._multi_realtime_engine.stock_codes,
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_multi_realtime_logs(self):
        """获取多股实时策略引擎的新日志。"""
        try:
            if not self._multi_realtime_engine:
                return json.dumps({"success": True, "logs": [], "running": False})
            logs = self._multi_realtime_engine.get_new_logs()
            return json.dumps({
                "success": True,
                "logs": logs,
                "running": self._multi_realtime_engine.running,
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_multi_realtime_all_signals(self):
        """获取多股实时策略引擎的所有信号（不消费游标），供页面恢复时使用。"""
        try:
            if not self._multi_realtime_engine:
                return json.dumps({"success": True, "signals": [], "running": False})
            signals = self._multi_realtime_engine.get_all_signals()
            return json.dumps({
                "success": True,
                "signals": signals,
                "running": self._multi_realtime_engine.running,
                "stock_codes": self._multi_realtime_engine.stock_codes,
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_multi_realtime_all_logs(self):
        """获取多股实时策略引擎的所有日志（不消费游标），供页面恢复时使用。"""
        try:
            if not self._multi_realtime_engine:
                return json.dumps({"success": True, "logs": [], "running": False})
            logs = self._multi_realtime_engine.get_all_logs()
            return json.dumps({
                "success": True,
                "logs": logs,
                "running": self._multi_realtime_engine.running,
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_current_realtime_config(self):
        """返回当前运行的实时策略配置（从持久化文件读取），供页面恢复时填充表单。"""
        try:
            config = realtime_config.load_config()
            if config:
                return json.dumps({"success": True, "config": config})
            return json.dumps({"success": False, "error": "无运行中策略"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, result=str)
    def get_realtime_quotes(self, codes_json):
        """批量获取实时行情。codes_json: JSON 数组如 ["000001","000858"]。"""
        try:
            codes = json.loads(codes_json) if isinstance(codes_json, str) else codes_json
            if not codes:
                return json.dumps({"success": False, "error": "代码列表为空"})
            quotes = self._quote_fetcher.fetch_quotes(codes)
            return json.dumps({"success": True, "quotes": quotes})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    def auto_restore_realtime_strategy(self):
        """应用启动时检查是否有未停止的实时策略配置，询问用户是否恢复。"""
        try:
            config = realtime_config.load_config()
            if not config or not config.get("running"):
                return

            from PySide6.QtWidgets import QMessageBox
            stock_codes = config.get("stock_codes", [])
            start_time = config.get("start_time", "未知")
            msg = (f"检测到上次未停止的实时策略：\n"
                   f"股票池：{', '.join(stock_codes[:5])}"
                   f"{'...' if len(stock_codes) > 5 else ''} ({len(stock_codes)} 只)\n"
                   f"启动时间：{start_time}\n\n是否恢复运行？")

            reply = QMessageBox.question(
                self.main_window, "恢复实时策略",
                msg,
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.Yes
            )

            if reply == QMessageBox.Yes:
                strategy_code = config.get("strategy_code", "")
                cash = config.get("cash", 100000)
                interval = config.get("interval", 3)
                commission_rate = config.get("commission_rate", 0.0003)
                stamp_tax_rate = config.get("stamp_tax_rate", 0.001)
                slippage_cost_type = config.get("slippage_cost_type", "percent")
                slippage_cost_value = config.get("slippage_cost_value", 0.1)

                self._multi_realtime_engine = MultiRealtimeStrategyEngine(
                    stock_codes=stock_codes,
                    user_code=strategy_code,
                    trade_sim=self.trade,
                    initial_cash=cash,
                    quote_interval=interval,
                    on_signal=self._on_realtime_signal,
                    commission_rate=commission_rate,
                    stamp_tax_rate=stamp_tax_rate,
                    slippage_cost_type=slippage_cost_type,
                    slippage_cost_value=slippage_cost_value,
                    auto_trader=self.auto_trader,
                )
                self._multi_realtime_engine.start()
                print(f"[WebBridge] 已恢复实时策略 ({len(stock_codes)} 只股票)")
            else:
                realtime_config.clear_config()
                print("[WebBridge] 用户拒绝恢复，配置已清除")
        except Exception as e:
            traceback.print_exc(file=sys.stderr)

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
    # ---------- 回测历史记录 CRUD ----------
    @Slot(str, result=str)
    def save_backtest_result(self, json_str):
        try:
            data = json.loads(json_str)
            now = __import__('datetime').datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with self.db.engine.connect() as conn:
                result = conn.execute(text("""
                    INSERT INTO backtest_history
                    (strategy_name, stock_pool, start_date, end_date, initial_cash, metrics, signals, equity_curve, stock_performance, created_at)
                    VALUES (:name, :pool, :start, :end, :cash, :metrics, :signals, :equity, :perf, :created)
                """), {
                    "name": data.get("strategyName"),
                    "pool": json.dumps(data.get("stockPool", [])),
                    "start": data.get("startDate"),
                    "end": data.get("endDate"),
                    "cash": data.get("initialCash"),
                    "metrics": json.dumps(data.get("metrics")),
                    "signals": json.dumps(data.get("signals")),
                    "equity": json.dumps(data.get("equityCurve")),
                    "perf": json.dumps(data.get("stockPerformance")),
                    "created": now
                })
                conn.commit()
                return json.dumps({"success": True, "id": result.lastrowid})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_backtest_history(self):
        try:
            with self.db.engine.connect() as conn:
                rows = conn.execute(text("""
                    SELECT id, strategy_name, stock_pool, start_date, end_date,
                           created_at, metrics
                    FROM backtest_history ORDER BY id DESC
                """)).fetchall()
            result = []
            for row in rows:
                metrics = {}
                try:
                    metrics = json.loads(row[6]) if row[6] else {}
                except Exception:
                    pass
                pool = []
                try:
                    pool = json.loads(row[2]) if row[2] else []
                except Exception:
                    pass
                result.append({
                    "id": row[0],
                    "name": row[1],
                    "stock_pool": pool,
                    "start": row[3],
                    "end": row[4],
                    "date": row[5],
                    "total_return": metrics.get("total_return")
                })
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps([])

    @Slot(int, result=str)
    def load_backtest_history(self, record_id):
        try:
            with self.db.engine.connect() as conn:
                row = conn.execute(
                    text("SELECT * FROM backtest_history WHERE id = :id"),
                    {"id": record_id}
                ).fetchone()
            if not row:
                return json.dumps({"error": "记录不存在"})
            return json.dumps({
                "success": True,
                "strategyName": row[1],
                "stockPool": json.loads(row[2]) if row[2] else [],
                "startDate": row[3],
                "endDate": row[4],
                "initialCash": row[5],
                "metrics": json.loads(row[6]) if row[6] else {},
                "signals": json.loads(row[7]) if row[7] else [],
                "equityCurve": json.loads(row[8]) if row[8] else [],
                "stockPerformance": json.loads(row[9]) if row[9] else []
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(int, result=str)
    def delete_backtest_history(self, record_id):
        try:
            with self.db.engine.connect() as conn:
                conn.execute(
                    text("DELETE FROM backtest_history WHERE id = :id"),
                    {"id": record_id}
                )
                conn.commit()
            return json.dumps({"success": True})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})
    # ----------------------------------------

    @Slot(str, result=str)
    def trigger_data_update(self, options_json=""):
        """手动触发数据更新（使用 QThread 后台运行，不阻塞 UI）。"""
        if self._update_thread is not None and self._update_thread.isRunning():
            return json.dumps({"success": False, "message": "已有更新进程正在运行，请稍后再试"})

        try:
            options = {}
            if options_json and options_json.strip():
                try:
                    options = json.loads(options_json) if isinstance(options_json, str) else options_json
                except Exception:
                    pass

            # 清理旧进度文件
            try:
                progress_path = get_progress_path()
                if os.path.exists(progress_path):
                    os.remove(progress_path)
            except Exception:
                pass

            # 创建 QThread worker
            from backend.data_updater.daily_kline_updater import StockDailyUpdater, create_fetcher
            from backend.config_manager import load_config as _load_cfg
            cfg = _load_cfg()
            fetcher = create_fetcher(source=cfg.get('data_source', 'baostock'),
                                     token=cfg.get('tushare_token', ''))
            worker = DataUpdateWorker(self.db.engine, fetcher, options)
            worker.finished.connect(lambda: self._on_data_update_done())
            self._update_thread = worker
            worker.start()

            return json.dumps({"success": True, "message": "数据更新已在后台启动"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": f"启动更新失败: {str(e)}"})

    def _on_data_update_done(self):
        """数据更新线程完成后的回调。"""
        print("[WebBridge] 数据更新线程结束")

    def _on_concept_update_done(self):
        """概念题材更新完成后记录时间戳。"""
        self._concept_update_thread = None
        try:
            from datetime import datetime
            config = load_config()
            config["last_concept_update"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            save_config(config)
            print("[WebBridge] 概念题材更新时间已记录")
        except Exception as e:
            print(f"[WebBridge] 记录概念更新时间失败: {e}")

    def _on_industry_update_done(self):
        """行业分类更新完成后记录时间戳。"""
        self._industry_update_thread = None
        try:
            from datetime import datetime
            config = load_config()
            config["last_industry_update"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            save_config(config)
            print("[WebBridge] 行业分类更新时间已记录")
        except Exception as e:
            print(f"[WebBridge] 记录行业更新时间失败: {e}")

    @Slot(result=str)
    def trigger_financial_update(self):
        """手动触发财务数据更新（后台线程，更新 PE/PB/ROE/总市值/流通股本等）。"""
        if self._fin_update_thread is not None and self._fin_update_thread.isRunning():
            return json.dumps({"success": False, "message": "财务数据更新已在运行中，请稍后再试"})

        try:
            from backend.data_updater.financial_updater import FinancialUpdater
            fin_updater = FinancialUpdater(self.db.engine)
            worker = FinancialUpdateWorker(fin_updater)
            worker.finished.connect(lambda: print("[WebBridge] 财务更新线程结束"))
            self._fin_update_thread = worker
            worker.start()

            return json.dumps({"success": True, "message": "财务数据更新已在后台启动（预计 3-10 分钟）"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": f"启动财务更新失败: {str(e)}"})

    @Slot(result=str)
    def trigger_concept_update(self):
        """手动触发概念题材数据更新（后台线程，使用 AkShare 获取板块概念）。"""
        if self._concept_update_thread is not None and self._concept_update_thread.isRunning():
            return json.dumps({"success": False, "message": "概念题材更新已在运行中，请稍后再试"})

        try:
            worker = ConceptUpdateWorker(self.db.engine)
            worker.finished.connect(lambda: self._on_concept_update_done())
            self._concept_update_thread = worker
            worker.start()
            # 清除缓存，下次查询时重新加载
            self._concept_list_cache = None
            return json.dumps({"success": True, "message": "概念题材更新已在后台启动（预计 3-10 分钟）"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": f"启动概念更新失败: {str(e)}"})

    @Slot(result=str)
    def trigger_industry_update(self):
        """手动触发行业分类数据更新（后台线程，使用 Baostock 获取行业数据）。"""
        if self._industry_update_thread is not None and self._industry_update_thread.isRunning():
            return json.dumps({"success": False, "message": "行业数据更新已在运行中，请稍后再试"})

        try:
            worker = IndustryUpdateWorker(self.db.engine)
            worker.finished.connect(lambda: self._on_industry_update_done())
            self._industry_update_thread = worker
            worker.start()
            # 清除缓存，下次查询时重新加载
            self._industry_list_cache = None
            return json.dumps({"success": True, "message": "行业数据更新已在后台启动（预计 1-3 分钟）"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": f"启动行业更新失败: {str(e)}"})

    # ---------- 参数优化 Slot ----------

    @Slot(str, result=str)
    def start_optimization(self, params_json):
        """启动 Optuna 参数优化搜索。

        params_json: {
            strategy_code, stock, start, end, cash,
            objective, n_trials,
            params_to_search: [{name, type, low, high, step?}],
            fixed_params: {name: value},
            slippage, commission_rate, stamp_tax_rate,
            slippage_cost_type, slippage_cost_value,
            benchmark_code
        }
        返回 {success, job_id}
        """
        try:
            params = json.loads(params_json) if isinstance(params_json, str) else params_json
        except Exception:
            return json.dumps({"success": False, "error": "参数 JSON 解析失败"})

        if not params.get("params_to_search"):
            return json.dumps({"success": False, "error": "没有选择要搜索的参数"})

        job_id = secrets.token_hex(6)

        worker = OptunaWorker(params)

        # 捕获进度
        def on_progress(prog):
            if job_id in self._optimization_jobs:
                self._optimization_jobs[job_id]["progress"] = prog

        # 捕获结果
        def on_finished(result):
            if job_id in self._optimization_jobs:
                if self._optimization_jobs[job_id].get("status") != "cancelled":
                    self._optimization_jobs[job_id]["result"] = result
                    self._optimization_jobs[job_id]["status"] = "finished"

        worker.progress.connect(on_progress)
        worker.finished.connect(on_finished)

        stock_codes = params.get("stock_codes")
        stock_count = len(stock_codes) if isinstance(stock_codes, list) else 1
        self._optimization_jobs[job_id] = {
            "worker": worker,
            "progress": {"current": 0, "total": params.get("n_trials", 100), "best_value": None, "stock_count": stock_count},
            "result": None,
            "status": "running",
        }

        worker.start()
        return json.dumps({"success": True, "job_id": job_id})

    @Slot(str, result=str)
    def get_optimization_progress(self, job_id):
        """轮询优化进度。

        返回 {status, progress: {current, total, best_value, last_trial?}}
        """
        job = self._optimization_jobs.get(job_id)
        if not job:
            return json.dumps({"status": "not_found"})
        return json.dumps({
            "status": job["status"],
            "progress": job["progress"],
        })

    @Slot(str, result=str)
    def get_optimization_result(self, job_id):
        """获取优化完成结果。

        返回 {ready: bool, result: {best_params, best_value, trials, param_importance}}
        """
        job = self._optimization_jobs.get(job_id)
        if not job:
            return json.dumps({"ready": False, "error": "job not found"})
        if job["status"] == "finished":
            result = job["result"]
            # 转为 JSON 安全格式
            safe = WebBridge._to_json_safe(result)
            # 清理 job
            del self._optimization_jobs[job_id]
            return json.dumps({"ready": True, "result": safe})
        return json.dumps({"ready": False})

    @Slot(str, result=str)
    def cancel_optimization(self, job_id):
        """取消正在运行的优化。"""
        job = self._optimization_jobs.get(job_id)
        if not job:
            return json.dumps({"success": False, "error": "job not found"})
        if job["worker"]:
            job["worker"].cancel()
        del self._optimization_jobs[job_id]
        return json.dumps({"success": True})

    # ---------- 板块热度仪表盘 ----------

    @Slot(str, str, int, bool, result=str)
    def get_sector_heat(self, sector_type="concept", metric="heat_score", days=5, realtime=False):
        """Return sector heat ranking data.

        Args:
            sector_type: 'concept' or 'industry'
            metric: 'heat_score' | 'change_pct' | 'fund_flow' | 'volume_ratio' | 'advance_decline'
            days: lookback window
            realtime: if True, use realtime quotes (not yet implemented)
        Returns:
            JSON string: {sectors: [{name, stock_count, avg_change_pct, ...}]}
        """
        try:
            calc = SectorHeatCalculator(self.db.engine)
            sectors = calc.compute(sector_type, metric, days, realtime=realtime)
            return json.dumps({"sectors": sectors})
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"sectors": [], "error": str(e)})

    @Slot(str, str, result=str)
    def get_sector_detail(self, sector_type, sector_name):
        """Return top component stocks for a sector.

        Args:
            sector_type: 'concept' or 'industry'
            sector_name: e.g. '人工智能' or '银行'
        Returns:
            JSON string: {name, stocks: [{code, name, change_pct, fund_flow}]}
        """
        try:
            calc = SectorHeatCalculator(self.db.engine)
            result = calc.get_sector_detail(sector_type, sector_name)
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"name": sector_name, "stocks": [], "error": str(e)})

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

    # ---------- 数据源配置 Slot ----------
    @Slot(bool, int, result=str)
    def save_idle_update_settings(self, enabled, days):
        """保存空闲后台更新设置。"""
        try:
            config = load_config()
            config["idle_update_enabled"] = enabled
            config["idle_update_days"] = days
            save_config(config)
            return json.dumps({"success": True, "message": "空闲更新设置已保存"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, result=str)
    def save_update_options(self, options_json):
        """保存更新选项到 config.json。
        options_json: {"update_kline":true,"update_turnover":false,"max_days_back":5}
        """
        try:
            options = json.loads(options_json) if isinstance(options_json, str) else options_json
            config = load_config()
            config["update_options"] = {
                "update_kline": options.get("update_kline", True),
                "update_turnover": options.get("update_turnover", False),
                "max_days_back": int(options.get("max_days_back", 0))
            }
            save_config(config)
            return json.dumps({"success": True, "message": "更新选项已保存"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_update_progress(self):
        """读取 update_progress.json，返回进度信息。"""
        try:
            progress_path = get_progress_path()
            if not os.path.exists(progress_path):
                return json.dumps({"status": "idle", "percent": 0, "message": ""})
            with open(progress_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return json.dumps(data)
        except Exception as e:
            return json.dumps({"status": "error", "percent": 0, "message": str(e)})

    @Slot(result=str)
    def get_data_source_config(self):
        """返回当前数据源配置（data_source, tushare_token, update_options）。"""
        try:
            config = load_config()
            return json.dumps({
                "success": True,
                "data_source": config.get("data_source", "baostock"),
                "tushare_token": config.get("tushare_token", ""),
                "update_options": config.get("update_options", {
                    "update_kline": True,
                    "update_turnover": False,
                    "max_days_back": 0
                }),
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, str, result=str)
    def set_data_source_config(self, source, token):
        """保存数据源配置，并返回结果。
        Args:
            source: 'baostock' 或 'tushare'
            token: Tushare Token 字符串
        """
        try:
            config = load_config()
            config["data_source"] = source
            config["tushare_token"] = token
            save_config(config)
            return json.dumps({
                "success": True,
                "message": f"数据源已切换为 {source}",
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, result=str)
    def check_tushare_integral(self, token):
        try:
            if not token or not token.strip():
                return json.dumps({"success": False, "error": "Token 为空"})
            import tushare as ts
            ts.set_token(token.strip())
            pro = ts.pro_api()
            # 获取当前日期，尝试最近3个交易日的数据
            from datetime import datetime, timedelta
            today = datetime.now().strftime('%Y%m%d')
            for i in range(1, 6):
                test_date = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')
                try:
                    df = pro.daily(ts_code='000001.SZ', start_date=test_date, end_date=test_date, adj='qfq')
                    if df is not None and not df.empty:
                        # 成功获取到前复权数据，认为积分充足
                        return json.dumps({
                            "success": True,
                            "integral": 200,
                            "sufficient": True,
                            "message": "Token 有效，可获取前复权数据（积分 ≥ 200）"
                        })
                except Exception:
                    continue
            # 所有尝试都失败，提示可能不足
            return json.dumps({
                "success": True,
                "integral": 0,
                "sufficient": False,
                "message": "无法获取前复权数据，可能积分不足200或网络问题，建议直接保存配置尝试"
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_degradation_notice(self):
        """检查是否有数据源降级通知（从子进程写入的文件读取）。"""
        try:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            notice_path = os.path.join(base_dir, 'backend', 'degradation_notice.json')
            if not os.path.exists(notice_path):
                return json.dumps({"success": True, "notice": None})
            with open(notice_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            os.remove(notice_path)  # 读取后清除，避免重复通知
            return json.dumps({"success": True, "notice": data})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    # ---------- 按需更新 & 空闲后台更新 Slot ----------
    @Slot(str, result=str)
    def ensure_stock_updated(self, code):
        try:
            if not code or not code.strip():
                return json.dumps({"success": False, "error": "代码为空"})

            def do_update():
                try:
                    from backend.stock_updater import update_stock_if_needed
                    print(f"[StockUpdater] 开始更新 {code}")
                    updated = update_stock_if_needed(code.strip(), self.db.engine)
                    print(f"[StockUpdater] {code} 更新了 {updated} 条数据")

                    # ========= 关键：清除 DataFeed 的缓存 =========
                    code_pure = code.strip().split('.')[0]
                    if code_pure in self.data_feed._kline_cache:
                        del self.data_feed._kline_cache[code_pure]
                        print(f"[WebBridge] 已清除 {code_pure} 的 K 线缓存")
                except Exception as e:
                    print(f"[StockUpdater] {code} 更新失败: {e}")
                    traceback.print_exc()

            threading.Thread(target=do_update, daemon=True).start()
            return json.dumps({"success": True, "message": "更新任务已启动"})
        except Exception as e:
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def start_idle_update(self):
        """启动后台空闲更新（低优先级，有用户活动时自动暂停）。"""
        try:
            if self._idle_updater and self._idle_updater._running:
                self._idle_updater.resume()
                return json.dumps({"success": True, "message": "后台更新已恢复"})

            config = load_config()
            days = int(config.get('idle_update_days', 3) or 3)
            enabled = config.get('idle_update_enabled', True)
            if not enabled:
                return json.dumps({"success": False, "message": "后台更新已禁用"})

            self._idle_updater = IdleUpdater(
                self.db.engine, days_threshold=days, batch_size=50, interval=2.0
            )
            self._idle_updater.start()
            return json.dumps({"success": True, "message": "后台空闲更新已启动"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(bool, result=str)
    def set_user_active(self, active):
        """前端通知后端用户活动状态变化。active=False 表示用户空闲。"""
        try:
            self._user_active = active
            if active and self._idle_updater and self._idle_updater._running:
                self._idle_updater.pause()
            elif not active and self._idle_updater and self._idle_updater._paused:
                self._idle_updater.resume()
            return json.dumps({"success": True})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_idle_update_status(self):
        """返回后台空闲更新的状态。"""
        try:
            running = self._idle_updater is not None and self._idle_updater._running
            paused = self._idle_updater._paused if self._idle_updater else False
            return json.dumps({
                "success": True,
                "running": running,
                "paused": paused,
                "user_active": self._user_active,
            })
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

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

    # ---------- 自动下单 Slot ----------
    @Slot(bool)
    def set_auto_trade_enabled(self, enabled):
        """启用/禁用自动真实下单。"""
        self.auto_trader.enabled = enabled
        save_auto_trade_config({"enabled": enabled})
        self.auto_trader.config['enabled'] = enabled

    @Slot(str)
    def set_auto_trade_mode(self, mode):
        """切换自动下单模式 (pyautogui / easytrader)，重新创建 trader 实例。"""
        if mode not in ('pyautogui', 'easytrader'):
            return
        save_auto_trade_config({"mode": mode})
        old_trader = self.auto_trader
        self.auto_trader = create_auto_trader(self.db.engine)
        self.auto_trader.notification.connect(self._on_auto_trade_notification)
        self.auto_trader.request_confirm.connect(self._on_auto_trade_confirm_request)
        self.auto_trader.enabled = old_trader.enabled
        old_trader.notification.disconnect()
        old_trader.request_confirm.disconnect()

    @Slot(str)
    def update_auto_trade_config(self, config_json):
        """更新 config.json 的 auto_trader 节并重新初始化。"""
        try:
            updates = json.loads(config_json)
            save_auto_trade_config(updates)
            old_trader = self.auto_trader
            self.auto_trader = create_auto_trader(self.db.engine)
            self.auto_trader.notification.connect(self._on_auto_trade_notification)
            self.auto_trader.request_confirm.connect(self._on_auto_trade_confirm_request)
            self.auto_trader.enabled = old_trader.enabled
            old_trader.notification.disconnect()
            old_trader.request_confirm.disconnect()
        except Exception as e:
            traceback.print_exc(file=sys.stderr)

    @Slot(str)
    def auto_trade_confirm_response(self, response_json):
        """处理前端确认对话框的响应。"""
        try:
            response = json.loads(response_json)
            order_id = response.get('order_id', '')
            confirmed = response.get('confirmed', False)
            dont_ask_again = response.get('dont_ask_again_30d', False)
            self.auto_trader.confirm_response(order_id, confirmed, dont_ask_again)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)

    @Slot()
    def emergency_stop_auto_trade(self):
        """紧急停止：禁用所有真实下单。"""
        self.auto_trader.emergency_stop = True
        self.auto_trader.enabled = False
        save_auto_trade_config({"emergency_stop": True, "enabled": False})

    @Slot()
    def reset_emergency_stop(self):
        """重置紧急停止状态。"""
        self.auto_trader.emergency_stop = False
        save_auto_trade_config({"emergency_stop": False})

    @Slot(str, str, float, int)
    def manual_test_auto_order(self, stock_code, action, price, volume):
        """手动测试下单（不依赖策略信号）。"""
        threading.Thread(
            target=self.auto_trader.execute_order,
            args=(stock_code, action, price, volume),
            daemon=True
        ).start()

    @Slot(result=str)
    def get_auto_trade_config(self):
        """返回当前自动下单配置。"""
        try:
            config = load_auto_trade_config()
            return json.dumps({"success": True, "config": config})
        except Exception as e:
            return json.dumps({"success": False, "error": str(e)})

    @Slot(result=str)
    def get_auto_trade_logs(self):
        """返回最近100条下单记录。"""
        try:
            from backend.auto_trade_logger import get_order_logs
            logs = get_order_logs(self.db.engine, limit=100)
            return json.dumps({"success": True, "logs": logs})
        except Exception as e:
            return json.dumps({"success": False, "error": str(e)})

    def _on_auto_trade_notification(self, data):
        """自动下单通知 → 推送到前端。"""
        try:
            js = f"if(window.onAutoTradeNotification)window.onAutoTradeNotification({json.dumps(data, ensure_ascii=False)})"
            self.web_view.page().runJavaScript(js)
        except Exception:
            pass

    def _on_auto_trade_confirm_request(self, data):
        """确认请求 → 推送到前端弹窗。"""
        try:
            js = f"if(window.onAutoTradeConfirmRequest)window.onAutoTradeConfirmRequest({json.dumps(data, ensure_ascii=False)})"
            self.web_view.page().runJavaScript(js)
        except Exception:
            pass

    # ---------- 鼠标坐标捕获 ----------
    @Slot(str)
    def start_coordinate_capture(self, target_field):
        """启动坐标捕获模式。target_field: 'code' | 'price' | 'volume'"""
        if self._capturing_coordinate:
            self._stop_capture()
        self._capturing_coordinate = True
        self._capture_target = target_field
        self._capture_thread = threading.Thread(target=self._coordinate_listener, daemon=True)
        self._capture_thread.start()

    @Slot()
    def cancel_coordinate_capture(self):
        """取消坐标捕获。"""
        self._stop_capture()
        self.coordinate_captured.emit(-1, -1, 'cancelled')

    def _stop_capture(self):
        self._capturing_coordinate = False
        self._capture_target = ''

    def _coordinate_listener(self):
        """后台线程：监听 Ctrl+左键 组合获取坐标，30 秒超时自动退出。"""
        try:
            from pynput import mouse
        except ImportError:
            self.coordinate_captured.emit(-2, -2, 'error')
            self._stop_capture()
            return

        captured = [False]
        result = [None, None]

        def on_click(x, y, button, pressed):
            if captured[0]:
                return False
            if pressed and button == mouse.Button.left:
                try:
                    import keyboard
                    if keyboard.is_pressed('ctrl'):
                        captured[0] = True
                        result[0], result[1] = x, y
                        return False
                except ImportError:
                    pass
            return True

        listener = None
        try:
            listener = mouse.Listener(on_click=on_click)
            listener.start()
            start = time.time()
            timeout = 30
            while self._capturing_coordinate and not captured[0] and (time.time() - start) < timeout:
                time.sleep(0.1)
        except Exception as e:
            print(f"[WebBridge] 坐标捕获监听异常: {e}", flush=True)
        finally:
            self._capturing_coordinate = False
            if listener and listener.is_alive():
                listener.stop()

        if captured[0] and result[0] is not None:
            self.coordinate_captured.emit(result[0], result[1], self._capture_target)
        else:
            self.coordinate_captured.emit(-1, -1, 'timeout')

    def _on_coordinate_captured(self, x, y, target):
        """坐标捕获结果 → 推送到前端。"""
        try:
            data = json.dumps({"x": x, "y": y, "target": target})
            js = f"if(window.onCoordinateCaptured)window.onCoordinateCaptured({data})"
            self.web_view.page().runJavaScript(js)
        except Exception:
            pass

    # ---------- 获取活动窗口标题 ----------
    @Slot(result=str)
    def get_active_window_title(self):
        """获取当前活动窗口的标题，用于自动填充 pyautogui 的 window_title 配置。"""
        title = _get_active_window_title_pygetwindow()
        if title:
            return title
        title = _get_active_window_title_win32()
        return title if title else ""


def _get_active_window_title_pygetwindow():
    try:
        import pygetwindow as gw
        active = gw.getActiveWindow()
        if active and active.title:
            return active.title
    except Exception:
        pass
    return ""


def _get_active_window_title_win32():
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return ""
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        return buf.value
    except Exception:
        pass
    return ""
