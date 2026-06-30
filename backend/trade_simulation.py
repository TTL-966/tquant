# stub: simplified public version — full implementation is local only
import threading
import json
import os

class TradeSimulation:
    def __init__(self, data_file="simulation_data.json"):
        self._data_file = data_file
        self._lock = threading.Lock()
        self.initial_capital = 1000000.0
        self.cash = 1000000.0
        self.holdings = {}
        self.history = []

    def reset(self, initial_cash=1000000.0):
        with self._lock:
            self.initial_capital = initial_cash
            self.cash = initial_cash
            self.holdings = {}
            self.history = []

    def execute_trade(self, code, action, shares, price, trade_date=None):
        with self._lock:
            record_date = trade_date if trade_date else __import__('datetime').datetime.now().strftime('%Y-%m-%d')
            if action == 'buy':
                cost = round(price * shares, 2)
                if cost > self.cash:
                    return {'success': False, 'message': '资金不足'}
                if code in self.holdings:
                    old = self.holdings[code]
                    new_shares = old['shares'] + shares
                    new_cost = round((old['cost'] * old['shares'] + cost) / new_shares, 2)
                    self.holdings[code] = {'shares': new_shares, 'cost': new_cost}
                else:
                    self.holdings[code] = {'shares': shares, 'cost': price}
                self.cash = round(self.cash - cost, 2)
                self.history.append({'date': record_date, 'type': '买入', 'code': code, 'price': price, 'shares': shares})
                return {'success': True, 'message': f'买入{shares}股{code}成功'}
            elif action == 'sell':
                if code not in self.holdings or self.holdings[code]['shares'] < shares:
                    return {'success': False, 'message': '持仓不足'}
                self.holdings[code]['shares'] -= shares
                if self.holdings[code]['shares'] == 0:
                    del self.holdings[code]
                self.cash = round(self.cash + price * shares, 2)
                self.history.append({'date': record_date, 'type': '卖出', 'code': code, 'price': price, 'shares': shares})
                return {'success': True, 'message': f'卖出{shares}股{code}成功'}
            return {'success': False, 'message': '无效操作'}

    def get_portfolio(self):
        with self._lock:
            holdings_list = []
            total_market = self.cash
            for code, item in self.holdings.items():
                current_price = item['cost']
                market_value = round(current_price * item['shares'], 2)
                profit = round(market_value - item['cost'] * item['shares'], 2)
                holdings_list.append({'code': code, 'shares': item['shares'], 'cost': item['cost'], 'price': current_price, 'profit': profit})
                total_market += market_value
            return {'cash': self.cash, 'initial_capital': self.initial_capital, 'total_assets': round(total_market, 2), 'holdings': holdings_list, 'history': list(self.history)}
