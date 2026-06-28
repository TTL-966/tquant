"""Multi-stock async realtime strategy engine.

asyncio + aiohttp architecture:
  - Dedicated asyncio event loop in daemon thread
  - Concurrent quote fetching via AsyncQuoteFetcher (semaphore-limited)
  - Graceful stop: asyncio.Event, no blocking join, no zombie threads
  - Thread-safe signal/log access for Qt main thread consumption
  - Supports 200+ stocks without thread explosion
"""

import asyncio
import threading
import time
import types
import traceback
from datetime import datetime, timedelta

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
            if len(self._engine.logs) > 500:
                self._engine.logs = self._engine.logs[-500:]
        print(f"[MultiEngine] {text}")
        if self._engine.on_log:
            try:
                self._engine.on_log(text)
            except Exception:
                pass


class MultiRealtimeStrategyEngine:
    """Multi-stock async realtime strategy engine.

    Public API unchanged from sync version:
      - start() / stop()
      - running, signals, logs, stock_codes
      - get_new_signals(), get_new_logs()
      - get_all_signals(), get_all_logs()
    """

    def __init__(self, stock_codes, user_code, trade_sim,
                 initial_cash=100000.0, quote_interval=3.0,
                 on_signal=None, on_log=None,
                 commission_rate=0.0003, stamp_tax_rate=0.001,
                 slippage_cost_type='percent', slippage_cost_value=0.1,
                 auto_trader=None):
        self.stock_codes = [c.split('.')[0] for c in stock_codes]
        self.user_code = user_code
        self.trade_sim = trade_sim
        self.initial_cash = initial_cash
        self.quote_interval = max(quote_interval, 1.0)

        self.on_signal = on_signal
        self.on_log = on_log
        self.auto_trader = auto_trader

        self.commission_rate = commission_rate
        self.stamp_tax_rate = stamp_tax_rate
        self.slippage_cost_type = slippage_cost_type
        self.slippage_cost_value = slippage_cost_value

        # Async primitives — created in start()
        self._stop_event = None       # asyncio.Event for graceful exit
        self._loop = None             # asyncio event loop reference
        self._loop_thread = None      # daemon thread running the loop
        self._main_task = None        # the _async_main Task
        self.running = False

        # Thread-safe state (accessed from Qt main thread via get_new_*)
        self._state_lock = threading.Lock()
        self.signals = []
        self.logs = []
        self._last_consumed_signal_idx = 0
        self._last_consumed_log_idx = 0

        # Internal state (only accessed from async loop thread)
        self._last_prices = {}
        self._context = None
        self._handle_bar_funcs = {}
        self._pending_orders = []
        self._today_buy_shares = {}
        self._last_date = None
        self._history_cache = {}
        self._history_cache_ttl = timedelta(minutes=5)
        self._last_poll_duration = 0.0

        self._fetcher = None  # AsyncQuoteFetcher, created in _async_main

    # ── Lifecycle ──

    def start(self):
        if self.running:
            return
        self.running = True
        self._stop_event = asyncio.Event()
        self._loop_thread = threading.Thread(
            target=self._run_loop, daemon=True, name="multi-engine-loop"
        )
        self._loop_thread.start()

    def stop(self):
        if not self.running:
            return
        self.running = False
        if self._stop_event:
            # Signal the async loop to exit
            if self._loop and self._loop.is_running():
                self._loop.call_soon_threadsafe(self._stop_event.set)
        # Non-blocking: the daemon thread will exit on its own

    def _run_loop(self):
        """Entry point for the dedicated asyncio thread."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._main_task = self._loop.create_task(self._async_main())
            self._loop.run_until_complete(self._main_task)
        except asyncio.CancelledError:
            pass
        except Exception:
            traceback.print_exc()
        finally:
            # Cancel all remaining tasks
            pending = asyncio.all_tasks(self._loop)
            for task in pending:
                task.cancel()
            if pending:
                self._loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True)
                )
            self._loop.close()
            self.running = False

    # ── Async main ──

    async def _async_main(self):
        self._fetcher = AsyncQuoteFetcher(max_concurrency=20, request_timeout=3.0)
        try:
            self._init_strategies()
            await self._poll_loop()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            msg = f"引擎异常: {str(e)}\n{traceback.format_exc()}"
            self.logs.append(msg)
            print(f"[MultiEngine] {msg}")
        finally:
            await self._fetcher.close()
            self.running = False

    # ── Strategy init (unchanged logic, runs sync in async loop) ──

    def _init_strategies(self):
        logger = _RealtimeLogger(self)
        self._context = types.SimpleNamespace()
        self._context.portfolio = {'cash': self.initial_cash, 'holdings': {}}
        self._context.current_dt = datetime.now()

        for code in self.stock_codes:
            try:
                stock_context = types.SimpleNamespace()
                stock_context.portfolio = self._context.portfolio
                stock_context.current_dt = self._context.current_dt
                stock_context.stock = code

                sandbox = self._build_sandbox(stock_context, logger, code)
                code_obj = compile(self.user_code, f'<multi_strategy_{code}>', 'exec')
                exec(code_obj, sandbox)

                initialize = sandbox.get('initialize')
                handle_bar = sandbox.get('handle_bar')
                if initialize is None or handle_bar is None:
                    raise RuntimeError("策略缺少 initialize 或 handle_bar")
                initialize(stock_context)
                self._handle_bar_funcs[code] = (handle_bar, stock_context)
            except Exception as e:
                logger.error(f"股票 {code} 策略初始化失败: {e}")

        logger.info(
            f"策略初始化完成，{len(self._handle_bar_funcs)}/{len(self.stock_codes)} 只股票"
        )

    # ── Poll loop (async) ──

    async def _poll_loop(self):
        logger = _RealtimeLogger(self)
        while not self._stop_event.is_set():
            loop_start = time.time()
            try:
                # T+1 date rollover
                today = datetime.now().date()
                if self._last_date is None:
                    self._last_date = today
                elif today != self._last_date:
                    self._last_date = today
                    self._today_buy_shares.clear()
                    self._history_cache.clear()
                    logger.info(f"新交易日 {today}，清空 T+1 锁和缓存")

                # Concurrent batch fetch
                quotes = await self._fetcher.fetch_quotes(
                    self.stock_codes, batch_size=50
                )
                if not quotes:
                    logger.warn("批量行情获取失败，跳过本轮")
                    await self._sleep_or_cancel()
                    continue

                # Sync portfolio
                portfolio = await self._run_in_thread(self.trade_sim.get_portfolio)
                self._context.portfolio['cash'] = portfolio['cash']
                self._context.portfolio['holdings'] = {
                    h['code']: h['shares'] for h in portfolio['holdings']
                }

                self._pending_orders.clear()
                self._context.current_dt = datetime.now()

                # Drive each stock's strategy
                for code in self.stock_codes:
                    if self._stop_event.is_set():
                        break
                    if code not in self._handle_bar_funcs:
                        continue
                    quote = quotes.get(code)
                    if quote is None:
                        continue

                    price = quote['price']
                    old_price = self._last_prices.get(code)
                    if old_price is not None and abs(price - old_price) < 0.001:
                        continue
                    self._last_prices[code] = price

                    handle_bar, stock_context = self._handle_bar_funcs[code]
                    stock_context.current_dt = self._context.current_dt

                    bar_dict = {
                        'open': quote['open'],
                        'high': quote['high'],
                        'low': quote['low'],
                        'close': price,
                        'volume': quote['volume'] * 100,
                        'prev_close': quote['prev_close'],
                    }
                    try:
                        handle_bar(stock_context, bar_dict)
                    except Exception as e:
                        logger.error(f"股票 {code} handle_bar 异常: {e}")

                # Execute pending orders (sell first, then buy)
                if not self._stop_event.is_set():
                    self._execute_orders()

            except Exception as e:
                logger.error(f"轮询异常: {str(e)}\n{traceback.format_exc()}")

            self._last_poll_duration = time.time() - loop_start
            if self._last_poll_duration > self.quote_interval * 0.8:
                logger.warn(
                    f"轮询耗时 {self._last_poll_duration:.2f}s 超过间隔 80% "
                    f"(间隔 {self.quote_interval}s, {len(self.stock_codes)} 只)"
                )

            await self._sleep_or_cancel()

    async def _sleep_or_cancel(self):
        """Sleep for quote_interval, but exit immediately on stop signal."""
        try:
            await asyncio.wait_for(
                self._stop_event.wait(), timeout=self.quote_interval
            )
        except asyncio.TimeoutError:
            pass

    @staticmethod
    async def _run_in_thread(func, *args, **kwargs):
        """Run synchronous function in default executor (thread pool)."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, lambda: func(*args, **kwargs))

    # ── Sandbox ──

    def _build_sandbox(self, context, logger, stock_code):
        return {
            '__builtins__': __builtins__,
            'pd': pd,
            'np': np,
            'context': context,
            'log': logger,
            'history_bars': self._make_history_bars(stock_code),
            'attribute_history': lambda *a, **kw: pd.DataFrame(),
            'order_target_percent': self._make_order_target_percent(stock_code),
            'order_target_value': self._make_order_target_value(stock_code),
            'get_current_data': lambda s: {
                'last_price': self._last_prices.get(stock_code, 0)
            },
            'run_daily': lambda *a, **kw: None,
        }

    def _make_history_bars(self, stock_code):
        def history_bars(security, count, unit='1d', field='close'):
            ALLOWED_FIELDS = {'open', 'high', 'low', 'close', 'vol', 'amount'}
            if field not in ALLOWED_FIELDS:
                return np.array([])
            cache_key = f"{field}_{count}"
            now = datetime.now()
            cache_entry = self._history_cache.get(stock_code, {}).get(cache_key)
            if cache_entry is not None:
                cached_values, cached_time = cache_entry
                if now - cached_time < self._history_cache_ttl:
                    return cached_values.copy()
            try:
                from backend.db import Database
                from sqlalchemy import text
                code = stock_code
                suffix_map = {'6': 'SH', '9': 'SH', '68': 'SH', '8': 'BJ'}
                suffix = '.SZ'
                for prefix, sfx in suffix_map.items():
                    if code.startswith(prefix):
                        suffix = f'.{sfx}'
                        break
                ts_code = code + suffix
                today = now.strftime('%Y-%m-%d')
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
                values = np.array(
                    [r[0] for r in rows if r[0] is not None][::-1]
                ) if rows else np.array([])
            except Exception as e:
                print(f"[MultiEngine] history_bars 查询失败: {e}")
                return np.array([])

            if stock_code not in self._history_cache:
                self._history_cache[stock_code] = {}
            self._history_cache[stock_code][cache_key] = (values, now)
            return values.copy()
        return history_bars

    def _make_order_target_percent(self, stock_code):
        def order_target_percent(security, percent):
            code = stock_code
            price = self._last_prices.get(code, 0)
            if price <= 0:
                return
            portfolio = self.trade_sim.get_portfolio()
            cash = portfolio['cash']
            holdings_dict = {h['code']: h['shares'] for h in portfolio['holdings']}
            current_shares = holdings_dict.get(code, 0)
            total_holding_value = 0.0
            for c, s in holdings_dict.items():
                lp = self._last_prices.get(c, 0)
                if lp > 0:
                    total_holding_value += s * lp
            total_assets = cash + total_holding_value
            if abs(percent) < 0.001:
                if current_shares > 0:
                    self._pending_orders.append((code, -current_shares, price))
                return
            target_value = total_assets * percent
            current_value = current_shares * price
            diff_value = target_value - current_value
            if abs(diff_value) < 0.01:
                return
            if diff_value > 0:
                shares = int(diff_value / price / 100) * 100
                if shares > 0:
                    self._pending_orders.append((code, shares, price))
            else:
                shares = int(abs(diff_value) / price / 100) * 100
                shares = min(shares, current_shares)
                if shares > 0:
                    self._pending_orders.append((code, -shares, price))
        return order_target_percent

    def _make_order_target_value(self, stock_code):
        def order_target_value(security, value):
            code = stock_code
            price = self._last_prices.get(code, 0)
            if price <= 0:
                return
            portfolio = self.trade_sim.get_portfolio()
            holdings_dict = {h['code']: h['shares'] for h in portfolio['holdings']}
            current_shares = holdings_dict.get(code, 0)
            current_value = current_shares * price
            diff_value = value - current_value
            if abs(diff_value) < 0.01:
                return
            shares = int(abs(diff_value) / price / 100) * 100
            if shares <= 0:
                return
            if diff_value > 0:
                self._pending_orders.append((code, shares, price))
            else:
                shares = min(shares, current_shares)
                if shares > 0:
                    self._pending_orders.append((code, -shares, price))
        return order_target_value

    # ── Order execution ──

    def _apply_slippage(self, price, direction):
        if self.slippage_cost_value <= 0:
            return price
        if self.slippage_cost_type == 'percent':
            slip = price * self.slippage_cost_value
        else:
            slip = self.slippage_cost_value
        return price + slip if direction == 'buy' else price - slip

    def _execute_orders(self):
        logger = _RealtimeLogger(self)
        portfolio = self.trade_sim.get_portfolio()
        holdings_dict = {h['code']: h['shares'] for h in portfolio['holdings']}
        sells = [o for o in self._pending_orders if o[1] < 0]
        buys = [o for o in self._pending_orders if o[1] > 0]

        for code, shares, price in sells:
            qty = abs(shares)
            total_holding = holdings_dict.get(code, 0)
            today_bought = self._today_buy_shares.get(code, 0)
            available = max(0, total_holding - today_bought)
            if available <= 0:
                logger.warn(f"T+1 限制: {code} 当天买入 {today_bought} 股, 无可卖")
                continue
            if qty > available:
                logger.warn(
                    f"T+1 限制: {code} 卖出 {qty}→{available} 股"
                )
                qty = available
            exec_price = self._apply_slippage(price, 'sell')
            result = self.trade_sim.execute_trade(code, 'sell', qty, exec_price)
            if result.get('success'):
                amount = exec_price * qty
                commission = amount * self.commission_rate
                stamp_tax = amount * self.stamp_tax_rate
                cost_total = commission + stamp_tax
                with self.trade_sim._lock:
                    self.trade_sim.cash = round(self.trade_sim.cash - cost_total, 2)
                self._record_signal(code, 'sell', exec_price, qty)
            else:
                self.logs.append(f"[WARN] 卖出 {code} 失败: {result.get('message', '')}")

        for code, shares, price in buys:
            exec_price = self._apply_slippage(price, 'buy')
            amount = exec_price * shares
            commission = amount * self.commission_rate
            total_cost = amount + commission
            current_portfolio = self.trade_sim.get_portfolio()
            if total_cost > current_portfolio['cash']:
                logger.warn(
                    f"买入 {code} 资金不足: 需 {total_cost:.2f}, "
                    f"可用 {current_portfolio['cash']:.2f}"
                )
                continue
            result = self.trade_sim.execute_trade(code, 'buy', shares, exec_price)
            if result.get('success'):
                with self.trade_sim._lock:
                    self.trade_sim.cash = round(self.trade_sim.cash - commission, 2)
                self._today_buy_shares[code] = (
                    self._today_buy_shares.get(code, 0) + shares
                )
                self._record_signal(code, 'buy', exec_price, shares)
            else:
                self.logs.append(f"[WARN] 买入 {code} 失败: {result.get('message', '')}")

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
            if len(self.signals) > 500:
                self.signals = self.signals[-500:]

        if self.on_signal:
            try:
                self.on_signal(signal)
            except Exception:
                pass

        if self.auto_trader and self.auto_trader.enabled and not self.auto_trader.emergency_stop:
            # Run auto-trader in thread pool executor (not raw thread)
            loop = asyncio.get_event_loop()
            loop.run_in_executor(
                None,
                self.auto_trader.execute_order,
                code, action, price, shares
            )

    # ── Public API (thread-safe, called from Qt main thread) ──

    def get_new_signals(self):
        with self._state_lock:
            new_signals = self.signals[self._last_consumed_signal_idx:]
            self._last_consumed_signal_idx = len(self.signals)
            return list(new_signals)

    def get_all_signals(self):
        with self._state_lock:
            return list(self.signals)

    def get_new_logs(self):
        with self._state_lock:
            new_logs = self.logs[self._last_consumed_log_idx:]
            self._last_consumed_log_idx = len(self.logs)
            return list(new_logs)

    def get_all_logs(self):
        with self._state_lock:
            return list(self.logs)
