import json
import sys
import os
import time
import shutil
import subprocess
import threading
import traceback
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

from backend.data_feed import DataFeed#测试

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
        self._update_process = None   # 数据更新子进程句柄

        df = DataFeed()
        print(df.get_realtime_price('000001'))

    @Slot(result=str)
    def ping(self):
        return "pong"

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
    def get_index_stocks(self, index_code):
        """返回指数成分股代码列表。数据库不可用时返回 mock 数据。"""
        mock_indices = {
            '000300.XSHG': ['000001','000002','000063','000333','000651','000725','000858','002142',
                '002415','002594','300750','600000','600009','600016','600028','600030','600031',
                '600036','600048','600050','600104','600276','600309','600519','600585','600809',
                '600887','601012','601088','601166','601288','601318','601328','601398','601668',
                '601857','601888','601939','603259','603288'],
            '000905.XSHG': ['000012','000021','000039','000050','000060','000066','000100','000155',
                '002013','002028','002049','002074','002091','002110','002129','002138','002155',
                '300001','300003','300014','300024','300033','300037','300058','300070','300088',
                '600004','600008','600012','600017','600018','600019','600020','600021','600022',
                '601000','601001','601003','601005','601006','601008','601018','601019','601020'],
            '000852.XSHG': ['000158','000301','000401','000420','000426','000501','000510','000519',
                '002001','002003','002007','002008','002010','002011','002017','002019','002020',
                '300002','300004','300005','300006','300007','300008','300009','300010','300011',
                '600001','600002','600003','600005','600006','600007','600010','600011','600012'],
            '399006.XSHE': ['300001','300003','300014','300015','300024','300033','300037','300058',
                '300059','300070','300088','300122','300124','300142','300146','300207','300251',
                '300274','300316','300347','300408','300413','300433','300450','300498','300502',
                '300529','300558','300595','300601','300628','300661','300750','300759','300760'],
            '000688.XSHG': ['688001','688005','688008','688009','688012','688036','688065','688111',
                '688126','688187','688223','688256','688303','688396','688516','688536','688561',
                '688599','688728','688777','688981']
        }
        try:
            result = self.db.get_index_stocks(index_code)
            if result and len(result) > 0:
                return json.dumps(result)
            # fallback to mock
            return json.dumps(mock_indices.get(index_code, []))
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps(mock_indices.get(index_code, []))

    @Slot(str, str, str, result=str)
    def run_backtest(self, code, start_date="2010-01-01", end_date="2026-12-31"):
        try:
            signals, ma_data = self.strategy_engine.run_backtest(code, start_date, end_date)
            equity_curve = self._get_equity_curve(code)
            return json.dumps({"success": True, "signals": signals, "ma_data": ma_data, "equity_curve": equity_curve})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

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

    # ---------- 报告导出 ----------
    @Slot(str, result=str)
    def export_report(self, data_json):
        """接收回测数据 JSON，生成 Excel 和 PDF 报告，弹出目录选择对话框保存。"""
        try:
            data = json.loads(data_json)
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
