class TradeSimulation:
    def __init__(self):
        self.cash = 1000000.0          # 初始资金100万
        self.holdings = {}             # 持仓：key: code, value: {shares, cost}
        self.history = []              # 交易记录列表
        self._lock = __import__('threading').Lock()

    def execute_trade(self, code, action, shares, price, trade_date=None):
        """
        执行模拟交易
        action: 'buy' 或 'sell'
        trade_date: 'YYY-MM-DD' 格式的交易日期，为 None 时使用当前日期
        returns: dict {success: bool, message: str}
        """
        with self._lock:
            record_date = trade_date if trade_date is not None else self._today()
            if action == 'buy':
                cost = round(price * shares, 2)
                if cost > self.cash:
                    return {'success': False, 'message': '资金不足'}
                # 更新持仓
                if code in self.holdings:
                    old = self.holdings[code]
                    new_shares = old['shares'] + shares
                    new_cost = round((old['cost'] * old['shares'] + cost) / new_shares, 2)
                    self.holdings[code] = {'shares': new_shares, 'cost': new_cost}
                else:
                    self.holdings[code] = {'shares': shares, 'cost': price}
                self.cash = round(self.cash - cost, 2)
                self.history.append({
                    'date': record_date,
                    'type': '买入',
                    'code': code,
                    'price': price,
                    'shares': shares
                })
                return {'success': True, 'message': f'买入{shares}股{code}成功'}

            elif action == 'sell':
                if code not in self.holdings:
                    return {'success': False, 'message': '没有该股票持仓'}
                if self.holdings[code]['shares'] < shares:
                    return {'success': False, 'message': '持仓不足'}
                self.holdings[code]['shares'] -= shares
                if self.holdings[code]['shares'] == 0:
                    del self.holdings[code]
                self.cash = round(self.cash + price * shares, 2)
                self.history.append({
                    'date': record_date,
                    'type': '卖出',
                    'code': code,
                    'price': price,
                    'shares': shares
                })
                return {'success': True, 'message': f'卖出{shares}股{code}成功'}
            else:
                return {'success': False, 'message': '无效操作'}

    def get_portfolio(self):
        """返回当前持仓和资金"""
        with self._lock:
            holdings_list = []
            total_market = self.cash
            for code, item in self.holdings.items():
                # 现价暂时使用成本价代替（实际应来自行情）
                current_price = item['cost']
                market_value = round(current_price * item['shares'], 2)
                profit = round(market_value - item['cost'] * item['shares'], 2)
                holdings_list.append({
                    'code': code,
                    'shares': item['shares'],
                    'cost': item['cost'],
                    'price': current_price,
                    'profit': profit
                })
                total_market += market_value
            return {
                'cash': self.cash,
                'total_assets': round(total_market, 2),
                'holdings': holdings_list,
                'history': list(self.history)
            }

    def _today(self):
        from datetime import datetime
        return datetime.now().strftime('%Y-%m-%d')
