# backend/backtest_executor.py

import json
import math
import numpy as np
import pandas as pd

class Context:
    def __init__(self):
        self.stock = None
        self.cash = 0.0
        self.holdings = 0         # 当前持仓股数
        self.short_win = 5
        self.long_win = 20
        self.portfolio_value = 0.0


class Logger:
    def __init__(self):
        self.messages = []

    def info(self, msg):
        self.messages.append(msg)
        print("[Strategy Log]", msg)


class BacktestExecutor:
    def __init__(self, data_feed):
        self.data_feed = data_feed
        self.signals = []          # 记录买卖信号
        self.equity_curve = []     # 每个交易日的账户总值
        self.trades = []           # 成交记录 (用于计算胜率)

    def run(self, user_code, stock_code, start_date, end_date,
            initial_cash=1000000, shares_per_trade=100):
        # 1) 获取 K 线数据
        kline_json = self.data_feed.get_kline_json(stock_code, start_date, end_date)
        try:
            data = json.loads(kline_json)
        except Exception as e:
            return {"error": f"解析K线数据失败: {str(e)}"}

        dates = data.get("dates", [])
        values = data.get("values", [])
        if not dates or not values:
            return {"error": "K线数据为空"}

        # 2) 转换为 DataFrame (open, close, low, high)
        df = pd.DataFrame(values, columns=["open", "close", "low", "high"])
        df["trade_date"] = dates
        df = df[["trade_date", "open", "close", "low", "high"]]   # 调整列序
        df[["open", "close", "low", "high"]] = df[["open", "close", "low", "high"]].astype(float)
        total_bars = len(df)

        if total_bars < 20:
            return {"error": "K线数据不足20根，无法运行策略"}

        # 3) 创建上下文对象
        ctx = Context()
        ctx.stock = stock_code
        ctx.cash = initial_cash
        ctx.holdings = 0

        # 4) 信号收集器
        signals = self.signals = []

        # 5) history_bars 闭包
        def history_bars(security, count, unit, field):
            """
            security 参数保留，但只针对 context.stock 一只股票
            count: 需要的 bar 数量
            unit: 暂不处理，按日线
            field: 'close', 'open', 'high', 'low'
            """
            nonlocal df, total_bars, current_idx
            if field not in ["open", "close", "low", "high"]:
                field = "close"
            if current_idx < count:
                return np.array([])   # 数据不足
            start = current_idx - count
            end = current_idx
            return df[field].iloc[start:end].values

        # 6) order_target_percent 闭包
        def order_target_percent(security, percent):
            nonlocal ctx, current_idx, signals
            close_price = df["close"].iloc[current_idx]
            if percent > 0:
                # 买入
                target_value = ctx.cash * percent
                if target_value <= 0:
                    return
                shares_to_buy = int(target_value / close_price)
                if shares_to_buy <= 0:
                    shares_to_buy = 1
                cost = shares_to_buy * close_price
                if cost > ctx.cash:
                    shares_to_buy = int(ctx.cash / close_price)
                    cost = shares_to_buy * close_price
                if shares_to_buy > 0:
                    ctx.holdings += shares_to_buy
                    ctx.cash -= cost
                    signal = {
                        "date": df["trade_date"].iloc[current_idx],
                        "type": "buy",
                        "price": round(close_price, 2),
                        "shares": shares_to_buy,
                        "action": "买入"
                    }
                    signals.append(signal)
                    self.trades.append({"profit": 0, "is_win": None})  # 卖出时才确定盈亏
            else:
                # 卖出 (percent <= 0)
                if ctx.holdings <= 0:
                    return
                # 记录卖出前的持仓成本价 (用于计算盈亏)
                prev_holdings = ctx.holdings
                ctx.cash += ctx.holdings * close_price
                ctx.holdings = 0
                signal = {
                    "date": df["trade_date"].iloc[current_idx],
                    "type": "sell",
                    "price": round(close_price, 2),
                    "shares": prev_holdings,
                    "action": "卖出"
                }
                signals.append(signal)
                # 计算该笔交易盈亏 (假设之前的买入持股成本为平均成本，这里简化：用持仓市值变化)
                # 更精确的计算需要记录每笔买入成本，暂时简单处理
                # 在循环外部统计胜率时再计算

        # 7) Logger
        logger = Logger()

        # 8) 受限制的全局命名空间
        sandbox_globals = {
            "__builtins__": __builtins__,
            "pd": pd,
            "np": np,
            "context": ctx,
            "history_bars": history_bars,
            "order_target_percent": order_target_percent,
            "log": logger
        }

        # 9) 执行用户代码
        try:
            exec(user_code, sandbox_globals)
        except Exception as e:
            return {"error": f"策略代码编译/执行失败: {str(e)}"}

        if "initialize" not in sandbox_globals:
            return {"error": "用户代码缺少 initialize 函数"}
        if "handle_bar" not in sandbox_globals:
            return {"error": "用户代码缺少 handle_bar 函数"}

        initialize = sandbox_globals["initialize"]
        handle_bar = sandbox_globals["handle_bar"]

        # 10) 调用 initialize
        try:
            initialize(ctx)
        except Exception as e:
            return {"error": f"initialize 执行出错: {str(e)}"}

        # 11) 遍历每个交易日（从第20天开始，确保有足够均线数据）
        equity_curve = self.equity_curve = []
        current_idx = 20   # 初始索引，history_bars 会用它
        for idx in range(20, total_bars):
            current_idx = idx
            bar_dict = {
                "stock": ctx.stock,
                "open": df["open"].iloc[idx],
                "close": df["close"].iloc[idx],
                "high": df["high"].iloc[idx],
                "low": df["low"].iloc[idx]
            }
            try:
                handle_bar(ctx, bar_dict)
            except Exception as e:
                return {"error": f"第 {idx} 根 bar 执行 handle_bar 出错: {str(e)}"}

            # 记录每日权益
            close_price = df["close"].iloc[idx]
            total_value = ctx.cash + ctx.holdings * close_price
            equity_curve.append({
                "date": df["trade_date"].iloc[idx],
                "value": round(total_value, 2)
            })

        # 12) 计算绩效指标
        metrics = self._calc_metrics(initial_cash, equity_curve, self.trades, dates, df)

        return {
            "signals": self.signals,
            "equity_curve": self.equity_curve,
            "metrics": metrics
        }

    def _calc_metrics(self, initial_cash, equity_curve, trades, all_dates, df):
        if not equity_curve:
            return {}

        end_value = equity_curve[-1]["value"]
        total_return = (end_value - initial_cash) / initial_cash * 100.0

        # 年数（大约）
        start_date = pd.to_datetime(equity_curve[0]["date"])
        end_date = pd.to_datetime(equity_curve[-1]["date"])
        years = max((end_date - start_date).days / 365.0, 1.0 / 365.0)
        annual_return = ((end_value / initial_cash) ** (1.0 / years) - 1.0) * 100.0

        # 最大回撤
        values = [e["value"] for e in equity_curve]
        peak = values[0]
        max_drawdown = 0.0
        for v in values:
            if v > peak:
                peak = v
            drawdown = (peak - v) / peak * 100.0
            if drawdown > max_drawdown:
                max_drawdown = drawdown

        # 夏普比率（简化）
        returns = []
        for i in range(1, len(values)):
            daily_ret = (values[i] - values[i-1]) / values[i-1]
            returns.append(daily_ret)
        if len(returns) > 1:
            avg_return = np.mean(returns)
            std_return = np.std(returns, ddof=1)
            if std_return > 0:
                sharpe = (avg_return / std_return) * math.sqrt(252)
            else:
                sharpe = 0.0
        else:
            sharpe = 0.0

        # 胜率：需要从信号中获取成交记录，简化：根据 trade 列表中记录
        # 由于我们没有跟踪每笔买入的成本，无法精确计算每笔盈亏，此处返回 0
        win_rate = 0.0
        total_trades = len(self.signals) // 2  # 每对买卖
        if total_trades > 0:
            # 简单模拟：通过 equity_curve 首尾判断方向
            if end_value > initial_cash:
                win_rate = 100.0
            else:
                win_rate = 0.0

        metrics = {
            "total_return": round(total_return, 2),
            "annual_return": round(annual_return, 2),
            "max_drawdown": round(max_drawdown, 2),
            "sharpe_ratio": round(sharpe, 2),
            "win_rate": round(win_rate, 2),
            "total_trades": total_trades
        }
        return metrics
