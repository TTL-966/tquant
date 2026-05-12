# backend/backtest_executor.py

import json
import types
import traceback
import numpy as np
import pandas as pd

class Logger:
    """简单的日志输出器，同时支持 log(msg) 和 log.info(msg) 调用。"""
    def __init__(self, executor):
        self._executor = executor

    def info(self, msg):
        self._executor.logs.append(f"[INFO] {msg}")

    def error(self, msg):
        self._executor.logs.append(f"[ERROR] {msg}")

    def debug(self, msg):
        self._executor.logs.append(f"[DEBUG] {msg}")

    def warn(self, msg):
        self._executor.logs.append(f"[WARN] {msg}")

    def __call__(self, msg):
        self.info(msg)


class BacktestExecutor:
    """基础回测执行器，支持 attribute_history、order_target_value 等 API。"""

    @staticmethod
    def _normalize_security(security):
        """去除股票代码后缀（如 .SZ / .SH / .BJ），返回纯数字代码。"""
        return security.split('.')[0] if '.' in security else security

    def __init__(self, data_source):
        """
        :param data_source: 数据源对象，需提供 get_kline_json 方法。
        """
        self.data_source = data_source
        self.df = None                # 全量K线DataFrame，由run方法赋值
        self.current_idx = -1         # 当前循环的索引
        self.trade_signals = []       # 交易信号列表
        self.logs = []                # 日志列表
        self.daily_functions = []     # run_daily 注册的函数列表

    # ---------- 沙箱构建 ----------
    def _build_sandbox(self, context, logger):
        """返回 sandbox_globals 字典。
        桌面应用无需沙箱限制，直接使用 Python 原生完整内置函数。
        """
        sandbox = {
            '__builtins__': __builtins__,
            'pd': pd,
            'np': np,
            'context': context,
            'log': logger,
            'attribute_history': self._attribute_history_wrapper,
            'history_bars': self._history_bars_wrapper,
            'order_target_value': self._order_target_value_wrapper,
            'order_target_percent': self._order_target_percent_wrapper,
            'get_current_data': self._get_current_data_wrapper,
            'run_daily': self._run_daily_wrapper,
        }
        return sandbox

    # ---------- 内部辅助函数（注入沙箱） ----------
    def _attribute_history_wrapper(self, security, count, fields=None):
        """
        返回 DataFrame，包含过去 count 根K线的请求字段。
        fields: list of fields, 如 ['close','open']；若为 None 则返回所有。
        """
        if self.df is None or self.current_idx < 0:
            return pd.DataFrame()
        start = max(0, self.current_idx - count)
        end = self.current_idx   # 不包含当前 bar
        slice_df = self.df.iloc[start:end]
        if fields is not None and isinstance(fields, (list, tuple)):
            # 确保 date 列总是存在
            cols = ['date'] if 'date' in slice_df.columns else []
            for f in fields:
                if f in slice_df.columns:
                    cols.append(f)
            if not cols:
                return pd.DataFrame()
            slice_df = slice_df[cols]
        # 重置索引以便前端处理
        return slice_df.reset_index(drop=True)

    def _history_bars_wrapper(self, security, count, unit, field):
        """
        返回最近 count 根 K 线的 field 值（numpy array）。
        如果历史数据不足 count，则返回实际可用的数据（长度可能小于 count）。
        策略中可通过 len() 检查数据完整性。
        """
        if self.current_idx < 0:
            return np.array([])
        start = max(0, self.current_idx - count + 1)
        end = self.current_idx + 1
        slice_df = self.df.iloc[start:end]
        if slice_df.empty or field not in slice_df.columns:
            return np.array([])
        vals = slice_df[field].values
        # 返回最近 min(count, len(vals)) 个值
        return vals[-min(count, len(vals)):]

    def _order_target_value_wrapper(self, security, value):
        """
        目标市值下单，记录信号。股数向下取整到100的整数倍。
        根据 self.slippage 决定实际成交价：close / next_open / half_spread。
        """
        code = self._normalize_security(security)
        if self.df is None or self.current_idx < 0:
            return
        bar = self.df.iloc[self.current_idx]
        close_price = bar['close']
        # 计算实际成交价（滑点）
        if self.slippage == 'next_open' and self.current_idx + 1 < len(self.df):
            fill_price = self.df.iloc[self.current_idx + 1]['open']
        else:
            fill_price = close_price
        current_shares = self._get_portfolio_holdings().get(code, 0)
        current_value = current_shares * fill_price
        diff_value = value - current_value
        if abs(diff_value) < 0.01:
            return
        shares_to_trade = diff_value / fill_price
        # 向下取整到100的整数倍（1手）
        if shares_to_trade > 0:
            shares_to_trade = int(shares_to_trade / 100) * 100
        else:
            shares_to_trade = int(shares_to_trade / 100) * 100
        if shares_to_trade == 0:
            return
        # 买入时检查资金是否充足
        if shares_to_trade > 0:
            cost = shares_to_trade * fill_price
            cash = self._get_portfolio_cash()
            if cost > cash:
                self.logs.append(f"[WARN] 资金不足：需要 {cost:.2f}，现金 {cash:.2f}")
                return
        self._record_trade(code, shares_to_trade, fill_price)

    def _order_target_percent_wrapper(self, security, percent):
        """
        目标仓位百分比下单。percent: 0~1 之间的数值。
        计算总资产时包含所有持仓市值。
        """
        code = self._normalize_security(security)
        if self.df is None or self.current_idx < 0:
            return
        cash = self._get_portfolio_cash()
        holdings = self._get_portfolio_holdings()
        current_price = self.df.iloc[self.current_idx]['close']
        total_holding_value = 0.0
        for h_shares in holdings.values():
            total_holding_value += h_shares * current_price
        total_assets = cash + total_holding_value
        target_value = total_assets * percent
        self._order_target_value_wrapper(code, target_value)

    def _get_current_data_wrapper(self, security):
        """
        返回包含当前 bar 信息的字典。
        """
        if self.df is None or self.current_idx < 0:
            return {'last_price': 0.0}
        bar = self.df.iloc[self.current_idx]
        return {
            'last_price': bar['close'],
            'open': bar['open'],
            'high': bar['high'],
            'low': bar['low'],
            'close': bar['close'],
        }

    def _run_daily_wrapper(self, func, time='every_bar'):
        """
        注册一个每天（每根K线）执行的函数。
        参数 time 当前未使用，保留做扩展。
        """
        self.daily_functions.append(func)

    # ---------- 持仓/现金 操作封装 ----------
    def _get_portfolio_cash(self):
        """从 context 中获取现金。"""
        if hasattr(self._context, 'portfolio'):
            return self._context.portfolio.get('cash', 0.0)
        return 0.0

    def _get_portfolio_holdings(self):
        if hasattr(self._context, 'portfolio'):
            return self._context.portfolio.get('holdings', {})
        return {}

    def _record_trade(self, security, shares, price):
        """
        更新持仓和现金，并记录信号。
        shares 正数为买入，负数为卖出。
        """
        code = self._normalize_security(security)
        ctx = self._context
        cash = ctx.portfolio['cash']
        holdings = ctx.portfolio['holdings']
        # 更新现金
        cost = shares * price
        cash -= cost
        ctx.portfolio['cash'] = cash
        # 更新持仓
        current_shares = holdings.get(code, 0)
        new_shares = current_shares + shares
        if abs(new_shares) < 1e-8:
            if code in holdings:
                del holdings[code]
        else:
            holdings[code] = new_shares
        # 记录交易信号
        trade_type = 'buy' if shares > 0 else 'sell'
        date_str = self.df.index[self.current_idx].strftime('%Y-%m-%d')
        self.trade_signals.append({
            'date': date_str,
            'code': code,
            'type': trade_type,
            'price': round(price, 2),
            'shares': round(abs(shares), 2)   # 保留两位小数
        })

    # ---------- 主执行方法 ----------
    def run(self, user_code, stock_code, start_date="2010-01-01", end_date="2026-12-31", initial_cash=1000000, slippage="close"):
        """
        :param user_code: 用户策略代码字符串
        :param stock_code: 股票代码，如 "000001"
        :param start_date: 起始日期字符串 "YYYY-MM-DD"
        :param end_date: 结束日期字符串
        :param initial_cash: 初始资金
        :param slippage: 成交价模式 "close" / "next_open" / "half_spread"
        :return: dict 包含 status, signals, equity_curve, metrics, logs
        """
        self.slippage = slippage
        # 重置状态
        self.trade_signals.clear()
        self.logs.clear()
        self.daily_functions.clear()
        self.current_idx = -1
        self.df = None

        # 1. 获取K线数据
        try:
            raw_str = self.data_source.get_kline_json(stock_code, start_date, end_date, limit=0)
            raw = json.loads(raw_str)
            dates = raw.get('dates', [])
            values = raw.get('values', [])
            if not dates or not values:
                return self._error_result("K线数据为空")
            # values 格式：[[open, close, low, high], ...]
            df = pd.DataFrame(values, columns=['open', 'close', 'low', 'high', 'volume'])
            df.index = pd.to_datetime(dates)
            df.index.name = 'date'
            self.df = df
        except Exception as e:
            return self._error_result(f"获取K线数据失败: {str(e)}")

        # 2. 创建上下文
        context = types.SimpleNamespace()
        context.portfolio = {
            'cash': initial_cash,
            'holdings': {}   # code -> shares
        }
        context.current_dt = None
        context.stock = stock_code
        self._context = context   # 给内部方法访问

        # 3. 日志模块
        logger = Logger(self)

        sandbox = self._build_sandbox(context, logger)

        # 4. 编译并执行用户代码（捕获具体语法错误）
        try:
            code_obj = compile(user_code, '<user_strategy>', 'exec')
        except SyntaxError as e:
            return self._error_result(f"语法错误 (行 {e.lineno}): {e.msg}")
        except Exception as e:
            return self._error_result(f"编译失败: {str(e)}")

        try:
            exec(code_obj, sandbox)
        except NameError as e:
            return self._error_result(f"变量未定义: {str(e)}")
        except AttributeError as e:
            return self._error_result(f"属性错误: {str(e)}")
        except Exception as e:
            return self._error_result(f"策略执行失败: {str(e)}\n{traceback.format_exc()}")

        # 5. 检查必需函数
        initialize = sandbox.get('initialize')
        handle_bar = sandbox.get('handle_bar')
        if initialize is None:
            return self._error_result("缺少 initialize 函数")
        if handle_bar is None:
            return self._error_result("缺少 handle_bar 函数")

        # 6. 执行 initialize（捕获运行时错误）
        try:
            initialize(context)
        except NameError as e:
            return self._error_result(f"initialize 中变量未定义: {str(e)}")
        except AttributeError as e:
            return self._error_result(f"initialize 中属性错误: {str(e)}")
        except Exception as e:
            return self._error_result(f"initialize 执行出错: {str(e)}\n{traceback.format_exc()}")

        # 7. 主循环 & 记录权益曲线
        equity_curve = []
        logs = self.logs
        logs.append("模拟: 回测开始...")
        total_rows = len(df)
        for idx in range(total_rows):
            bar = df.iloc[idx]
            context.current_dt = df.index[idx]
            self.current_idx = idx
            bar_dict = {
                'open': bar['open'],
                'high': bar['high'],
                'low': bar['low'],
                'close': bar['close'],
                'volume': bar.get('volume', 0)
            }
            try:
                handle_bar(context, bar_dict)
            except NameError as e:
                logs.append(f"第 {idx} 根K线 handle_bar 中变量未定义: {str(e)}")
            except AttributeError as e:
                logs.append(f"第 {idx} 根K线 handle_bar 中属性错误: {str(e)}")
            except Exception as e:
                logs.append(f"第 {idx} 根K线 handle_bar 出错: {str(e)}\n{traceback.format_exc()}")
                # 继续，不中断

            # 执行 run_daily 注册的函数
            for dfunc in self.daily_functions:
                try:
                    dfunc(context)
                except Exception as e:
                    logs.append(f"第 {idx} 根K线 run_daily 函数出错: {str(e)}")

            # 计算当前总资产 = 现金 + 持仓市值
            cash = context.portfolio['cash']
            holdings_value = 0.0
            for code, shares in context.portfolio['holdings'].items():
                close_price = bar['close']  # 用当前 bar 的价格估算
                holdings_value += shares * close_price
            total_assets = cash + holdings_value
            equity_curve.append({
                'date': df.index[idx].strftime('%Y-%m-%d'),
                'value': round(total_assets, 2)
            })
        logs.append("模拟: 回测结束。")

        # 8. 计算绩效指标（增强版）
        metrics = self._compute_metrics(equity_curve, initial_cash)

        # 9. 构建返回结果
        result = {
            'status': 'success',
            'signals': self.trade_signals,
            'equity_curve': equity_curve,
            'metrics': metrics,
            'logs': logs
        }
        return result

    # ---------- 辅助方法 ----------
    def _compute_metrics(self, equity_curve, initial_cash):
        if not equity_curve:
            return {}
        # 提取最终权益
        final_value = equity_curve[-1]['value']
        total_ret = (final_value / initial_cash - 1) * 100.0

        # 日收益率序列
        returns = []
        for i in range(1, len(equity_curve)):
            prev = equity_curve[i-1]['value']
            cur = equity_curve[i]['value']
            if prev > 0:
                returns.append((cur - prev)/prev)
        if not returns:
            return {'total_return': round(total_ret,2), 'total_trades': len(self.trade_signals)}

        total_return = round(total_ret, 2)
        # 年化收益率（假设一年250个交易日）
        n_days = len(returns)
        if n_days > 0:
            annual_ret = ( (1 + total_ret/100.0) ** (250.0/n_days) - 1) * 100.0
        else:
            annual_ret = 0.0
        # 最大回撤
        peak = initial_cash
        max_drawdown = 0.0
        max_drawdown_start = 0
        max_drawdown_end = 0
        drawdown_duration = 0
        current_peak_idx = 0
        for idx, pt in enumerate(equity_curve):
            if pt['value'] > peak:
                peak = pt['value']
                current_peak_idx = idx
            dd = (peak - pt['value']) / peak * 100.0
            if dd > max_drawdown:
                max_drawdown = dd
                max_drawdown_start = current_peak_idx
                max_drawdown_end = idx
        # 最长回撤期（天数）
        if max_drawdown_end > max_drawdown_start:
            drawdown_duration = max_drawdown_end - max_drawdown_start
        # 夏普比率（无风险利率=0）
        if len(returns) > 0:
            mean_ret = np.mean(returns)
            std_ret = np.std(returns, ddof=1)
            sharpe = (mean_ret / std_ret) * np.sqrt(250.0) if std_ret > 0 else 0.0
        else:
            sharpe = 0.0
        # 年化波动率
        if len(returns) > 0:
            annual_vol = np.std(returns, ddof=1) * np.sqrt(250.0) * 100.0
        else:
            annual_vol = 0.0
        # 信息比率（无基准时设为0）
        information_ratio = 0.0
        # 胜率（简化为盈利交易比例，这里未记录单笔盈亏，暂设0）
        win_rate = 0.0
        # 总交易次数
        total_trades = len(self.trade_signals)
        metrics = {
            'total_return': round(total_return,2),
            'annual_return': round(annual_ret,2),
            'max_drawdown': round(max_drawdown,2),
            'max_drawdown_duration': drawdown_duration,
            'sharpe_ratio': round(sharpe,2),
            'annual_volatility': round(annual_vol,2),
            'information_ratio': round(information_ratio,2),
            'win_rate': round(win_rate,2),
            'total_trades': total_trades
        }
        return metrics

    def _error_result(self, msg):
        return {
            'status': 'error',
            'error': msg,
            'signals': [],
            'equity_curve': [],
            'metrics': {},
            'logs': [msg]
        }
