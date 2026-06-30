# stub: simplified public version — full implementation is local only
import asyncio
import threading
import time
from datetime import datetime


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
    """Single-stock async realtime strategy engine. Simplified public version."""

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
        self.logs = []
        self._state_lock = threading.Lock()
        self._running = False
        self._thread = None
        self.log = _RealtimeLogger(self)

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        self.log.info(f"Demo realtime engine started for {self.stock_code}")

    def stop(self):
        self._running = False
        self.log.info("Demo realtime engine stopped")

    def _run_loop(self):
        while self._running:
            time.sleep(self.quote_interval)

    def get_status(self):
        return {
            'running': self._running,
            'stock_code': self.stock_code,
            'mode': 'demo',
            'logs': list(self.logs[-50:]),
        }
