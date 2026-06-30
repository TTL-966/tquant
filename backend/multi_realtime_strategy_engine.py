# stub: simplified public version
import threading
import time

class MultiRealtimeStrategyEngine:
    def __init__(self, stock_codes, user_code, trade_sim,
                 initial_cash=100000.0, quote_interval=3.0,
                 on_signal=None, on_log=None, auto_trader=None):
        self.stock_codes = [c.split('.')[0] for c in stock_codes]
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

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def _run_loop(self):
        while self._running:
            time.sleep(self.quote_interval)

    def get_status(self):
        return {'running': self._running, 'stock_codes': self.stock_codes, 'mode': 'demo', 'logs': list(self.logs[-50:])}
