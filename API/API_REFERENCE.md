# Tquant API 参考

## 目录

- [1. Bridge API（Python → JavaScript）](#1-bridge-apipython--javascript)
- [1.12 资金流向](#112-资金流向)
- [1.13 实时策略](#113-实时策略)
- [1.14 持仓管理](#114-持仓管理)
- [1.15 回测历史记录](#115-回测历史记录)
- [1.16 股票筛选](#116-股票筛选)
- [1.17 概念板块](#117-概念板块)
- [1.18 批量实时行情](#118-批量实时行情)
- [1.19 参数优化](#119-参数优化)
- [1.20 板块热度仪表盘](#120-板块热度仪表盘)
- [2. 策略编写 API](#2-策略编写-api)
- [3. 数据格式](#3-数据格式)
- [4. 错误码与异常](#4-错误码与异常)
- [5. 技术指标参考](#5-技术指标参考)
- [6. 指数情绪卡片](#6-指数情绪卡片)

---

## 1. Bridge API（Python → JavaScript）

所有 Bridge 方法通过 Qt WebChannel 暴露给前端，JS 侧通过 `bridge.methodName(params).then(callback)` 调用。

### 1.1 健康检查

#### `ping()`

检查 WebChannel 连接是否正常。

```javascript
bridge.ping().then(function(result) {
    console.log(result); // "pong"
});
```

**返回：** `"pong"` (string)

---

### 1.2 K线与行情

#### `get_kline_data(code, start_date, end_date, limit, period)`

获取K线历史数据。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| code | str | 股票代码，如 `"000001"` |
| start_date | str | 起始日期 `"YYYY-MM-DD"`，空字符串表示无限制 |
| end_date | str | 结束日期 `"YYYY-MM-DD"`，空字符串表示无限制 |
| limit | int | 最大返回条数，0 表示无限制 |
| period | str | 周期：`"daily"` / `"weekly"` / `"monthly"` |

**示例：**
```javascript
bridge.get_kline_data("000001", "2025-01-01", "2025-12-31", 0, "daily")
    .then(function(json) {
        var data = JSON.parse(json);
        console.log(data.dates.length + " 条K线");
    });
```

**返回格式：** 见 [3.1 K线数据格式](#31-k线数据格式)

---

#### `get_latest_price(code)`

获取股票最近一个交易日的收盘价及涨跌信息。

```javascript
bridge.get_latest_price("000001").then(function(json) {
    var data = JSON.parse(json);
    // { price: 12.35, date: "2025-05-20", prev_close: 12.20,
    //   change: 0.15, change_pct: 1.23 }
});
```

---

#### `get_realtime_quote(code)`

获取实时行情报价（来自腾讯财经 API）。

```javascript
bridge.get_realtime_quote("000001").then(function(json) {
    var quote = JSON.parse(json);
    // { success: true, source: "tencent", code: "000001",
    //   price: 12.35, prev_close: 12.20, change: 0.15, change_pct: 1.23,
    //   high: 12.50, low: 12.10, volume: 12345678, amount: 152345678.90 }
});
```

**说明：**
- `source = "tencent"`：成功获取实时数据
- `source = "latest_price"`：API 不可用，回退到数据库最近收盘价
- `success = false`：获取失败

---

### 1.3 行业与指数

#### `get_industry(code)`

查询股票所属行业。

```javascript
bridge.get_industry("000001").then(function(json) {
    var data = JSON.parse(json);
    // { industry: "银行" }
});
```

---

#### `get_stocks_by_industry(industry)`

按行业名称搜索股票。

```javascript
bridge.get_stocks_by_industry("银行").then(function(json) {
    var stocks = JSON.parse(json);
    // [ { code: "000001", name: "平安银行" }, ... ]
});
```

---

#### `get_index_stocks(index_code)`

获取指数成分股列表。

```javascript
bridge.get_index_stocks("000300.XSHG").then(function(json) {
    var stocks = JSON.parse(json);
    // [ "000001", "000002", ... ]  // 沪深300成分股代码
});
```

**支持的指数代码：**
- `000300.XSHG` — 沪深 300
- `000905.XSHG` — 中证 500
- `000016.XSHG` — 上证 50
- `399006.XSHE` — 创业板指
- `000688.XSHG` — 科创 50

---

#### `get_limit_status(code, target_date)`

获取指定日期的涨跌停价格。

```javascript
bridge.get_limit_status("000001", "2025-05-20").then(function(json) {
    var data = JSON.parse(json);
    // { is_limit_up: false, is_limit_down: false,
    //   limit_up_price: 13.42, limit_down_price: 10.98, prev_close: 12.20 }
});
```

---

### 1.4 回测

> **v1.5.0 重大变更：** 回测 API 从同步阻塞改为异步轮询模式。所有回测启动方法立即返回 `{success, job_id}`，前端需通过 `get_backtest_progress` / `get_backtest_result` 获取结果。

#### `run_custom_backtest(params_json)`

启动单股自定义策略回测（后台 QThread 执行，立即返回）。

```javascript
var params = {
    code: userCode,           // 策略 Python 代码（字符串）
    stock: "000001",          // 单只股票代码
    start: "2025-01-01",
    end: "2025-12-31",
    cash: 1000000,
    slippage: "close",        // "close" / "next_open" / "half_spread"
    commission_rate: 0.0003,
    stamp_tax_rate: 0.001,
    slippage_cost_type: "percent",
    slippage_cost_value: 0.1,
    benchmark_code: "000300.SH"  // 可选：基准指数
};
bridge.run_custom_backtest(JSON.stringify(params)).then(function(json) {
    var startRes = JSON.parse(json);
    // { success: true, job_id: "a1b2c3d4e5f6", message: "回测已启动" }
    // 立即开始轮询进度...
});
```

**v1.5.0 变化：** 不再返回完整回测结果。使用 `job_id` 配合以下 API 获取进度和结果。

---

#### `run_multi_backtest(params_json)`

启动多股组合回测（后台 QThread 执行，立即返回）。

```javascript
var params = {
    code: userCode,           // 含 STOCK_CODE_PLACEHOLDER 占位符
    stocks: ["000001", "000002", "600519"],
    start: "2025-01-01",
    end: "2025-12-31",
    cash: 1000000,
    slippage: "close"
};
bridge.run_multi_backtest(JSON.stringify(params)).then(function(json) {
    var startRes = JSON.parse(json);
    // { success: true, job_id: "...", message: "多股回测已启动" }
});
```

---

#### `run_compare_backtest(params_json)`

启动多策略变体对比回测（后台 QThread 执行，立即返回）。

```javascript
var params = {
    stock_pool: ["000001", "000858", "600519"],   // 多股模式
    // stock_code: "000001",                       // 单股模式（兼容旧版）
    start: "2025-01-01",
    end: "2025-12-31",
    cash: 1000000,
    slippage: "close",
    variations: [
        { name: "MA(5,20)", code: "import numpy as np\n..." },
        { name: "MA(10,30)", code: "import numpy as np\n..." }
    ]
};
bridge.run_compare_backtest(JSON.stringify(params)).then(function(json) {
    var startRes = JSON.parse(json);
    // { success: true, job_id: "...", message: "对比回测已启动" }
});
```

**变体间通过 ThreadPoolExecutor（最多 5 线程）在 QThread 内部并行执行。** 多股模式下返回组合权益曲线和个股绩效归因。

---

#### `get_backtest_progress(job_id)` <span style="color:#4f7eff">NEW v1.5.0</span>

轮询回测任务进度。前端每 500ms 调用一次。

```javascript
bridge.get_backtest_progress("a1b2c3d4e5f6").then(function(json) {
    var prog = JSON.parse(json);
    // { status: "running", current: 150, total: 2500 }
    // status: "running" | "finished" | "cancelling" | "not_found"
});
```

---

#### `get_backtest_result(job_id)` <span style="color:#4f7eff">NEW v1.5.0</span>

获取已完成的回测结果。仅在 `status == "finished"` 时才返回数据。

```javascript
bridge.get_backtest_result("a1b2c3d4e5f6").then(function(json) {
    var res = JSON.parse(json);
    // { ready: true, result: { success: true, signals: [...], equity_curve: [...], metrics: {...}, logs: [...] } }
    // 或 { ready: false } 如果仍在运行
});
```

**返回格式：** 见 [3.2 回测结果格式](#32-回测结果格式)

---

#### `cancel_backtest(job_id)` <span style="color:#4f7eff">NEW v1.5.0</span>

取消正在运行的回测任务。

```javascript
bridge.cancel_backtest("a1b2c3d4e5f6").then(function(json) {
    var res = JSON.parse(json);
    // { success: true }
});
```

---

#### `cleanup_backtest(job_id)` <span style="color:#4f7eff">NEW v1.5.0</span>

从内存中移除已完成的回测结果（释放内存）。

```javascript
bridge.cleanup_backtest("a1b2c3d4e5f6").then(function(json) {
    var res = JSON.parse(json);
    // { success: true }
});
```

---

#### 完整轮询示例

```javascript
function pollBacktestResult(jobId) {
    var pollInterval = setInterval(function() {
        bridge.get_backtest_progress(jobId).then(function(progStr) {
            var prog = JSON.parse(progStr);
            if (prog.status === 'finished') {
                clearInterval(pollInterval);
                bridge.get_backtest_result(jobId).then(function(resStr) {
                    var res = JSON.parse(resStr);
                    var result = res.result;
                    // 渲染回测结果...
                    bridge.cleanup_backtest(jobId);
                });
            } else if (prog.status === 'running') {
                var pct = Math.round(prog.current / prog.total * 100);
                console.log('Progress: ' + pct + '%');
            }
        });
    }, 500);
}
```

---

#### `run_backtest(code, start_date, end_date)`

运行内置双均线策略（MA5/MA20）。

```javascript
bridge.run_backtest("000001", "2025-01-01", "2025-12-31").then(function(json) {
    var result = JSON.parse(json);
    // { success: true, signals: [...], ma_data: {...}, equity_curve: [...] }
});
```

---

#### `get_signals(code)`

获取上一次内置策略回测的买卖信号。

```javascript
bridge.get_signals("000001").then(function(json) {
    var data = JSON.parse(json);
    // { signals: [ { date: "2025-03-15", type: "buy", price: 12.35, shares: 800 }, ... ] }
});
```

---

### 1.5 模拟交易

#### `execute_trade(code, action, shares, price, trade_date)`

执行一笔模拟交易。

```javascript
bridge.execute_trade("000001", "buy", 1000, 12.35, "2025-05-20").then(function(json) {
    var result = JSON.parse(json);
    // { success: true, message: "买入成功" }
});
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| code | str | 股票代码 |
| action | str | `"buy"` 或 `"sell"` |
| shares | int | 交易数量（股） |
| price | float | 交易价格 |
| trade_date | str | 交易日期 `"YYYY-MM-DD"` |

---

#### `get_portfolio()`

获取当前模拟持仓和资产状况。

```javascript
bridge.get_portfolio().then(function(json) {
    var portfolio = JSON.parse(json);
    // {
    //   cash: 950000.00,
    //   total_assets: 1012345.67,
    //   holdings: [
    //     { code: "000001", shares: 1000, cost_price: 12.35,
    //       current_price: 13.20, profit: 850.00, display: "平安银行" }
    //   ],
    //   history: [
    //     { date: "2025-05-20", code: "000001", action: "buy",
    //       shares: 1000, price: 12.35, value: 12350.00 }
    //   ]
    // }
});
```

---

#### `get_traded_stocks()`

获取当前持仓的股票列表。

```javascript
bridge.get_traded_stocks().then(function(json) {
    var data = JSON.parse(json);
    // { stocks: [ { code: "000001", display: "000001 平安银行" } ] }
});
```

---

### 1.6 数据库查询

#### `search_stock(keyword)`

按代码或名称模糊搜索股票。

```javascript
bridge.search_stock("平安").then(function(json) {
    var results = JSON.parse(json);
    // [ { code: "000001", name: "平安银行", display: "000001 平安银行" }, ... ]
    // 最多返回 50 条结果
});
```

---

#### `test_db_connection()`

检查数据库连接状态。

```javascript
bridge.test_db_connection().then(function(json) {
    var status = JSON.parse(json);
    // { connected: true, message: "数据库连接正常" }
});
```

---

#### `get_stock_financial(code)`

查询个股最新财务数据和行业分类信息。

```javascript
bridge.get_stock_financial("000001").then(function(json) {
    var data = JSON.parse(json);
    // { success: true, pe_ttm: 5.23, pb: 0.68, roe: 12.5,
    //   total_mv: 2645.32, net_profit: 452.18, float_shares: 194.06,
    //   update_date: "2026-05-20" }
});
```

**返回字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| success | bool | 是否查询成功 |
| pe_ttm | float | 市盈率（TTM） |
| pb | float | 市净率 |
| roe | float | 净资产收益率（%） |
| total_mv | float | 总市值（亿元） |
| net_profit | float | 净利润（亿元） |
| float_shares | float | 流通股本（亿股） |
| update_date | str | 数据更新日期 |

---

#### `get_latest_trading_date()`

获取数据库中全局最新交易日。

```javascript
bridge.get_latest_trading_date().then(function(json) {
    var data = JSON.parse(json);
    // { success: true, date: "2026-05-23" }
});
```

---

### 1.7 条件选股

#### `screen_stocks(cards_json, stock_pool_json, start_date, end_date)`

批量条件选股，根据策略卡片条件筛选股票。

```javascript
var cards = [
    { type: "pe_below", params: { maxPE: 20 } },
    { type: "roe_above", params: { minROE: 15 } }
];
var stockPool = ["000001", "000002", "600519"];  // null 表示全市场

bridge.screen_stocks(JSON.stringify(cards), JSON.stringify(stockPool), "2026-01-01", "2026-05-20")
    .then(function(json) {
        var result = JSON.parse(json);
        // { success: true, total: 15, stocks: ["000001", "600519", ...] }
    });
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| cards_json | str | 策略卡片数组的 JSON 字符串 |
| stock_pool_json | str | 股票池数组的 JSON 字符串（null 表示全市场筛选） |
| start_date | str | 起始日期 `"YYYY-MM-DD"`，空字符串表示不限 |
| end_date | str | 结束日期 `"YYYY-MM-DD"`，空字符串表示最新日期 |

**支持的卡片类型：** 与策略工厂相同，包括技术指标和财务指标卡片，以及资金流向（fund_flow_single）、超级趋势（supertrend）、CMF、共振（resonance）、趋势强度（trend_strength）等。

---

#### `test_evaluate_stock(code_json, card_json)`

测试单只股票是否满足选股条件。

```javascript
var code = JSON.stringify(["000001"]);
var card = JSON.stringify({ type: "pe_below", params: { maxPE: 20 } });

bridge.test_evaluate_stock(code, card).then(function(json) {
    var result = JSON.parse(json);
    // { code: "000001", result: true, reason: "PE(TTM)=5.23 ≤ 20.00" }
});
```

---

### 1.8 策略持久化

#### `list_strategies()`

列出所有已保存的策略。

```javascript
bridge.list_strategies().then(function(json) {
    var strategies = JSON.parse(json);
    // [ { id: 1, name: "双均线策略", code: "import numpy as np\n..." } ]
});
```

---

#### `load_strategy(strategy_id)`

加载指定策略。

```javascript
bridge.load_strategy(1).then(function(json) {
    var strategy = JSON.parse(json);
    // { id: 1, name: "双均线策略", code: "..." }
});
```

---

#### `save_strategy(name, code, strategy_id)`

保存或更新策略。

```javascript
// 新建策略
bridge.save_strategy("我的策略", pythonCode, 0).then(function(json) {
    var result = JSON.parse(json);
    // { success: true, id: 5 }
});

// 更新已有策略
bridge.save_strategy("我的策略v2", pythonCode, 5).then(function(json) {
    var result = JSON.parse(json);
    // { success: true, id: 5 }
});
```

---

#### `delete_strategy(strategy_id)`

删除策略。

```javascript
bridge.delete_strategy(1).then(function(json) {
    var result = JSON.parse(json);
    // { success: true }
});
```

---

### 1.9 数据更新

#### `trigger_data_update()`

手动触发数据更新（子进程执行）。

```javascript
bridge.trigger_data_update().then(function(json) {
    var result = JSON.parse(json);
    // { success: true, message: "数据更新已启动" }
});
```

---

### 1.10 报告导出

#### `export_report(data_json)`

导出回测报告为 Excel 和 PDF。

```javascript
var reportData = {
    strategyName: "双均线策略",
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    equityCurve: [...],      // 也兼容 equity_curve（snake_case）
    metrics: { total_return: 23.5, annual_return: 18.2, ... },
    signals: [...],
    stockPerformance: [...]  // 也兼容 stock_performance（snake_case），多股回测时使用
};
bridge.export_report(JSON.stringify(reportData)).then(function(json) {
    var result = JSON.parse(json);
    // { success: true, excel: "path/to/report.xlsx", pdf: "path/to/report.pdf" }
    // 或 { success: false, cancelled: true } 如果用户取消保存
});
```

**字段兼容性：** 后端自动兼容 camelCase（`equityCurve`）和 snake_case（`equity_curve`）两种命名风格。多股回测结果可直接传入，无需手动转换字段名。

---

#### `run_compare_backtest(params_json)`

执行多策略变体对比回测。基于策略工厂卡片配置的数值参数，自动生成变体代码并并行执行。**支持单股和多股组合回测（共享资金池）。**

```javascript
// 多股组合对比回测（推荐）
var params = {
    stock_pool: ["000001", "000858", "600519"],   // 多只股票，共享资金池
    start: "2025-01-01",
    end: "2025-12-31",
    cash: 1000000,
    slippage: "close",
    commission_rate: 0.0003,
    stamp_tax_rate: 0.001,
    slippage_cost_type: "percent",
    slippage_cost_value: 0.1,
    variations: [
        { name: "MA(5,20)", code: "import numpy as np\n..." },
        { name: "MA(10,30)", code: "import numpy as np\n..." }
    ]
};

// 单股对比回测（兼容旧版）
var params = {
    stock_code: "000001",                          // 单只股票
    variations: [...]
};

bridge.run_compare_backtest(JSON.stringify(params)).then(function(json) {
    var result = JSON.parse(json);
    // result.results 包含每个变体的 {name, metrics, equity_curve, signals, stock_performance}
    // result.errors 包含执行失败的变体信息
});
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| stock_pool | array | **（推荐）** 股票代码数组，长度 > 1 时使用多股组合回测 |
| stock_code | str | （兼容旧版）单只股票代码，stock_pool 不存在时生效 |
| variations | array | 策略变体列表，每个含 `name` 和 `code` |
| start | str | 起始日期 |
| end | str | 结束日期 |
| cash | int | 初始资金 |
| slippage | str | 成交价模式：close / next_open / half_spread |
| commission_rate | float | 佣金费率 |
| stamp_tax_rate | float | 印花税率 |
| slippage_cost_type | str | 滑点类型：percent / fixed |
| slippage_cost_value | float | 滑点值 |

**说明：**
- 变体间通过 `ThreadPoolExecutor`（最多 5 个线程）并行执行
- 每个变体在独立沙箱中运行，互不干扰
- **多股模式**（stock_pool 长度 > 1）：使用 `MultiBacktestExecutor`，共享资金池、先卖后买，返回组合权益曲线和组合绩效。变体代码中的 `STOCK_CODE_PLACEHOLDER` 由后端对每只股票独立替换
- **单股模式**（stock_pool 长度 = 1 或无 stock_pool）：使用 `BacktestExecutor`，保持向后兼容
- 返回的 `metrics` 包含：`total_return`、`annual_return`、`max_drawdown`、`sharpe_ratio`、`win_rate`、`total_trades`
- 多股模式下额外返回 `stock_performance`（每只股票的独立绩效归因）
- 前端负责根据卡片元数据（`CARD_TYPE_META`）提取参数并生成变体代码

---

### 1.11 文件操作

#### `save_text_file(content, suggested_name)`

弹出系统原生保存对话框，将文本内容写入用户选择的文件。

```javascript
bridge.save_text_file(codeContent, "my_strategy.py").then(function(json) {
    var res = JSON.parse(json);
    // { success: true, path: "E:/Users/xxx/my_strategy.py" }
    // 或 { success: false, cancelled: true } 如果用户取消
    // 或 { success: false, error: "..." } 如果写入失败
});
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| content | str | 要写入文件的文本内容 |
| suggested_name | str | 建议的文件名（用户可在对话框中修改） |

**说明：**
- 使用 `QFileDialog.getSaveFileName` 原生对话框
- 文件过滤器：文本文件 (*.txt)、Python 文件 (*.py)、所有文件 (*)
- 用户取消时返回 `{success: false, cancelled: true}`

---

### 1.12 资金流向

#### `get_fund_flow(code)`

获取单只股票实时资金流向及智能分析建议。

```javascript
bridge.get_fund_flow("000001").then(function(json) {
    var result = JSON.parse(json);
    // { success: true, data: { code, date, main_net, super_net, big_net, medium_net, small_net, source },
    //   suggestion: "主力净流入1234.56万，大额资金进场，建议关注" }
});
```

**返回字段（data）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| code | str | 纯数字股票代码 |
| date | str | 交易日 YYYY-MM-DD |
| main_net | float | 主力净流入（万元） |
| super_net | float | 超大单净流入（万元） |
| big_net | float | 大单净流入（万元） |
| medium_net | float | 中单净流入（万元） |
| small_net | float | 小单净流入（万元） |
| source | str | 数据来源：eastmoney / tonghuashun |

**数据源：** 优先使用东方财富 API，失败时自动切换同花顺备用源。缓存有效期 60 秒。建议文案基于当日主力净额和近 5 日历史趋势自动生成。

---

#### `get_batch_fund_flow(codes_json)`

批量获取资金流向（最多 50 只）。

```javascript
bridge.get_batch_fund_flow(JSON.stringify(["000001","600519"])).then(function(json) {
    var result = JSON.parse(json);
    // { success: true, quotes: { "000001": {...}, "600519": {...} } }
});
```

---

#### `get_fund_flow_history(code, days)`

查询某只股票近 N 日资金流向历史（默认 5 天）。

```javascript
bridge.get_fund_flow_history("000001", 10).then(function(json) {
    var result = JSON.parse(json);
    // { success: true, code: "000001", history: [{date, main_net, ...}, ...] }
});
```

---

### 1.13 实时策略

> **v1.5.0 变更：** 实时策略引擎从 `threading.Thread` + 阻塞 HTTP 重构为 `asyncio + aiohttp`。`stop()` 非阻塞（0ms 返回），支持 200+ 股票并发行情获取，消除僵尸线程。

实时策略引擎在专用 asyncio 事件循环线程中运行，并发获取实时行情 → 调用策略 `handle_bar` → 自动下单到模拟盘。

#### `start_multi_realtime_strategy(params_json)`

启动多股实时策略引擎（推荐）。

```javascript
var params = {
    stock_codes: ["000001", "000858", "600519"],
    strategy_code: "def initialize(context):\n    ...",
    cash: 100000,
    interval: 3,               // 轮询间隔（秒），最小 3
    commission_rate: 0.0003,
    stamp_tax_rate: 0.001,
    slippage_cost_type: "percent",
    slippage_cost_value: 0.1
};
bridge.start_multi_realtime_strategy(JSON.stringify(params)).then(function(json) {
    var res = JSON.parse(json);
    // { success: true, message: "多股策略已启动 (3 只股票)" }
});
```

**特点：**
- 最多支持 50 只股票，共享资金池、先卖后买
- T+1 交易规则：当天买入的股票当日不可卖出
- 历史数据缓存（5 分钟 TTL），新交易日自动清空
- 支持佣金、印花税、滑点成本模拟
- 配置自动持久化，应用重启时可恢复

---

#### `stop_multi_realtime_strategy()`

停止多股实时策略引擎。

```javascript
bridge.stop_multi_realtime_strategy().then(function(json) {
    var res = JSON.parse(json);
    // { success: true, message: "多股策略已停止" }
});
```

---

#### `get_multi_realtime_signals()`

获取多股实时策略产生的新交易信号（消费式，每次调用返回增量）。

```javascript
bridge.get_multi_realtime_signals().then(function(json) {
    var data = JSON.parse(json);
    // { success: true, signals: [...], running: true, stock_codes: [...] }
});
```

---

#### `get_multi_realtime_logs()`

获取多股实时策略引擎产生的新日志（消费式）。

```javascript
bridge.get_multi_realtime_logs().then(function(json) {
    var data = JSON.parse(json);
    // { success: true, logs: ["[INFO] 买入 000001 100股 @12.35", ...], running: true }
});
```

---

#### `get_multi_realtime_all_signals()` / `get_multi_realtime_all_logs()`

非消费式接口，返回所有信号/日志（供页面恢复时使用）。

```javascript
bridge.get_multi_realtime_all_signals().then(function(json) {
    var data = JSON.parse(json);
    // { success: true, signals: [...], running: true, stock_codes: [...] }
});
```

---

#### `get_current_realtime_config()`

返回当前运行的实时策略配置（从持久化文件读取），供页面恢复时填充表单。

```javascript
bridge.get_current_realtime_config().then(function(json) {
    var data = JSON.parse(json);
    // { success: true, config: { stock_codes, strategy_code, cash, interval, ... } }
});
```

---

#### `get_realtime_signals_history()`

获取所有实时信号历史（供 K 线页面叠加显示买卖点）。

```javascript
bridge.get_realtime_signals_history().then(function(json) {
    var data = JSON.parse(json);
    // { success: true, signals: [...] }
});
```

---

#### 单股实时策略（兼容旧版）

`start_realtime_strategy(params_json)` / `stop_realtime_strategy()` / `get_realtime_signals()` / `get_realtime_logs()` 接口与多股版本类似，但 `params_json` 中 `stock_code` 为单个字符串。

---

### 1.14 持仓管理

#### `close_all_positions()`

一键平仓：卖出所有持仓（按最新价格）。

```javascript
bridge.close_all_positions().then(function(json) {
    var res = JSON.parse(json);
    // { success: true, message: "平仓完成：成功 3 只，失败 0 只", closed: 3, failed: 0 }
});
```

---

#### `reset_portfolio()`

重置模拟盘：清空持仓和交易记录，恢复初始资金 1,000,000 元。

```javascript
bridge.reset_portfolio().then(function(json) {
    var res = JSON.parse(json);
    // { success: true, message: "模拟盘已重置，初始资金 1,000,000 元" }
});
```

---

#### `get_portfolio_summary()`

返回持仓汇总：总市值、总成本、浮动盈亏。

```javascript
bridge.get_portfolio_summary().then(function(json) {
    var data = JSON.parse(json);
    // { success: true, total_market_value: 1012345.67, total_cost: 1000000.00,
    //   total_profit: 12345.67, profit_pct: 1.23 }
});
```

---

#### `get_daily_assets()`

返回基于交易历史重构的每日净资产曲线（用于持仓页绘制权益图）。

```javascript
bridge.get_daily_assets().then(function(json) {
    var data = JSON.parse(json);
    // { success: true, dates: [...], cash: [...], total_assets: [...],
    //   daily_returns: [...], cumulative_returns: [...] }
});
```

**限制：** 最多返回 600 个自然日的资产曲线。

---

### 1.15 回测历史记录

#### `save_backtest_result(data_json)`

保存回测结果到数据库。

```javascript
var record = {
    strategyName: "双均线策略",
    stockPool: ["000001", "000858"],
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    initialCash: 1000000,
    metrics: { total_return: 23.5, ... },
    signals: [...],
    equityCurve: [...],
    stockPerformance: [...]
};
bridge.save_backtest_result(JSON.stringify(record)).then(function(json) {
    var res = JSON.parse(json);
    // { success: true, id: 1 }
});
```

---

#### `get_backtest_history()`

获取回测历史记录列表（摘要信息）。

```javascript
bridge.get_backtest_history().then(function(json) {
    var list = JSON.parse(json);
    // [{ id: 1, name: "双均线策略", stock_pool: [...], start: "...", end: "...",
    //    date: "2026-05-29 14:35:21", total_return: 23.5 }, ...]
});
```

---

#### `load_backtest_history(record_id)`

加载指定回测历史记录的完整数据。

```javascript
bridge.load_backtest_history(1).then(function(json) {
    var data = JSON.parse(json);
    // { success: true, strategyName, stockPool, startDate, endDate,
    //   initialCash, metrics, signals, equityCurve, stockPerformance }
});
```

---

#### `delete_backtest_history(record_id)`

删除指定回测历史记录。

```javascript
bridge.delete_backtest_history(1).then(function(json) {
    var res = JSON.parse(json);
    // { success: true }
});
```

---

### 1.16 股票筛选

#### `filter_stocks_by_concepts(codes_json, concepts_json, match_mode)`

根据概念题材过滤股票列表。

```javascript
var codes = JSON.stringify(["000001", "000002", "600519"]);
var concepts = JSON.stringify(["人工智能", "芯片"]);
bridge.filter_stocks_by_concepts(codes, concepts, "any").then(function(json) {
    var result = JSON.parse(json);
    // ["000001", "600519"]  // 匹配任意概念的股票
});
```

**参数：**
- `match_mode = "any"`：匹配任意概念
- `match_mode = "all"`：必须同时匹配所有概念

---

#### `filter_stocks_by_industry(codes_json, industry)`

根据一级行业过滤股票列表。

```javascript
bridge.filter_stocks_by_industry(codes, "银行").then(function(json) {
    var result = JSON.parse(json);
    // ["000001", "002142", ...]
});
```

---

#### `filter_stocks_by_market_cap(codes_json, min_cap, max_cap)`

按总市值区间过滤（单位：亿元），空字符串表示不限制。

```javascript
bridge.filter_stocks_by_market_cap(codes, "100", "500").then(function(json) {
    // 筛选市值 100-500 亿的股票
});
```

---

#### `filter_stocks_by_float_shares(codes_json, min_shares, max_shares)`

按流通股本区间过滤（单位：亿股），空字符串表示不限制。

```javascript
bridge.filter_stocks_by_float_shares(codes, "", "10").then(function(json) {
    // 筛选流通股本 ≤ 10 亿股的股票
});
```

---

### 1.17 概念板块

#### `get_stock_concepts(code)`

获取股票的概念题材列表。

```javascript
bridge.get_stock_concepts("000001").then(function(json) {
    var data = JSON.parse(json);
    // { success: true, concepts: ["MSCI概念", "标普道琼斯A股", "融资融券", ...] }
});
```

---

#### `get_concept_list()`

返回所有概念名称列表（供下拉框使用）。

```javascript
bridge.get_concept_list().then(function(json) {
    var list = JSON.parse(json);
    // ["人工智能", "芯片", "新能源", ...]
});
```

---

#### `get_industry_list()`

返回所有一级行业列表。

```javascript
bridge.get_industry_list().then(function(json) {
    var list = JSON.parse(json);
    // ["银行", "电子", "医药生物", ...]
});
```

---

### 1.18 批量实时行情

#### `get_realtime_quotes(codes_json)`

批量获取多只股票实时行情（腾讯 API 优先，失败自动切换新浪）。用于持仓页行情表格等批量刷场景。

```javascript
bridge.get_realtime_quotes(JSON.stringify(["000001","000858"])).then(function(json) {
    var data = JSON.parse(json);
    // { success: true, quotes: { "000001": { code, price, open, high, low, volume, prev_close },
    //                            "000858": { ... } } }
});
```

**特性：**
- 自动拆分批次（每批最多 50 只）
- 多批次并发获取，降低总延迟
- 单个股票失败不影响其他

---

#### `get_all_stocks()`

返回所有股票代码列表（从 stock_basic 读取）。

```javascript
bridge.get_all_stocks().then(function(json) {
    var codes = JSON.parse(json);
    // ["000001", "000002", ..., "688981"]
});
```

---

#### `get_stocks_by_prefix(prefix)`

获取股票代码以指定前缀开头的股票列表。

```javascript
bridge.get_stocks_by_prefix("000").then(function(json) {
    var codes = JSON.parse(json);
    // ["000001", "000002", ...]
});
```

---

#### `trigger_financial_update()`

手动触发财务数据更新（PE/PB/ROE/总市值/流通股本等），在独立子进程中运行。

```javascript
bridge.trigger_financial_update().then(function(json) {
    var res = JSON.parse(json);
    // { success: true, message: "财务数据更新已在后台启动（预计 3-10 分钟）" }
});
```

---

#### `save_text_file(content, suggested_name)`

文件保存对话框新增 CSV 格式支持（utf-8-sig 编码，确保 Excel 正确打开中文）。

---

### 1.19 参数优化

Optuna TPE 超参搜索，支持单股/多股模式。

#### `start_optimization(params_json)`

启动 Optuna 参数优化搜索。

**参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| strategy_code | str | 策略 Python 代码 |
| stock | str | 股票代码（单股模式） |
| stock_codes | list | 股票代码列表（多股模式，可选） |
| start | str | 回测起始日期 |
| end | str | 回测结束日期 |
| cash | int | 初始资金 |
| objective | str | 优化目标：`"sharpe_drawdown"` / `"sharpe"` / `"return"` |
| n_trials | int | 搜索试验次数（多股模式自动按 sqrt 缩放） |
| params_to_search | list | 待搜索参数 `[{name, type, low, high, step?}]` |
| fixed_params | dict | 固定参数值 `{name: value}` |
| slippage | str | 成交价模式 `"close"` |
| commission_rate | float | 佣金率 |
| stamp_tax_rate | float | 印花税率 |

**返回：** `{ success: true, job_id: "<hex>" }`

```javascript
var params = {
    strategy_code: code,
    stock: "000001",
    start: "2020-01-01", end: "2026-06-30",
    cash: 1000000, objective: "sharpe_drawdown", n_trials: 100,
    params_to_search: [{ name: "c0_fastPeriod", type: "int", low: 5, high: 30, step: 1 }],
    fixed_params: { c0_slowPeriod: 20 }
};
bridge.start_optimization(JSON.stringify(params)).then(function(json) {
    var res = JSON.parse(json);
    // { success: true, job_id: "a1b2c3d4" }
});
```

---

#### `get_optimization_progress(job_id)`

轮询优化进度。

**返回：**
```json
{
  "status": "running",
  "progress": {
    "current": 42, "total": 100, "best_value": 2.35,
    "mode": "single", "stock_count": 1,
    "last_trial": { "number": 41, "value": 1.82, "state": "COMPLETE", "params": {...} }
  }
}
```

```javascript
var timer = setInterval(function() {
    bridge.get_optimization_progress(jobId).then(function(json) {
        var data = JSON.parse(json);
        if (data.status === "finished" || data.status === "cancelled") {
            clearInterval(timer);
            // load result
        }
        updateProgressBar(data.progress);
    });
}, 800);
```

---

#### `get_optimization_result(job_id)`

获取优化完成结果（仅可调用一次，调用后清理 job）。

**返回：**
```json
{
  "ready": true,
  "result": {
    "success": true,
    "best_params": { "c0_fastPeriod": 12 },
    "best_value": 3.45,
    "n_trials_completed": 98,
    "trials": [{ "number": 0, "params": {...}, "value": 1.23, "state": "COMPLETE" }],
    "param_importance": { "c0_fastPeriod": 0.72 },
    "mode": "single", "stock_count": 1
  }
}
```

---

#### `cancel_optimization(job_id)`

取消正在运行的优化。

```javascript
bridge.cancel_optimization(jobId).then(function(json) {
    var res = JSON.parse(json);
    // { success: true }
});
```

---

### 1.20 板块热度仪表盘

概念/行业板块资金流聚合排名 API。

#### `get_sector_heat(sector_type, metric, days, realtime)`

获取板块热度排行数据。

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| sector_type | str | `"concept"` | 板块类型：`"concept"` / `"industry"` |
| metric | str | `"heat_score"` | 排序指标：`"fund_flow"` / `"change_pct"` / `"volume_ratio"` / `"advance_decline"` / `"heat_score"` |
| days | int | 5 | K线回看天数（fund_flow 指标忽略此参数） |
| realtime | bool | false | 是否使用实时行情（暂未实现） |

**返回：**
```json
{
  "sectors": [
    {
      "name": "人工智能",
      "stock_count": 156,
      "avg_change_pct": 3.2,
      "total_fund_flow": 12.5,
      "volume_ratio": 1.8,
      "advance_decline": 0.72,
      "heat_score": 85.3,
      "top_stock": { "code": "002230", "name": "科大讯飞", "change_pct": 8.5 }
    }
  ]
}
```

```javascript
bridge.get_sector_heat("concept", "fund_flow", 5, false).then(function(json) {
    var data = JSON.parse(json);
    data.sectors.forEach(function(s) {
        console.log(s.name, s.total_fund_flow + "亿");
    });
});
```

**指标说明：**

| metric | 含义 | 数据源 |
|--------|------|--------|
| `fund_flow` | 主力资金净流入聚合（万元→亿元） | fund_flow_history 表 |
| `change_pct` | 成分股近N日平均涨跌幅 | daily_kline 表 |
| `volume_ratio` | 近N日均量 / 前N日均量 | daily_kline 表 |
| `advance_decline` | 上涨家数 / 总家数 | daily_kline 表 |
| `heat_score` | 综合热度分 = 涨跌幅×0.4 + 资金流标准化×0.3 + 量比×0.15 + 涨跌比×0.15 | 综合 |

---

#### `get_sector_detail(sector_type, sector_name)`

获取单个板块的成分股资金流明细（Top 20）。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| sector_type | str | `"concept"` / `"industry"` |
| sector_name | str | 板块名称，如 `"人工智能"` |

**返回：**
```json
{
  "name": "人工智能",
  "stocks": [
    { "code": "002230", "name": "科大讯飞", "change_pct": 8.5, "fund_flow": 1.2 },
    { "code": "300033", "name": "同花顺", "change_pct": 5.2, "fund_flow": 0.8 }
  ]
}
```

```javascript
bridge.get_sector_detail("concept", "人工智能").then(function(json) {
    var data = JSON.parse(json);
    data.stocks.forEach(function(s) {
        console.log(s.code, s.name, s.fund_flow + "亿");
    });
});
```

---

## 2. 策略编写 API

自定义策略代码中可用的内置函数和对象。

### 2.1 核心函数

#### `initialize(context)`

**必须实现。** 在回测开始时调用一次，用于设置策略参数。

```python
def initialize(context):
    context.fast = 5       # 快线周期
    context.slow = 20      # 慢线周期
    context.stock = "STOCK_CODE_PLACEHOLDER"  # 股票占位符
```

`context` 对象在回测期间持久存在，可在 `handle_bar` 中访问。

---

#### `handle_bar(context, bar_dict)`

**必须实现。** 每个交易日调用一次，包含策略主逻辑。

```python
def handle_bar(context, bar_dict):
    stock = context.stock
    # 策略逻辑...
```

**参数：**
- `context`：策略上下文（同 initialize 中的 context）
- `bar_dict`：字典，键为股票代码，值为当前 bar 的 OHLCV 数据

**bar_dict 访问方式：**
```python
# ✅ 正确
close_price = bar_dict[stock]['close']
open_price = bar_dict[stock]['open']

# ❌ 错误
# close_price = bar_dict.close
# close_price = bar_dict['close']
```

---

### 2.2 数据获取

#### `history_bars(security, count, unit, field)`

获取历史K线数据。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| security | str | 股票代码 |
| count | int | 回溯的 bar 数量 |
| unit | str | 周期，目前仅支持 `'1d'` |
| field | str | 字段名：`'open'`、`'high'`、`'low'`、`'close'`、`'volume'` |

**返回：** `numpy.ndarray`，包含最近 `count` 个 bar 的指定字段值。

```python
close_arr = history_bars(stock, 20, '1d', 'close')
ma20 = close_arr.mean()

# 计算前一根 bar 的均值（避免未来函数）
fast_ma = fast_arr[-context.fast:].mean()
prev_fast = fast_arr[-context.fast-1:-1].mean()
```

**注意：** 返回值是 numpy 数组，可使用 `.mean()`、`.std()` 等方法。

---

#### `attribute_history(security, count, fields)`

（高级）获取多字段历史数据。

```python
df = attribute_history(stock, 20, ['open', 'high', 'low', 'close', 'volume'])
# 返回 pandas DataFrame
```

---

### 2.3 订单函数

#### `order_target_percent(security, percent)`

调整仓位到目标比例。

```python
# 满仓买入
order_target_percent(stock, 1.0)

# 半仓
order_target_percent(stock, 0.5)

# 清仓
order_target_percent(stock, 0)
```

**说明：**
- 自动计算需要买入/卖出的数量
- 买入时受可用现金限制
- 股票数量自动取整到 100 股（1 手）的倍数

---

#### `order_target_value(security, value)`

调整仓位到目标市值。

```python
# 买入约 10 万元的股票
order_target_value(stock, 100000)

# 清仓
order_target_value(stock, 0)
```

---

### 2.4 日志

#### `log.info(message)` / `log.warn(message)` / `log.error(message)` / `log.debug(message)`

输出日志到前端日志面板。

```python
log.info("买入信号触发: MA5 上穿 MA20")
log.warn("数据不足，跳过本次判断")
log.error("订单执行失败")
log.debug("当前持仓: %s" % context.portfolio.get('holdings', {}))
```

---

### 2.5 上下文对象

#### `context` 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `context.stock` | str | 当前股票代码（在 initialize 中设置） |
| `context.portfolio` | dict | 组合信息（见下） |
| 自定义属性 | any | 用户可在 initialize 中自由添加 |

#### `context.portfolio` 结构

```python
{
    'cash': 950000.00,          # 可用现金
    'total_assets': 1012345.67,  # 总资产
    'holdings': {                # 持仓字典
        '000001': 1000,          # 股票代码 → 持有数量（股）
    }
}
```

**访问示例：**
```python
holdings = context.portfolio.get('holdings', {})
current_position = holdings.get(stock, 0)  # 当前持仓数量
cash = context.portfolio.get('cash', 0)    # 可用现金
```

---

### 2.6 当前数据

#### `get_current_data(security)`

获取当前 bar 的行情数据。

```python
data = get_current_data(stock)
# { 'open': 12.00, 'high': 12.50, 'low': 11.80, 'close': 12.35, 'volume': 12345678 }
```

---

### 2.7 指数情绪 API（新增）

#### `get_index_history(index_code, count, field, strict=True)`

获取指数历史K线数据，用于指数情绪条件判断。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| index_code | str | 指数代码，如 `"000300.SH"`（沪深300） |
| count | int | 需要的历史K线数量 |
| field | str | 字段名：`"close"`、`"open"`、`"high"`、`"low"`、`"volume"` |
| strict | bool | 严格模式，排除当日数据避免未来函数（默认 True） |

**返回：** `numpy.ndarray`，包含最近 `count` 根K线的指定字段值。严格模式下不包含当前交易日数据。

```python
# 获取指数最近 21 个收盘价（不含当日）
closes = get_index_history("000300.SH", 21, "close", strict=True)
ma20 = np.mean(closes[-20:])        # 20 日均线
prev_close = closes[-1]              # 最近收盘价
is_above_ma = prev_close > ma20     # 收盘价高于均线
```

**支持的指数代码：**

| 代码 | 指数名称 |
|------|----------|
| `000300.SH` | 沪深300 |
| `000001.SH` | 上证指数 |
| `399001.SZ` | 深证成指 |
| `000905.SH` | 中证500 |
| `399006.SZ` | 创业板指 |
| `000688.SH` | 科创50 |

#### `run_daily(func, time='every_bar')`

注册一个在每个交易日开始时执行的函数。用于在 `handle_bar` 之前更新上下文变量（如指数情绪条件）。

```python
def initialize(context):
    context.index_cond = False
    run_daily(update_index_condition, 'every_bar')

def update_index_condition(context):
    closes = get_index_history("000300.SH", 21, "close", strict=True)
    if len(closes) >= 21:
        ma = np.mean(closes[-20:])
        context.index_cond = closes[-1] > ma
```

**说明：**
- `run_daily` 注册的函数在每根K线的 `handle_bar` **之前**执行
- 确保 `handle_bar` 中可以使用最新的条件判断结果
- 多股模式下，以 `update_index_cond_` 开头的函数自动提升为全局函数（每个交易日只执行一次，避免重复计算）

---

## 3. 数据格式

### 3.1 K线数据格式

`get_kline_data()` 返回的 JSON 结构：

```json
{
    "dates": ["2025-01-02", "2025-01-03", "2025-01-06", ...],
    "values": [
        [12.00, 12.50, 11.80, 12.35, 12345678],  // [open, high, low, close, volume]
        [12.36, 12.60, 12.30, 12.45, 9876543],
        ...
    ]
}
```

**values 数组索引：**

| 索引 | 字段 | 说明 |
|------|------|------|
| 0 | open | 开盘价 |
| 1 | high | 最高价 |
| 2 | low | 最低价 |
| 3 | close | 收盘价 |
| 4 | volume | 成交量（股） |

---

### 3.2 回测结果格式

`run_custom_backtest()` 和 `run_multi_backtest()` 返回的 JSON 结构：

```json
{
    "success": true,
    "signals": [
        {
            "date": "2025-03-15",
            "code": "000001",
            "type": "buy",
            "price": 12.35,
            "shares": 800,
            "reason": "金叉买入信号"
        },
        {
            "date": "2025-06-20",
            "code": "000001",
            "type": "sell",
            "price": 13.68,
            "shares": 800,
            "reason": "死叉卖出信号"
        }
    ],
    "equity_curve": [
        {"date": "2025-01-02", "equity": 1000000.00},
        {"date": "2025-01-03", "equity": 1001234.56},
        ...
    ],
    "metrics": {
        "total_return": 23.5,
        "annual_return": 18.2,
        "max_drawdown": -8.5,
        "sharpe_ratio": 1.25,
        "annual_volatility": 15.3,
        "information_ratio": 0.85,
        "win_rate": 55.6,
        "total_trades": 18
    },
    "logs": [
        {"level": "info", "message": "开始回测 000001", "timestamp": "2025-05-20 14:35:21"},
        ...
    ],
    "stock_performance": [         // 仅多股回测
        {
            "code": "000001",
            "name": "平安银行",
            "total_return": 12.3,
            "trade_count": 5,
            "win_rate": 60.0
        },
        ...
    ],
    "errors": [                     // 仅多股回测
        {"code": "000002", "error": "数据不足"},
        ...
    ]
}
```

### 3.3 策略配置格式

策略工厂保存/加载使用的 JSON 格式：

```json
{
    "cards": [
        {
            "id": "c1",
            "type": "ma_cross",
            "action": "buy",
            "params": { "fast": 5, "slow": 20 }
        },
        {
            "id": "c2",
            "type": "ma_cross",
            "action": "sell",
            "params": { "fast": 5, "slow": 20 }
        }
    ],
    "capital": 1000000,
    "startDate": "2025-01-01",
    "endDate": "2025-05-20",
    "stockPool": "000001,000002",
    "slippage": "close",
    "commission": 0.0003,
    "stampTax": 0.001,
    "slippageCostType": "percent",
    "slippageCostValue": 0.1
}
```

---

## 4. 错误码与异常

### 4.1 后端返回结构

所有 Bridge 方法在后端有 `try/except` 包裹。异常时返回：

```json
{
    "success": false,
    "error": "错误描述信息"
}
```

### 4.2 常见错误

| 错误 | 原因 | 解决方法 |
|------|------|----------|
| `KeyError: 'close'` | bar_dict 访问方式错误 | 使用 `bar_dict[stock]['close']` |
| `AttributeError: 'Context' object has no attribute 'xxx'` | context 属性未在 initialize 中设置 | 在 `initialize` 中初始化所有属性 |
| `dict object has no attribute 'positions'` | 用对象属性方式访问 dict | 使用 `context.portfolio.get('holdings', {})` |
| `Zero signals` | 条件过于严格或数据不足 | 放宽参数、检查日期范围 |
| `Bridge 未连接` | WebChannel 连接未建立 | 检查 Python 后端是否正常启动 |
| `保存失败` | 权限问题或 JSON 格式错误 | 检查 `strategies/strategies.json` 权限 |

---

## 5. 技术指标参考

本文档介绍 Tquant 量化工作站中已实现的技术指标，包括其在副图中的展示方式、计算方法、参数设置及典型应用场景。用户可在个股详情页或买卖点成交图页的副图区域切换查看这些指标，辅助交易决策。

### 5.1 成交量 (Volume)

**描述**

成交量反映市场交易活跃程度，通常与价格走势配合分析。副图中红色/绿色柱体分别表示收盘价上涨/下跌；金色柱体表示放量（当日成交量 > 20日均量 × 1.5），深灰色柱体表示缩量（当日成交量 < 20日均量 × 0.6）。

**计算**

- 当日成交量 = 当日成交股数（手）
- 5日、10日均量 = 前 N 日成交量的简单算术平均

**参数**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| MA5周期 | 5 | 5日均量线 |
| MA10周期 | 10 | 10日均量线 |
| 放量倍数 | 1.5 | 超过该倍数标记为放量（金色） |
| 缩量倍数 | 0.6 | 低于该倍数标记为缩量（深灰色） |

**使用建议**

- **价涨量增**：上涨趋势健康。
- **价跌量缩**：下跌动能减弱，可能止跌。
- **放量突破**：关键阻力位放量突破可作买入信号。
- **缩量回调**：上升途中缩量回调可视为加仓机会。

---

### 5.2 MACD (指数平滑异同移动平均线)

**描述**

MACD 由 DIF 线（快线）、DEA 线（慢线）和柱状线（MACD）组成，用于判断趋势方向、强度及转折点。金叉（DIF 上穿 DEA）为买入信号，死叉（DIF 下穿 DEA）为卖出信号。

**计算**

- EMA(12) = 12日指数移动平均
- EMA(26) = 26日指数移动平均
- DIF = EMA(12) - EMA(26)
- DEA = DIF 的 9日指数移动平均
- MACD柱 = (DIF - DEA) × 2

**参数**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 快线周期 | 12 | 短期 EMA 周期 |
| 慢线周期 | 26 | 长期 EMA 周期 |
| 信号线周期 | 9 | DEA 平滑周期 |

**使用建议**

- DIF 与 DEA 均大于 0 且向上：多头趋势。
- 零轴上方金叉：强烈买入信号。
- 顶背离（价格新高，MACD 未新高）：可能见顶。
- 底背离（价格新低，MACD 未新低）：可能见底。

---

### 5.3 RSI (相对强弱指数)

**描述**

RSI 衡量价格涨跌的速度和幅度，范围 0-100。通常 RSI > 70 为超买区，可能回调；RSI < 30 为超卖区，可能反弹。

**计算**

- 计算 N 日内每日收盘价涨幅和跌幅
- 平均涨幅 = 涨幅总和 / N，平均跌幅 = 跌幅总和 / N
- RS = 平均涨幅 / 平均跌幅
- RSI = 100 - 100 / (1 + RS)

**参数**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 周期 | 14 | 计算 RSI 的交易日数 |
| 超买线 | 70 | 高于此线视为超买 |
| 超卖线 | 30 | 低于此线视为超卖 |

**使用建议**

- RSI 进入超卖区后回升：买入信号。
- RSI 进入超买区后回落：卖出信号。
- 与价格背离（价格新高 RSI 未新高）提示反转。

---

### 5.4 KDJ (随机指标)

**描述**

KDJ 通过比较收盘价与一定周期内价格区间的位置，反映超买超卖状态。K 线、D 线、J 线三条曲线，金叉买入，死叉卖出，J 线可超出 0-100 范围。

**计算**

- RSV = (收盘价 - N 日最低) / (N 日最高 - N 日最低) × 100
- K = 前一日 K × (M1-1)/M1 + RSV/M1
- D = 前一日 D × (M2-1)/M2 + K/M2
- J = 3K - 2D

**参数**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| N | 9 | RSV 计算周期 |
| M1 | 3 | K 值平滑周期 |
| M2 | 3 | D 值平滑周期 |

**使用建议**

- K 从下向上穿过 D 且位于低位（<20）：买入信号。
- K 从上向下穿过 D 且位于高位（>80）：卖出信号。
- J 值低于 0 或高于 100 时提示极端超卖/超买。

---

### 5.5 布林带 (Bollinger Bands)

**描述**

布林带由中轨（SMA）、上轨（SMA + k×标准差）、下轨（SMA - k×标准差）组成。价格触及上轨可能超买，触及下轨可能超卖；带宽收缩预示突破。

**计算**

- 中轨 = 收盘价的 N 日简单移动平均
- 标准差 = 样本标准差（ddof=1）
- 上轨 = 中轨 + k × 标准差
- 下轨 = 中轨 - k × 标准差

**参数**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 周期 N | 20 | 中轨周期 |
| 标准差倍数 k | 2 | 通道宽度 |

**使用建议**

- 价格突破上轨且成交量放大：可能强势上涨，但需注意回调风险。
- 价格跌破下轨：可能超跌反弹。
- 带宽极度收窄（挤压）：即将出现大幅波动，准备突破交易。

---

### 5.6 ATR 通道 (Average True Range Channel)

**描述**

ATR 通道基于平均真实波幅构建动态波动区间，中轨为收盘价的 SMA，上下轨为 ± multiplier × ATR。用于识别突破点和止损设置。

**计算**

- 真实波幅 TR = max(高-低, |高-前收|, |低-前收|)
- ATR = TR 的 Wilder 平滑平均（周期 N）
- 中轨 = 收盘价的 N 日简单移动平均
- 上轨 = 中轨 + multiplier × ATR
- 下轨 = 中轨 - multiplier × ATR

**参数**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| ATR 周期 | 14 | 计算 ATR 的周期 |
| 通道倍数 | 2 | 轨道宽度乘数 |
| 中轨周期 | 14 | 中轨 SMA 周期 |

**使用建议**

- 价格突破上轨且 ATR 扩张：趋势强劲，顺势追入。
- 价格跌破下轨：可能反转或加速下跌。
- 通道收窄时适合区间交易，通道扩张时顺势持有。

---

### 5.7 CCI (商品通道指数)

**描述**

CCI 测量价格偏离其统计平均值的程度，用于识别超买超卖和趋势强度。通常 CCI > +100 为超买，CCI < -100 为超卖。

**计算**

- 典型价格 TP = (高 + 低 + 收) / 3
- 计算 TP 的 N 日简单移动平均 TP_MA
- 平均绝对偏差 MD = Σ|TP_i - TP_MA| / N
- CCI = (TP - TP_MA) / (0.015 × MD)

**参数**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 周期 N | 20 | 计算周期 |
| 超买线 | +100 | 高于此线超买 |
| 超卖线 | -100 | 低于此线超卖 |

**使用建议**

- CCI 从下向上穿越 +100：买入信号（强势突破）。
- CCI 从上向下穿越 -100：卖出信号（弱势跌破）。
- CCI 与价格背离时提示反转。

---

### 5.8 威廉指标 (%R)

**描述**

威廉指标 (%R) 衡量收盘价在过去 N 日价格区间中的位置，范围 -100 至 0。%R 接近 -20 为超买，接近 -100 为超卖。与 KDJ 中的 RSV 方向相反。

**计算**

- 最高价 = N 日内最高价
- 最低价 = N 日内最低价
- %R = -100 × (最高价 - 收盘价) / (最高价 - 最低价)

**参数**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 周期 N | 14 | 计算周期 |
| 超买线 | -20 | 高于此线（-20 至 0）为超买 |
| 超卖线 | -80 | 低于此线（-100 至 -80）为超卖 |

**使用建议**

- %R 从超卖区（-100 附近）回升向上穿越 -80：买入信号。
- %R 从超买区（-20 附近）回落向下穿越 -20：卖出信号。
- 与价格背离时同样有效。

---

### 5.9 OBV (能量潮)

**描述**

OBV (On-Balance Volume) 通过累积成交量变化来衡量资金流向。价格上涨时累加当日成交量，价格下跌时减去当日成交量。OBV 线上升表示资金流入，下降表示资金流出。副图中显示 OBV 线（蓝色实线）和 MA20 均线（黄色虚线）。

**计算**

- 当日收盘价 > 前日收盘价：OBV[i] = OBV[i-1] + 成交量[i]
- 当日收盘价 < 前日收盘价：OBV[i] = OBV[i-1] - 成交量[i]
- 当日收盘价 = 前日收盘价：OBV[i] = OBV[i-1]
- OBV_MA20 = OBV 的 20 日简单移动平均

**参数**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 均线周期 | 20 | OBV 均线平滑周期 |

**使用建议**

- OBV 上穿 MA20：金叉买入信号。
- OBV 创新高而价格未创新高：顶背离，可能反转下跌。
- OBV 创新低而价格未创新低：底背离，可能反转上涨。

---

### 5.10 ROC (变动率)

**描述**

ROC (Rate of Change) 衡量当前收盘价相对于 N 日前收盘价的变动百分比。正数表示价格上涨，负数表示价格下跌。副图中显示 ROC 线（蓝色实线）和零轴参考线（灰色虚线）。

**计算**

- ROC = (当日收盘价 - N 日前收盘价) / N 日前收盘价 × 100%

**参数**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 周期 N | 12 | 比较的交易日数 |

**使用建议**

- ROC 从下向上穿越零轴：买入信号，价格加速上涨。
- ROC 从上向下穿越零轴：卖出信号，价格加速下跌。
- ROC 与价格背离时提示趋势反转。
- ROC 绝对值越大，价格变动越剧烈。

---

### 5.11 SAR (抛物线转向)

**描述**

SAR (Stop and Reverse) 是趋势跟踪型叠加指标，以金色圆点直接标记在 K 线主图上。当 SAR 点位于 K 线下方时为上升趋势，位于 K 线上方时为下降趋势。SAR 具有加速因子，随趋势延续逐步靠近价格，最终触发反转。

**计算**

- 上升趋势：SAR = 前一日 SAR + AF × (EP - 前一日 SAR)
- 下降趋势：SAR = 前一日 SAR + AF × (EP - 前一日 SAR)
- EP (极值点)：上升趋势中为最高价最大值，下降趋势中为最低价最小值
- AF (加速因子)：初始 0.02，每次 EP 创新高/新低时增加 0.02，最大 0.2
- SAR 值受前两日最低价（上升时）或最高价（下降时）约束
- 当价格突破 SAR 时，SAR 反转方向并重置 AF

**参数**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 初始 AF | 0.02 | 加速因子起始值 |
| 最大 AF | 0.2 | 加速因子上限 |

**使用建议**

- 收盘价从下方上穿 SAR：转向买入信号。
- 收盘价从上方下穿 SAR：转向卖出信号。
- SAR 适用于趋势行情，震荡市中容易频繁假突破。
- SAR 可配合控制面板复选框切换显示/隐藏。

---

### 5.12 趋势强度 (Trend Strength)

**描述**

趋势强度是综合型副图指标，提取自通达信中无需成本分布数据的计算部分，通过加权均线、压力支撑线和交叉信号多维度呈现趋势状态。副图中显示橙色加权均值线、青色压力虚线、绿色支撑虚线，并以散点标记短底信号（蓝色▲）和金手指信号（金色▼）。

**计算**

- **加权移动平均线**：21 周期线性加权移动平均（`weightedSMA`），最后一天权重最高，反应更灵敏于普通 SMA。
- **压力/支撑线**：20 日最高价（`HHV(H,20)`）作为压力线，20 日最低价（`LLV(L,20)`）作为支撑线。
- **短底信号**：基于 168 日最低价和 21 日最高价的归一化指标 R = (Close - LLV(L,168)) / (HHV(H,21) - LLV(L,168)) × 100，计算 EMA(R,5) 与 EMA(0.5×R,13)，当 EMA5 上穿 EMA13 时触发信号。
- **金手指信号**：MA20 上穿 MA120（20 日均线上穿 120 日均线），表示中长期趋势转强。

**参数**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 加权周期 | 21 | 加权移动平均的计算周期 |
| 压力支撑周期 | 20 | HHV/LLV 的滚动窗口 |
| 短底长周期 | 168 | 最低价参考的最长周期 |
| 短底短周期 | 21 | 最高价参考的短周期 |
| 金手指快线 | 20 | MA20 上穿判断 |
| 金手指慢线 | 120 | MA120 被上穿判断 |

**使用建议**

- 价格运行在加权均线上方且均线向上：趋势偏多。
- 价格触及压力线（H20）后回落：短期可能承压，考虑减仓。
- 价格触及支撑线（L20）后反弹：短期可能有支撑，关注买入。
- 蓝色▲短底信号出现：底部反转概率增大，可结合成交量确认。
- 金色▼金手指信号出现（MA20 上穿 MA120）：中长期趋势由弱转强，重要的趋势确认信号。
- 多种信号同时共振时，可靠性更高。

---

### 附：策略工厂卡片与指标对照表

策略工厂中的卡片类型大多基于上述指标，用户可通过卡片参数调整阈值构建交易策略：

| 策略卡片 | 对应指标 | 副图显示 |
|----------|----------|----------|
| 成交量放大 | 成交量 | 成交量柱状图 |
| RSI超买超卖 | RSI | RSI 线 + 超买/超卖线 |
| MACD交叉 | MACD | DIF/DEA 线 + 柱状图 |
| 布林带突破 | 布林带 | 布林带通道 |
| ATR通道突破 | ATR 通道 | ATR 通道 |
| CCI超买超卖 | CCI | CCI 线 + ±100 线 |
| KDJ交叉 | KDJ | K/D/J 线 |
| 威廉指标 (%R) | 威廉指标 | %R 线 + -20/-80 线 |
| OBV 能量潮 | OBV | OBV 线 + MA20 均线 |
| ROC 变动率 | ROC | ROC 线 + 零轴 |
| SAR 抛物线转向 | SAR | K线主图金色散点叠加 |
| 趋势强度 | 趋势强度 | 加权均值线 + 压力/支撑线 + 短底/金手指信号 |
| PE 低于 | PE(TTM) | — |
| PB 低于 | PB | — |
| ROE 高于 | ROE | — |

---

### 更新日志

| 日期 | 版本 | 更新内容 |
|------|------|----------|
| 2026-06-07 | 1.6 | 回测 API 改为异步轮询模式（`{success, job_id}`）；新增 `get_backtest_progress` / `get_backtest_result` / `cancel_backtest` / `cleanup_backtest` 四个 API；实时策略引擎重写为 asyncio + aiohttp |
| 2026-05-30 | 1.5 | 新增「指数情绪」卡片类型和 `get_index_history` / `run_daily` 策略 API；支持基于大盘指数技术指标的市场情绪判断 |
| 2026-05-25 | 1.3 | `run_compare_backtest` 新增 `stock_pool` 参数，支持多股组合对比回测（共享资金池）；对比回测弹窗改为多股输入 |
| 2026-05-24 | 1.2 | 新增 `get_stock_financial`、`screen_stocks`、`test_evaluate_stock`、`get_latest_trading_date` API；新增 PE/PB/ROE 财务卡片 |
| 2026-05-28 | 1.4 | 新增趋势强度指标说明（加权均值、压力支撑、短底、金手指） |
| 2026-05-23 | 1.1 | 新增 OBV、ROC、SAR 三个指标说明 |
| 2026-05-23 | 1.0 | 初始版本，包含 8 个核心指标说明 |

---

## 6. 指数情绪卡片

### 6.1 概述

指数情绪（`index_sentiment`）是一种特殊的策略卡片类型，不直接产生交易信号，而是作为买卖信号的辅助条件。用户选择一个指数（如沪深300），基于该指数的技术指标产生布尔值，控制后续买入/卖出卡片是否执行。

**关键特性：**
- 不产生交易信号（`action = null`），仅作为条件判断
- 基于截至**上一交易日**的数据计算（严格模式，避免未来函数）
- 多个指数情绪卡片使用 **OR 逻辑**（任一满足即允许交易）
- 通过 `run_daily` 机制在每个交易日开始时更新条件

### 6.2 可用指标

| 指标 key | 说明 | 关键参数 |
|----------|------|----------|
| `close_above_ma` | 收盘价 > 均线 | `ma_period`（默认 20） |
| `close_below_ma` | 收盘价 < 均线 | `ma_period`（默认 20） |
| `rsi_above` | RSI 大于阈值 | `rsi_period`（默认 14），`rsi_threshold`（默认 70） |
| `rsi_below` | RSI 小于阈值 | `rsi_period`（默认 14），`rsi_threshold`（默认 70） |
| `macd_golden` | MACD 金叉（DIF 上穿 DEA） | — |
| `macd_death` | MACD 死叉（DIF 下穿 DEA） | — |
| `volume_ratio` | 成交量比率大于倍率 | `volume_ratio_period`（默认 20），`volume_ratio_threshold`（默认 1.5） |

### 6.3 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `index_code` | select | `000300.SH` | 基准指数代码 |
| `indicator` | select | `close_above_ma` | 使用的技术指标 |
| `ma_period` | number | 20 | 均线周期（5-250） |
| `rsi_period` | number | 14 | RSI 计算周期（5-30） |
| `rsi_threshold` | number | 70 | RSI 阈值（0-100） |
| `volume_ratio_period` | number | 20 | 成交量均线周期（5-60） |
| `volume_ratio_threshold` | number | 1.5 | 成交量倍率（1.0-10.0） |
| `strict_mode` | boolean | true | 严格模式：使用前一日数据，避免未来函数 |

### 6.4 使用示例

**场景：** 仅当沪深300收盘价高于20日均线时才允许买入。

1. 在策略工厂中点击「+ 添加条件」
2. 选择「指数情绪」卡片
3. 参数配置：
   - 指数：沪深300
   - 指标：收盘价 > 均线
   - 均线周期：20
   - 严格模式：勾选
4. 添加买入条件卡片（如 MA 金叉）

生成的策略代码会包含 `run_daily` 函数，在每个交易日开始时自动计算指数条件，并将其注入到买卖信号的 AND 条件中。

### 6.5 策略配置格式

指数情绪卡片在策略 JSON 中的格式：

```json
{
    "id": "card_xxx",
    "type": "index_sentiment",
    "action": null,
    "params": {
        "index_code": "000300.SH",
        "indicator": "close_above_ma",
        "ma_period": 20,
        "strict_mode": true
    }
}
```