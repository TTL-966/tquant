# backend/backtest_executor.py

import json
import types
import functools
import numpy as np
import pandas as pd

class BacktestExecutor:
    """基础回测执行器，提供沙箱运行、主循环框架。"""

    def __init__(self, data_source):
        """
        :param data_source: 数据源对象，需提供 get_kline_data 方法。
        """
        self.data_source = data_source

    # ---------- 沙箱构建 ----------
    def _build_sandbox(self, context, history_bars, order_target_percent, log):
        """返回安全的 sandbox_globals 字典。"""
        # 白名单内置函数
        safe_builtins = {
            k: v for k, v in __builtins__.items()
            if k in {
                'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'float',
                'getattr', 'hasattr', 'int', 'isinstance', 'len', 'list',
                'map', 'max', 'min', 'print', 'range', 'reversed',
                'round', 'set', 'sorted', 'str', 'sum', 'tuple', 'type',
                'vars', 'zip'
            }
        }

        sandbox = {
            '__builtins__': safe_builtins,
            'pd': pd,
            'np': np,
            'context': context,
            'history_bars': history_bars,
            'order_target_percent': order_target_percent,
            'log': log,
        }
        return sandbox

    # ---------- 主执行方法 ----------
    def run(self, user_code_str, params_json):
        """
        :param user_code_str: 用户策略代码字符串
        :param params_json: JSON 字符串，包含股票代码、日期范围等
        :return: JSON 字符串（状态和日志）
        """
        # 1. 解析参数
        try:
            params = json.loads(params_json)
        except json.JSONDecodeError:
            return json.dumps({"status": "error", "logs": ["参数 JSON 解析失败"]})

        stock_code = params.get("stock", "000001")
        start_date = params.get("start", "2010-01-01")
        end_date = params.get("end", "2026-12-31")
        initial_cash = params.get("cash", 1000000)

        # 2. 获取 K 线数据，构建 DataFrame（索引为日期）
        try:
            raw_data = self.data_source.get_kline_data(stock_code, start_date, end_date)
            # 假设 raw_data 是 {"dates": [...], "values": [[o,c,l,h], ...]}
            if isinstance(raw_data, str):
                raw_data = json.loads(raw_data)
            dates = raw_data.get("dates", [])
            values = raw_data.get("values", [])
            if not dates or not values:
                return json.dumps({"status": "error", "logs": ["K线数据为空"]})
            df = pd.DataFrame(values, columns=["open", "close", "low", "high"])
            df.index = pd.to_datetime(dates)
            df.index.name = "date"
        except Exception as e:
            return json.dumps({"status": "error", "logs": [f"获取K线数据失败: {str(e)}"]})

        # 3. 创建上下文
        context = types.SimpleNamespace()
        context.portfolio = {"cash": initial_cash, "holdings": {}}   # holdings: {code: shares}
        context.current_dt = None

        # 4. 占位函数（简单输出日志）
        logs = []

        def history_bars(security, count, unit, field):
            logs.append(f"[模拟] history_bars 被调用: security={security}, count={count}, unit={unit}, field={field}")
            # 实际应返回数据，这里只做占位
            return np.array([])

        def order_target_percent(security, percent):
            logs.append(f"[模拟] order_target_percent 被调用: security={security}, percent={percent}")
            # 假设总是成功

        def log(msg):
            logs.append(f"[策略Log] {msg}")

        sandbox = self._build_sandbox(context, history_bars, order_target_percent, log)

        # 5. 编译并执行用户代码
        try:
            code_obj = compile(user_code_str, '<user_strategy>', 'exec')
        except SyntaxError as e:
            return json.dumps({"status": "error", "logs": [f"语法错误: {str(e)}"]})

        try:
            exec(code_obj, sandbox)
        except Exception as e:
            return json.dumps({"status": "error", "logs": [f"策略执行失败: {str(e)}"]})

        # 6. 检查必需函数
        initialize = sandbox.get("initialize")
        handle_bar = sandbox.get("handle_bar")
        if initialize is None:
            return json.dumps({"status": "error", "logs": ["缺少 initialize 函数"]})
        if handle_bar is None:
            return json.dumps({"status": "error", "logs": ["缺少 handle_bar 函数"]})

        # 7. 执行 initialize
        try:
            initialize(context)
        except Exception as e:
            return json.dumps({"status": "error", "logs": [f"initialize 执行出错: {str(e)}"]})

        # 8. 主循环（占位）
        logs.append("模拟: 回测开始...")
        for idx in range(min(len(df), 30)):   # 仅取前30根做演示
            bar = df.iloc[idx]
            context.current_dt = df.index[idx]
            bar_dict = {
                "open": bar["open"],
                "high": bar["high"],
                "low": bar["low"],
                "close": bar["close"],
                "volume": 0    # 暂缺
            }
            try:
                handle_bar(context, bar_dict)
            except Exception as e:
                logs.append(f"第 {idx} 根K线 handle_bar 出错: {str(e)}")
                # 继续，不中断
        logs.append("模拟: 回测结束。")

        # 9. 返回结果
        result = {
            "status": "success",
            "logs": logs
        }
        return json.dumps(result)
