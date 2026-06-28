"""Single-stock async realtime strategy engine.

Same asyncio + aiohttp architecture as MultiRealtimeStrategyEngine.
"""

import asyncio
import threading
import time
import types
import traceback
from datetime import datetime

import numpy as np
import pandas as pd

from backend.async_quote_fetcher import AsyncQuoteFetcher


class _RealtimeLogger:
    def __init__(self, engine):
        self._engine = engine

    def info(self, msg):
        self._emit('INFO', msg)

    def warn(self, msg):
        self._emit('WARN', msg)

    def error(self, msg):
        self._emit('ERROR', msg)

    def debug(self, msg):
        self._emit('DEBUG', msg)

    def __call__(self, msg):
        self.info(msg)

    def _emit(self, level, msg):
        text = f"[{level}] {msg}"
        with self._engine._state_lock:
            self._engine.logs.append(text)
        print(f"[RealtimeEngine] {text}")
        if self._engine.on_log:
            try:
                self._engine.on_log(text)
            except Exception:
                pass


class RealtimeStrategyEngine:
    """Single-stock async realtime strategy engine."""

    def __init__(self, stock_code, user_code, trade_sim,
                 initial_cash=100000.0, quote_interval=3.0,
                 on_signal=None, on_log=None, auto_trader=None):
        self.stock_code = stock_code.split('.')[0]
        self.user_code = user_code
        self.trade_sim = trade_sim
        self.initial_cash = initial_cash
        self.quote_interval = max(quote_interval, 1.0)

        self.on_signal = on_signal
        self.on_log = on_log
        self.auto_trader = auto_trader

        self._stop_event = None
        self._loop = None
        self._loop_thread = None
        self.running = False

        self._state_lock = threading.Lock()
        self.signals = []
        self.logs = []
        self._last_consumed_signal_idx = 0
        self._last_consumed_log_idx = 0

        self._last_price = None
        self._context = None
        self._handle_bar = None
        self._fetcher = None

    # ── Lifecycle ──

    def start(self):
        if self.running:
            return
        self.running = True
        self._stop_event = asyncio.Event()
        self._loop_thread = threading.Thread(
            target=self._run_loop, daemon=True, name="realtime-engine-loop"
        )
        self._loop_thread.start()

    def stop(self):
        if not self.running:
            return
        self.running = False
        if self._stop_event and self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(self._stop_event.set)

    def _run_loop(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._async_main())
        except asyncio.CancelledError:
            pass
        except Exception:
            traceback.print_exc()
        finally:
            pending = asyncio.all_tasks(self._loop)
            for task in pending:
                task.cancel()
            if pending:
                self._loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True)
                )
            self._loop.close()
            self.running = False

    async def _async_main(self):
        self._fetcher = AsyncQuoteFetcher(max_concurrency=5, request_timeout=3.0)
        try:
            self._init_strategy()
            await self._poll_loop()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            msg = f"引擎异常: {str(e)}\n{traceback.format_exc()}"
            self.logs.append(msg)
            print(f"[RealtimeEngine] {msg}")
        finally:
            await self._fetcher.close()
            self.running = False

    # ── Strategy init ──

    def _init_strategy(self):
        self._context = types.SimpleNamespace()
        self._context.portfolio = {'cash': self.initial_cash, 'holdings': {}}
        self._context.current_dt = datetime.now()
        self._context.stock = self.stock_code

        logger = _RealtimeLogger(self)
        sandbox = self._build_sandbox(self._context, logger)
        try:
            code_obj = compile(self.user_code, '<realtime_strategy>', 'exec')
            exec(code_obj, sandbox)
        except Exception as e:
            raise RuntimeError(f"策略代码编译/执行失败: {str(e)}")

        initialize = sandbox.get('initialize')
        handle_bar = sandbox.get('handle_bar')
        if initialize is None:
            raise RuntimeError("策略缺少 initialize 函数")
        if handle_bar is None:
            raise RuntimeError("策略缺少 handle_bar 函数")
        initialize(self._context)
        self._handle_bar = handle_bar

    # ── Poll loop ──

    async def _poll_loop(self):
        logger = _RealtimeLogger(self)
        while not self._stop_event.is_set():
            try:
                quote = await self._fetcher.fetch_quote(self.stock_code)
                if quote is None:
                    logger.warn(f"获取 {self.stock_code} 行情失败")
                    await self._sleep_or_cancel()
                    continue

                price = quote['price']
                if self._last_price is not None and abs(price - self._last_price) < 0.001:
                    await self._sleep_or_cancel()
                    continue

                self._last_price = price
                self._context.current_dt = datetime.now()

                portfolio = await asyncio.get_running_loop().run_in_executor(
                    None, self.trade_sim.get_portfolio
                )
                self._context.portfolio['cash'] = portfolio['cash']
                self._context.portfolio['holdings'] = {
                    h['code']: h['shares']
                    for h in portfolio['holdings']
                } if isinstance(portfolio['holdings'], list) else {
                    k: v['shares'] if isinstance(v, dict) else v
                    for k, v in portfolio['holdings'].items()
                }

                bar_dict = {
                    'open': quote['open'],
                    'high': quote['high'],
                    'low': quote['low'],
                    'close': quote['price'],
                    'volume': quote['volume'] * 100,
                    'prev_close': quote['prev_close'],
                }

                self._handle_bar(self._context, bar_dict)
            except Exception as e:
                logger.error(f"轮询异常: {str(e)}\n{traceback.format_exc()}")

            await self._sleep_or_cancel()

    async def _sleep_or_cancel(self):
        try:
            await asyncio.wait_for(
                self._stop_event.wait(), timeout=self.quote_interval
            )
        except asyncio.TimeoutError:
            pass

    # ── Sandbox ──

    def _build_sandbox(self, context, logger):
        return {
            '__builtins__': __builtins__,
            'pd': pd,
            'np': np,
            'context': context,
            'log': logger,
            'history_bars': self._history_bars,
            'attribute_history': self._attribute_history,
            'order_target_percent': self._order_target_percent,
            'order_target_value': self._order_target_value,
            'get_current_data': self._get_current_data,
            'run_daily': lambda *a, **kw: None,
        }

    def _history_bars(self, security, count, unit='1d', field='close'):
        ALLOWED_FIELDS = {'open', 'high', 'low', 'close', 'vol', 'amount'}
        if field not in ALLOWED_FIELDS:
            return np.array([])
        try:
            from backend.db import Database
            from sqlalchemy import text
            code = security.split('.')[0]
            suffix_map = {'6': 'SH', '9': 'SH', '68': 'SH', '8': 'BJ'}
            suffix = '.SZ'
            for prefix, sfx in suffix_map.items():
                if code.startswith(prefix):
                    suffix = f'.{sfx}'
                    break
            ts_code = code + suffix
            today = datetime.now().strftime('%Y-%m-%d')
            db = Database()
            with db.engine.connect() as conn:
                rows = conn.execute(
                    text(
                        f"SELECT {field} FROM stock_daily_qfq_with_name "
                        "WHERE ts_code = :code AND trade_date < :today "
                        "ORDER BY trade_date DESC LIMIT :limit"
                    ),
                    {'code': ts_code, 'today': today, 'limit': count}
                ).fetchall()
            if not rows:
                return np.array([])
            values = [r[0] for r in rows if r[0] is not None]
            return np.array(values[::-1])
        except Exception as e:
            print(f"[RealtimeEngine] history_bars 查询失败: {e}")
            return np.array([])

    def _attribute_history(self, security, count, fields=None):
        try:
            code = security.split('.')[0]
            from backend.data_feed import DataFeed
            df = DataFeed()
            raw = df.get_kline_json(code, limit=count)
            import json
            data = json.loads(raw)
            vals = data.get('values', [])
            dates = data.get('dates', [])
            if not vals:
                return pd.DataFrame()
            records = []
            all_fields = ['open', 'close', 'low', 'high', 'volume']
            if fields:
                all_fields = [f for f in fields if f in all_fields]
            for i, v in enumerate(vals[-count:]):
                rec = {'date': dates[i] if i < len(dates) else ''}
                for j, f in enumerate(all_fields):
                    if j < len(v):
                        rec[f] = v[j]
                records.append(rec)
            return pd.DataFrame(records)
        except Exception:
            return pd.DataFrame()

    def _order_target_percent(self, security, percent):
        code = security.split('.')[0]
        portfolio = self.trade_sim.get_portfolio()
        cash = portfolio['cash']
        holdings = portfolio['holdings']
        current_shares = 0
        if isinstance(holdings, list):
            for h in holdings:
                if h['code'] == code:
                    current_shares = h['shares']
                    break
        elif isinstance(holdings, dict):
            info = holdings.get(code)
            if info:
                current_shares = info.get('shares', 0) if isinstance(info, dict) else info
        price = self._last_price or 0
        if price <= 0:
            return
        pos_mode = getattr(self._context, '_position_mode', 'percentage')
        pos_value = getattr(self._context, '_position_value', 100)
        if abs(percent) < 0.001:
            if current_shares > 0:
                result = self.trade_sim.execute_trade(code, 'sell', current_shares, price)
                if result.get('success'):
                    self._record_signal(code, 'sell', price, current_shares)
                else:
                    self.logs.append(f"[WARN] 清仓失败: {result.get('message', '')}")
            return
        if pos_mode == 'fixed_quantity' and percent > 0.001:
            target_shares = min(int(pos_value), int(cash // price))
            target_shares = (target_shares // 100) * 100
            if target_shares <= 0:
                return
            result = self.trade_sim.execute_trade(code, 'buy', target_shares, price)
            if result.get('success'):
                self._record_signal(code, 'buy', price, target_shares)
            return
        if current_shares == 0:
            return
        total_assets = cash
        if isinstance(holdings, list):
            for h in holdings:
                total_assets += h.get('shares', 0) * price
        else:
            for c, info in holdings.items():
                s = info.get('shares', 0) if isinstance(info, dict) else info
                total_assets += s * price
        target_value = total_assets * percent
        current_value = current_shares * price
        diff_value = target_value - current_value
        if abs(diff_value) < 0.01:
            return
        if diff_value > 0:
            target_shares = int(diff_value / price / 100) * 100
            if target_shares <= 0:
                return
            result = self.trade_sim.execute_trade(code, 'buy', target_shares, price)
            action = 'buy'
        else:
            target_shares = int(abs(diff_value) / price / 100) * 100
            target_shares = min(target_shares, current_shares)
            if target_shares <= 0:
                return
            result = self.trade_sim.execute_trade(code, 'sell', target_shares, price)
            action = 'sell'
        if result.get('success'):
            self._record_signal(code, action, price, target_shares)
        else:
            self.logs.append(f"[WARN] 下单失败: {result.get('message', '')}")

    def _order_target_value(self, security, value):
        code = security.split('.')[0]
        portfolio = self.trade_sim.get_portfolio()
        holdings = portfolio['holdings']
        current_shares = 0
        if isinstance(holdings, list):
            for h in holdings:
                if h['code'] == code:
                    current_shares = h['shares']
                    break
        else:
            info = holdings.get(code)
            if info:
                current_shares = info.get('shares', 0) if isinstance(info, dict) else info
        price = self._last_price or 0
        if price <= 0:
            return
        current_value = current_shares * price
        diff_value = value - current_value
        if abs(diff_value) < 0.01:
            return
        target_shares = int(abs(diff_value) / price / 100) * 100
        if target_shares <= 0:
            return
        if diff_value > 0:
            result = self.trade_sim.execute_trade(code, 'buy', target_shares, price)
            action = 'buy'
        else:
            result = self.trade_sim.execute_trade(code, 'sell', target_shares, price)
            action = 'sell'
        if result.get('success'):
            self._record_signal(code, action, price, target_shares)

    def _get_current_data(self, security):
        return {
            'last_price': self._last_price or 0,
            'open': 0, 'high': 0, 'low': 0,
            'close': self._last_price or 0,
        }

    # ── Signal ──

    def _record_signal(self, code, action, price, shares):
        signal = {
            'date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'code': code,
            'type': action,
            'price': round(price, 2),
            'shares': shares,
            'reason': '实时信号',
        }
        with self._state_lock:
            self.signals.append(signal)
        print(f"[RealtimeEngine] 信号: {signal}")
        if self.on_signal:
            try:
                self.on_signal(signal)
            except Exception:
                pass
        if self.auto_trader and self.auto_trader.enabled and not self.auto_trader.emergency_stop:
            loop = asyncio.get_event_loop()
            loop.run_in_executor(
                None,
                self.auto_trader.execute_order,
                code, action, price, shares
            )

    # ── Public API ──

    def get_new_signals(self):
        with self._state_lock:
            new_signals = self.signals[self._last_consumed_signal_idx:]
            self._last_consumed_signal_idx = len(self.signals)
            return list(new_signals)

    def get_new_logs(self):
        with self._state_lock:
            new_logs = self.logs[self._last_consumed_log_idx:]
            self._last_consumed_log_idx = len(self.logs)
            return list(new_logs)
