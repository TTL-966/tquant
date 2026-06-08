# Tquant 开发者文档

## 目录

- [1. 架构概览](#1-架构概览)
- [2. 后端模块详解](#2-后端模块详解)
- [3. 前端模块详解](#3-前端模块详解)
- [4. 数据库表结构](#4-数据库表结构)
- [5. 通信机制](#5-通信机制)
- [6. 如何扩展](#6-如何扩展)
- [7. 打包与发布](#7-打包与发布)
- [8. 测试方法](#8-测试方法)

---

## 1. 架构概览

```
┌────────────────────────────────────────────────────────────┐
│                    PySide6 MainWindow                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  QWebEngineView                       │  │
│  │  ┌──────────────────────────────────────────────┐    │  │
│  │  │           Tquant.html (SPA)                   │    │  │
│  │  │  ┌──────────────────────────────────────┐    │    │  │
│  │  │  │         JavaScript Modules            │    │    │  │
│  │  │  │  bridge.js ←→ Qt WebChannel ←→ Python │    │    │  │
│  │  │  │  navigation.js (Page Router)          │    │    │  │
│  │  │  │  strategyBuilder.js / codeEditor.js   │    │    │  │
│  │  │  │  chartRenderer.js (ECharts)           │    │    │  │
│  │  │  │  logger.js / profile.js / ...         │    │    │  │
│  │  │  └──────────────────────────────────────┘    │    │  │
│  │  └──────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↕ QWebChannel                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │               app/web_bridge.py (@Slot API)           │  │
│  └──────────────────────┬───────────────────────────────┘  │
│                         ↕                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  backend/ (Python)                    │  │
│  │  db.py  data_feed.py  backtest_executor.py           │  │
│  │  multi_backtest_executor.py  report_exporter.py      │  │
│  │  realtime_strategy_engine.py  strategy_engine.py     │  │
│  │  multi_realtime_strategy_engine.py  stock_screener.py│  │
│  │  trade_simulation.py  fund_flow_fetcher.py           │  │
│  │  realtime_quote_fetcher.py  realtime_config.py       │  │
│  │  data_updater/                                       │  │
│  └──────────────────────┬───────────────────────────────┘  │
│                         ↕                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              tquant.db (SQLite)                       │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**分层设计原则：**
- `app/` — 桌面窗口、WebChannel 桥接，不包含业务逻辑
- `backend/` — 纯业务逻辑，可独立运行
- `js/` — 前端 UI，通过 Bridge 调用后端
- `web/` — Web 版前端文件（可选）

---

## 2. 后端模块详解

### 2.1 `backend/db.py` — 数据库层

**类：** `Database`

使用 SQLAlchemy 连接 SQLite。在实例化时自动调用 `_init_tables()` 建表。

**关键方法：**
- `_get_stock_suffix(code)`：根据代码前缀（6/9 → SH, 0/3 → SZ, 8 → BJ）附加交易所后缀
- `get_kline(code, start, end, limit)`：查询日线数据，使用二分搜索做日期范围过滤
- `search_stock(keyword)`：在 `stock_basic` 表中 LIKE 搜索
- `get_index_stocks(index_code)`：查询指数成分股

**注意事项：**
- 数据库路径为项目根目录的 `tquant.db`，硬编码在构造函数中
- `_generate_mock_data()` 在无数据时生成随机模拟数据用于开发调试

---

### 2.2 `backend/data_feed.py` — 数据供应层

**类：** `DataFeed`

在 Database 之上增加了**内存缓存**和**周期聚合**能力。

**关键方法：**
- `get_kline_json(code, start, end, limit, period)`：主数据接口，返回 JSON。首次查询将全部历史加载到内存缓存，后续查询用二分查找做日期切片
- `_aggregate_to_period(df, period)`：将日线聚合成周线/月线（使用 pandas resample）
- `get_realtime_price(code)`：调用腾讯 API 获取实时价格，失败时回退到缓存最后收盘价
- `get_latest_price(code)`：从缓存获取最近交易日的收盘价

**缓存策略：**
- 类级别字典 `_kline_cache = {}`，键为纯数字代码
- 首次查询某股票时全量加载，后续仅做切片
- **无过期机制**（如需要可添加 TTL）

---

### 2.3 `backend/backtest_worker.py` — 回测工作线程 <span style="color:#4f7eff">NEW v1.5.0</span>

**类：** `BacktestWorker(QThread)`

QThread 子类，在后台线程中运行回测，通过 Qt 信号报告进度和结果。支持三种模式：`single`（单股）、`multi`（多股组合）、`compare`（多策略变体对比）。

**信号：**
- `progress(int current, int total)` — 每完成一个 bar/日期触发
- `finished(dict result)` — 回测完成时触发，携带完整结果

**关键方法：**
- `run()` — QThread 入口，根据 `params["mode"]` 分发到 `_run_single` / `_run_multi` / `_run_compare`
- `cancel()` — 设置 `_cancelled` 标志 + 调用 `requestInterruption()`

**对比回测（_run_compare）：** 在 QThread 内部使用 `ThreadPoolExecutor`（最多 5 线程）并行执行多个策略变体。

---

### 2.4 `backend/backtest_job_manager.py` — 回测任务管理器 <span style="color:#4f7eff">NEW v1.5.0</span>

**类：** `BacktestJobManager(QObject)`

管理活跃的回测任务，提供线程安全的进度/结果访问。

**生命周期：**
1. `start_job(worker, job_id)` → 注册并启动工作线程
2. `get_progress(job_id)` → JS 轮询进度 `{status, current, total}`
3. `get_result(job_id)` → 获取缓存结果
4. `cleanup_job(job_id)` → 释放内存
5. `cancel_job(job_id)` → 请求取消
6. `cancel_all()` → 应用关闭时取消所有任务

**信号：** `job_finished(str job_id)` — 任务完成通知。

---

### 2.5 `backend/async_quote_fetcher.py` — 异步行情获取器 <span style="color:#4f7eff">NEW v1.5.0</span>

**类：** `AsyncQuoteFetcher`

基于 aiohttp 的异步行情获取器，用于实时策略引擎。

**特性：**
- `asyncio.Semaphore(20)` 限制并发请求数
- `aiohttp.ClientSession` 连接池复用（50 总连接，20 同主机）
- DNS 缓存（300s TTL）
- 腾讯财经批量接口（最多 50 只/次）
- 新浪财经兜底（单只补获取缺失的）
- 单请求超时 3s

---

### 2.6 `backend/backtest_executor.py` — 单股回测引擎

**类：** `BacktestExecutor`

沙箱化的策略执行环境。

**核心流程：**
```
run(user_code, stock_code, start, end, ...)
  → 从 DataFeed 获取 K 线数据
  → 检查股票上市/退市状态，过滤有效区间
  → 数据完整性检查（直接查询 DB 中的实际交易日数量）
      - 若不足 max(10, 日历天数×20%) 天 → 返回错误，提示更新数据
  → compile() + exec() 用户代码
  → 调用 initialize(context)
  → 逐 bar 循环：
      - 更新 bar_dict
      - 调用 handle_bar(context, bar_dict)
      - 调用 run_daily 回调
      - 计算当日权益
  → _compute_metrics() 计算绩效指标
  → 返回 {success, signals, equity_curve, metrics, logs}
```

**数据完整性检查：** 绕过 `get_kline` 的 mock 降级逻辑，直接使用 `pd.read_sql` 查询 `stock_daily_qfq_with_name` 表中的实际交易日数量。若数据不足，明确报错而非静默使用模拟数据。

**沙箱 API 注入（_build_sandbox）：**
- `history_bars(security, count, unit, field)` → numpy 数组
- `attribute_history(security, count, fields)` → pandas DataFrame
- `order_target_percent(security, percent)` → 目标仓位比例
- `order_target_value(security, value)` → 目标市值
- `get_current_data(security)` → 当前 bar OHLCV
- `log.info/warn/error/debug(msg)` → 日志记录

**风控模拟：**
- 佣金：按成交金额比例收取（默认 0.03%）
- 印花税：卖出时收取（默认 0.1%）
- 滑点：支持三种模式（close / next_open / half_spread）
- 股票取整：数量自动取整到 100 股

---

### 2.4 `backend/multi_backtest_executor.py` — 多股组合回测

**类：** `MultiBacktestExecutor`、`StockHandler`

**与单股回测的关键差异：**

| 特性 | 单股回测 | 多股回测 |
|------|----------|----------|
| 数据对齐 | 单只股票 | 所有股票日期交集 |
| 订单执行 | 立即执行 | 巴内收集，先卖后买 |
| 资金共享 | N/A | 共享资金池 |
| 绩效 | 全局指标 | 全局 + 每只股票独立 |

**订单执行顺序（每个 bar 内）：**
1. 所有股票的 `handle_bar` 调用 → 订单入队 `_pending_orders`
2. 先执行所有卖出订单（释放现金）
3. 再执行所有买入订单（检查现金是否充足）
4. 更新共享的 `shared_context`

---

### 2.5 `backend/data_updater/` — 数据更新子系统

**BaseUpdater：** 抽象基类，提供 `needs_update()`、`run()`、`_safe_run()` 接口和日志方法。

**DailyKlineUpdater：** 生产环境日线增量更新器。
- 文件锁防止并发
- 增量更新：仅下载缺失日期
- 连续失败 3 次的股票自动跳过 30 天
- 记录到 `stock_update_fail` 表

**DataUpdateScheduler：** QTimer 定时调度器。
- 每日 18:00 检查日线是否需要更新
- 每 6 小时检查财务数据是否需要更新
- 启动后 5 秒执行首次检查
- `trigger_manual_update()` 支持手动触发
- `trigger_financial_update()` 支持手动触发财务更新
- Qt 信号：`update_started`、`update_finished`

**FinancialUpdaterBaostock：** 财务数据增量更新器。
- 使用 Baostock `query_history_k_data_plus` 获取 PE(TTM)/PB
- 使用 Baostock `query_profit_data` 获取 ROE/净利润/营收/流通股本
- 仅更新近一年有交易的活跃股票（过滤退市股）
- 90 天过期或新股触发更新
- 更新完成后自动基于本地收盘价 × 流通股本计算总市值
- 在独立子进程中运行，避免 baostock/QtWebEngine 冲突

---

### 2.7 实时策略引擎 <span style="color:#4f7eff">v1.5.0 重写</span>

> **v1.5.0 架构变更：** 从 `threading.Thread` + 阻塞 `requests` 重写为 `asyncio + aiohttp`。专用守护线程运行 asyncio 事件循环。`stop()` 从阻塞 `join(timeout=10)` 改为非阻塞（0ms 返回）。

**`realtime_strategy_engine.py` — 单股实时策略引擎（asyncio）**
- 专用 asyncio 事件循环在守护线程中运行
- `AsyncQuoteFetcher` 异步获取行情
- `asyncio.Event` 替代 `threading.Event` 实现优雅退出
- `stop()` 通过 `loop.call_soon_threadsafe` 触发停止，不阻塞 UI
- 与回测引擎共享相同的沙箱 API（`history_bars`、`order_target_percent` 等）

**`multi_realtime_strategy_engine.py` — 多股实时策略引擎（asyncio）**
- 同上 asyncio 架构，支持 200+ 股票
- 共享资金池，每只股票独立策略上下文（`handle_bar` + `stock_context`）
- 并发行情获取：`asyncio.gather` + `Semaphore(20)` 批量获取（腾讯 50 只/批 + 新浪兜底）
- 订单收集-执行模式：所有股票策略执行完毕后，先卖后买
- T+1 交易规则：记录当天买入股数，跨日自动清空
- 线程安全：`_state_lock` 保护 signals/logs 跨线程读写
- `TradeSimulation` 访问通过 `asyncio.to_thread()` / `run_in_executor` 避免阻塞

**`async_quote_fetcher.py` — 异步行情获取器** <span style="color:#4f7eff">NEW v1.5.0</span>
- aiohttp + Semaphore(20) 异步并发获取
- ClientSession 连接池复用（50 连接，20 同主机，DNS 缓存 300s）
- 腾讯财经 → 新浪财经双源降级
- 单请求超时 3s

**`realtime_quote_fetcher.py` — 实时行情获取器（同步版）**
- ThreadPoolExecutor 并发获取（用于前端 `get_realtime_quotes` 一次性查询）
- 腾讯财经 API（主源）+ 新浪财经 API（备用源）双源容错

**`realtime_config.py` — 实时策略配置持久化**
- JSON 文件存储当前运行的策略参数
- 应用恢复时自动读取，弹窗询问用户是否继续运行

**`fund_flow_fetcher.py` — 资金流向获取器**
- 东方财富 API（主源，curl_cffi / requests）+ 同花顺页面抓取（备用源，正则解析）
- 内建缓存（默认 60 秒 TTL），支持单股和批量获取
- 批量获取按缓存命中/未命中分离处理，控制并发和提交间隔

### 2.7 其他后端模块

| 模块 | 说明 |
|------|------|
| `strategy_engine.py` | 内置 MA5/MA20 策略，返回买卖信号和 MA 数据 |
| `strategy_storage.py` | JSON 文件 CRUD，存储在 `strategies/strategies.json` |
| `trade_simulation.py` | 简单模拟交易引擎，管理现金、持仓、交易历史 |
| `report_exporter.py` | Excel(xlsxwriter) 和 PDF(reportlab+matplotlib) 报告导出，读取 `equityCurve`/`stockPerformance`（camelCase）；`web_bridge.py` 的 `export_report` 已内置 snake_case 兼容转换 |
| `industry.py` | Baostock 行业分类数据下载和查询 |
| `stock_screener.py` | 批量条件选股引擎，支持技术指标 + 财务指标 + 资金流向 AND 组合筛选，含 12 种批量评估器 |
| `sync_new_stocks.py` | 从 Baostock 同步最新 A 股列表到 `stock_basic` |
| `everydaystock.py` | 每日增量更新专用脚本，含数据完整性检查和自动修复 |

### 2.8 对比回测扩展

**`run_compare_backtest()`（web_bridge.py）：**
- 接收包含 `variations` 数组的参数，每个变体含 `name` 和 `code`
- 使用 `ThreadPoolExecutor(max_workers=5)` 并行执行各变体
- 返回 `{results: [{name, metrics, equity_curve, signals}], errors: [{name, error}]}`

**`save_text_file()`（web_bridge.py）：**
- 弹出 `QFileDialog.getSaveFileName` 原生保存对话框
- 支持 .txt / .py / 所有文件过滤器

**前端流程（compareStrategy.js + compareView.js）：**
1. `extractCardParams(cards)` — 从 `CARD_TYPE_META` 提取数值参数
2. `generateVariantCode(variant, cards, stockCode)` — 克隆卡片、覆盖参数、调用 `generateCode()`
3. `showCompareBacktestModal(...)` — 渲染弹窗 UI
4. `renderCompareView(container, result)` — 渲染对比结果（三标签页），内含「导出报告」按钮，依赖 `bridge` 导入和本地 `showToast` 函数

---

## 3. 前端模块详解

### 3.1 模块依赖图

```
main.js (入口、全局状态)
  ├── bridge.js (Qt WebChannel 客户端)
  ├── navigation.js (页面路由、11个页面)
  │     ├── chartRenderer.js (K线图渲染)
  │     ├── SubChartManager.js (多副图指标管理)
  │     ├── subChartRenderer.js (成交量副图)
  │     ├── indicators.js (技术指标计算)
  │     ├── kline.js (K线数据获取)
  │     ├── strategyBuilder.js (策略工厂)
  │     │     ├── strategyTemplates.js (卡片类型)
  │     │     ├── strategyUtils.js (代码生成)
  │     │     ├── compareStrategy.js (对比回测弹窗)
  │     │     └── logger.js (日志)
  │     ├── codeEditor.js (代码编辑器)
  │     │     └── logger.js (日志)
  │     ├── compareView.js (对比回测结果渲染)
  │     ├── profile.js (个人中心)
  │     ├── realtimeSim.js (多股实时模拟交易)
  │     ├── stockScreener.js (条件选股页面)
  │     └── troubleshoot.js (故障排查)
  ├── datepicker.js (自定义日期选择器)
  ├── suggestions.js (搜索建议)
  └── stockData.js (股票静态数据)
```

### 3.2 页面路由

`navigation.js` 中的 `loadPage(pageId)` 是核心路由函数。路由表：

| pageId | 渲染函数 | 模块 |
|--------|----------|------|
| profile | renderProfile | profile.js |
| realtime | renderRealtimeSimPage | realtimeSim.js |
| kchart | renderKchartPage | navigation.js |
| stock | renderStockPage | navigation.js |
| history | renderHistoryPage | navigation.js |
| strategy | renderStrategyPage | strategyBuilder.js |
| stockScreener | renderStockScreenerPage | stockScreener.js |
| codeEditor | renderCodeEditorPage | codeEditor.js |
| detail | renderDetailPage / renderBacktestDetail（含对比回测结果渲染） | navigation.js / compareView.js |
| api | renderApiPage | navigation.js |
| settings | renderSettingsPage | navigation.js |
| troubleshoot | renderTroubleshootPage | troubleshoot.js |

### 3.3 全局状态（window 对象）

| 变量 | 说明 |
|------|------|
| `window._lastBacktestResult` | 最近一次回测的完整结果 |
| `window._lastCompareResult` | 最近一次对比回测的结果（含多个变体） |
| `window.strategySignals` | 当前回测的交易信号 |
| `window.topPositionCodes` | 多股回测中收益最高的股票 |
| `window.currentStrategyCode` | 当前策略 Python 代码 |
| `window.currentStrategyName` | 当前策略名称 |
| `window._initialCapital` | 初始资金 |
| `window._slippageMode` | 成交价模式 |
| `currentStockCode` | 当前查看的股票代码 |

### 3.4 Logger 组件（`logger.js`）

可复用的日志组件。两个页面各有一个独立实例。

**用法：**
```javascript
import { Logger } from './logger.js';

// 在页面渲染函数中：
var logger = new Logger('logBoxId', 'logToolbarId', { maxEntries: 500 });
logger.init();  // 渲染工具栏、绑定事件

// 添加日志
logger.addLog('info', '开始回测');
logger.addLog('warn', '数据不足');
logger.addLog('error', '执行失败');
logger.addLog('success', '回测完成');

// 导出
logger.exportLog();  // 下载 txt 文件

// 清空
logger.clearLog();  // 清空数组 + DOM，重置筛选按钮
```

---

## 4. 数据库表结构

### 4.1 `stock_daily_qfq_with_name`（日线数据）

```sql
CREATE TABLE IF NOT EXISTS stock_daily_qfq_with_name (
    ts_code   TEXT,       -- '000001.SZ'
    name      TEXT,       -- '平安银行'
    trade_date TEXT,      -- '2025-05-20'
    open      REAL,
    high      REAL,
    low       REAL,
    close     REAL,
    vol       INTEGER,    -- 成交量（股）
    amount    REAL,       -- 成交额（元）
    PRIMARY KEY (ts_code, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_ts_code_trade_date ON stock_daily_qfq_with_name(ts_code, trade_date);
```

### 4.2 `stock_basic`（股票列表）

```sql
CREATE TABLE IF NOT EXISTS stock_basic (
    code TEXT PRIMARY KEY,  -- '000001' (纯数字)
    name TEXT               -- '平安银行'
);
```

### 4.3 `stock_industry`（行业分类）

```sql
CREATE TABLE IF NOT EXISTS stock_industry (
    ts_code                TEXT PRIMARY KEY,  -- '000001.SZ'
    stock_name             TEXT,
    industry               TEXT,
    industry_classification TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_industry_industry ON stock_industry(industry);
```

### 4.4 `index_components`（指数成分股）

```sql
CREATE TABLE IF NOT EXISTS index_components (
    index_code  TEXT,  -- '000300.XSHG'
    stock_code  TEXT,
    update_date TEXT,
    PRIMARY KEY (index_code, stock_code)
);
```

### 4.5 `stock_update_fail`（更新失败记录）

```sql
CREATE TABLE IF NOT EXISTS stock_update_fail (
    code           TEXT PRIMARY KEY,
    fail_count     INTEGER DEFAULT 0,
    last_fail_date TEXT,
    skip_until     TEXT   -- 跳过直到此日期，NULL 表示不跳过
);
```

### 4.6 `stock_financial`（最新财务数据）

```sql
CREATE TABLE IF NOT EXISTS stock_financial (
    ts_code      TEXT PRIMARY KEY,  -- '000001.SZ'
    pe_ttm       REAL,              -- 市盈率（TTM）
    pb           REAL,              -- 市净率
    roe          REAL,              -- 净资产收益率（%）
    total_mv     REAL,              -- 总市值（亿元，基于收盘价×流通股本计算）
    revenue      REAL,              -- 营业收入（亿元）
    net_profit   REAL,              -- 净利润（亿元）
    float_shares REAL,              -- 流通股本（亿股）
    update_date  TEXT               -- 数据更新日期
);
CREATE INDEX IF NOT EXISTS idx_financial_pe ON stock_financial(pe_ttm);
CREATE INDEX IF NOT EXISTS idx_financial_pb ON stock_financial(pb);
CREATE INDEX IF NOT EXISTS idx_financial_roe ON stock_financial(roe);
```

### 4.7 `stock_financial_history`（历史财务数据）

```sql
CREATE TABLE IF NOT EXISTS stock_financial_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_code     TEXT NOT NULL,       -- '000001.SZ'
    report_date TEXT NOT NULL,       -- 报告期 '2025-12-31'
    pe_ttm      REAL,
    pb          REAL,
    roe         REAL,
    total_mv    REAL,
    revenue     REAL,
    net_profit  REAL,
    update_date TEXT,
    UNIQUE(ts_code, report_date)
);
CREATE INDEX IF NOT EXISTS idx_history_ts_date ON stock_financial_history(ts_code, report_date);
```

### 4.8 `stock_industry_detail`（行业分类详情）

```sql
CREATE TABLE IF NOT EXISTS stock_industry_detail (
    ts_code            TEXT PRIMARY KEY,
    stock_name         TEXT,
    industry_level1    TEXT,         -- 一级行业
    industry_level2    TEXT,         -- 二级行业
    industry_level3    TEXT,         -- 三级行业
    concept_sectors    TEXT,         -- 概念板块（逗号分隔）
    update_date        TEXT
);
CREATE INDEX IF NOT EXISTS idx_industry_l1 ON stock_industry_detail(industry_level1);
CREATE INDEX IF NOT EXISTS idx_industry_l2 ON stock_industry_detail(industry_level2);
```

### 4.9 `concept`（概念板块）

```sql
CREATE TABLE IF NOT EXISTS concept (
    concept_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    concept_name TEXT UNIQUE NOT NULL
);
```

### 4.10 `stock_concept`（股票-概念关联）

```sql
CREATE TABLE IF NOT EXISTS stock_concept (
    ts_code    TEXT NOT NULL,
    concept_id INTEGER NOT NULL,
    PRIMARY KEY (ts_code, concept_id),
    FOREIGN KEY (concept_id) REFERENCES concept(concept_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_concept_code ON stock_concept(ts_code);
```

### 4.11 `backtest_history`（回测历史记录）

```sql
CREATE TABLE IF NOT EXISTS backtest_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_name   TEXT,
    stock_pool      TEXT,         -- JSON 数组
    start_date      TEXT,
    end_date        TEXT,
    initial_cash    REAL,
    metrics         TEXT,         -- JSON 对象
    signals         TEXT,         -- JSON 数组
    equity_curve    TEXT,         -- JSON 数组
    stock_performance TEXT,       -- JSON 数组
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### 4.12 `fund_flow_history`（资金流向历史）

```sql
CREATE TABLE IF NOT EXISTS fund_flow_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_code     TEXT NOT NULL,       -- '000001.SZ'
    trade_date  TEXT NOT NULL,       -- '2026-05-29'
    main_net    REAL,                -- 主力净流入（万元）
    super_net   REAL,                -- 超大单净流入
    big_net     REAL,                -- 大单净流入
    medium_net  REAL,                -- 中单净流入
    small_net   REAL,                -- 小单净流入
    update_time TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ts_code, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_ff_ts_date ON fund_flow_history(ts_code, trade_date);
```

### 4.13 `strategies.json`（策略持久化）

```json
[
    {
        "id": 1,
        "name": "双均线策略",
        "code": "import numpy as np\n\ndef initialize(context):\n    ..."
    }
]
```

---

## 5. 通信机制

### 5.1 Qt WebChannel

```
┌──────────┐  QWebChannel   ┌──────────────┐
│ Python   │ ←──────────→ │ JavaScript   │
│ @Slot    │   JSON str     │ bridge.fn()  │
└──────────┘                └──────────────┘
```

- **Python → JS**：方法返回值自动序列化为字符串（JSON）
- **JS → Python**：调用 `bridge.method(...)` 返回 Promise
- **传输层**：Qt 内置的 `qt.webChannelTransport`，无需额外配置

### 5.2 调用示例

```javascript
// JS 侧调用 Python
bridge.get_kline_data("000001", "2025-01-01", "", 0, "daily")
    .then(function(json) {
        var data = JSON.parse(json);
        // 使用数据渲染图表
    })
    .catch(function(err) {
        console.error("Bridge call failed:", err);
    });
```

```python
# Python 侧定义
class WebBridge(QObject):
    @Slot(str, str, str, int, str, result=str)
    def get_kline_data(self, code, start_date, end_date, limit, period):
        return data_feed.get_kline_json(code, start_date, end_date, limit, period)
```

---

## 6. 如何扩展

### 6.1 添加新的策略卡片类型

1. **定义卡片元数据**（`js/strategyTemplates.js`）：
   ```javascript
   // 在 CARD_TYPE_META 中添加
   my_indicator: {
       type: 'my_indicator',
       label: '我的指标',
       icon: '📊',
       description: '指标描述',
       defaultAction: 'buy',
       defaultParams: { period: 14, threshold: 50 },
       paramFields: [
           { key: 'period', label: '周期', type: 'number', min: 1, max: 100, default: 14 },
           { key: 'threshold', label: '阈值', type: 'number', min: 0, max: 100, default: 50 }
       ]
   }
   ```

2. **添加代码生成器**（`js/strategyUtils.js`）：
   ```javascript
   function genMyIndicator(card, idx) {
       var p = card.params;
       var periodP = ctxParam(idx, 'period');
       var thresP = ctxParam(idx, 'threshold');
       var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
       var close = contextName(idx, 'close');
       var lines = [];
       lines.push('# Card ' + idx + ': 我的指标');
       lines.push(close + ' = history_bars(stock, ' + periodP + ', \'1d\', \'close\')');
       lines.push('if len(' + close + ') < ' + periodP + ':');
       lines.push('    ' + sigVar + '.append(False)');
       lines.push('else:');
       lines.push('    ' + contextName(idx, 'val') + ' = indicator_func(stock, ' + periodP + ')');
       lines.push('    ' + sigVar + '.append(' + contextName(idx, 'val') + ' > ' + thresP + ')');
       var reason = '我的指标' + (card.action === 'buy' ? '买入' : '卖出');
       return { code: lines, cond: '', reason: reason };
   }
   ```

3. **注册到 switch 分支**（`js/strategyUtils.js` 的 `generateCode` 函数）：
   ```javascript
   case 'my_indicator': genResult = genMyIndicator(card, i); break;
   ```

4. **添加到卡片选择器**（`js/strategyBuilder.js` 的 `typeKeys` 数组）：
   ```javascript
   var typeKeys = [..., 'my_indicator', ...];
   ```

**注意：** 财务指标卡片（pe_below、pb_below、roe_above）不需要 `history_bars` 调用，仅需设置 `_get_needed_bars` 返回 1 并直接从 `stock_financial` 表查找数据即可。参考 `backend/stock_screener.py` 中的 `_batch_pe_below` 等方法。

### 6.2 添加新的 Bridge API

1. 在 `app/web_bridge.py` 中添加方法：
   ```python
   @Slot(str, result=str)
   def my_new_api(self, param):
       try:
           result = some_backend_function(param)
           return json.dumps({"success": True, "data": result})
       except Exception as e:
           return json.dumps({"success": False, "error": str(e)})
   ```

2. 在 JS 侧直接调用（无需额外注册）：
   ```javascript
   bridge.my_new_api("param").then(function(json) {
       var result = JSON.parse(json);
   });
   ```

### 6.3 添加新的回测指标

在 `backend/backtest_executor.py` 的 `_compute_metrics()` 中添加：

```python
def _compute_metrics(self, equity_curve, initial_cash):
    returns = pd.Series(equity_curve).pct_change().dropna()
    metrics = {
        # ... 现有指标 ...
        'my_new_metric': self._calc_my_metric(returns),
    }
    return metrics
```

同时更新前端 `logMetrics()` 函数以显示新指标。

### 6.4 添加新的实时策略数据类型

在 `multi_realtime_strategy_engine.py` 中，策略通过 `context.stock` 区分不同股票：

```python
def initialize(context):
    context.fast = 5
    context.slow = 20

def handle_bar(context, bar_dict):
    # context.stock 已自动设置为当前处理的股票代码
    close_arr = history_bars(context.stock, context.fast + 1, '1d', 'close')
    # ...策略逻辑...
    order_target_percent(context.stock, 1.0)
```

**注意**：在多股实时模式下，需将原代码中的 `STOCK_CODE_PLACEHOLDER` 替换为 `context.stock`（前端 `realtimeSim.js` 的 `startMultiRealtime` 方法会自动完成此替换）。

### 6.5 添加新的数据库表

在 `backend/db.py` 的 `_init_tables()` 中添加 `CREATE TABLE IF NOT EXISTS` 语句。表会在应用首次启动时自动创建。

---

## 7. 打包与发布

### 7.1 PyInstaller 打包

**基本配置：**
```bash
pyinstaller --name=Tquant --windowed --add-data="Tquant.html;." --add-data="echarts.min.js;." --add-data="js;js" --add-data="web;web" main.py
```

**注意事项：**
- Qt WebEngine 需要额外 hook：`--hidden-import=PySide6.QtWebEngineWidgets`
- `qwebchannel.js` 在 PySide6 包中，PyInstaller 会自动包含
- 资源路径在打包后需用 `sys._MEIPASS` 处理
- 数据库文件 (`tquant.db`) 不应打包进 exe，应由用户放置在 exe 同目录

### 7.2 已知限制

- **计划中**：`app/settings.py` 目前为空，缺少配置持久化功能（实时策略配置已有独立持久化）
- **计划中**：数据更新进度条 / 百分比显示
- **已知问题**：Qt WebEngine 在部分 Windows 系统上偶发崩溃，已通过禁用 WebGL 和 Accelerated2dCanvas 缓解
- **已知问题**：多股回测时内存占用随股票数量线性增长（每只股票独立加载 K 线数据）
- **已知问题**：Baostock 登录偶尔失败，系统已内置 3 次重试
- **已知问题**：实时策略引擎依赖腾讯/新浪 API 可用性，非交易时段获取的数据可能延迟
- **已知问题**：东方财富 API 对频繁请求可能返回空数据，系统已实现重试和同花顺备用切换

---

## 8. 测试方法

### 8.1 后端单元测试

当前无正式单元测试框架。建议的手动测试方法：

**测试回测引擎：**
```python
# 运行 app/test_backtest.py
python app/test_backtest.py
```

**测试数据库连接：**
```python
from backend.db import Database
db = Database()
print(db.connection_status())
```

**测试数据更新：**
```bash
python backend/standalone_updater.py
```

### 8.2 前端手动测试

1. **Bridge 连接**：启动应用后检查右上角连接状态指示器（绿色=已连接）
2. **K线渲染**：搜索 `000001`，确认图表加载且包含 MA 线和成交量
3. **回测流程**：策略工厂 → 选择模板 → 运行回测 → 查看详情 → 导出报告
4. **日志筛选**：运行回测后切换筛选按钮，确认各级别过滤正常
5. **页面切换**：依次进入所有页面，确认工具栏和内容正常加载
6. **F12 调试**：按 F12 打开 DevTools 查看 Console 和 Network

### 8.3 回归测试清单

| 功能 | 测试点 |
|------|--------|
| 策略工厂 | 添加/编辑/删除卡片、拖拽排序、模板加载、保存/加载、对比回测 |
| 代码编辑器 | 编写代码、Tab 缩进、保存、运行回测 |
| 单股回测 | 有信号、无信号、数据不足三种场景 |
| 多股回测 | 2-5 只股票组合、股票绩效计算 |
| 对比回测 | 单股/多股两种模式、并行执行、结果排序 |
| 实时策略 | 单股/多股启动停止、信号拉取、T+1 规则、配置恢复 |
| 资金流向 | 单股查询、批量查询、建议文案、历史查询 |
| 报告导出 | Excel 4 个工作表、PDF 图表和表格 |
| 模拟交易 | 买入/卖出、持仓更新、一键平仓、重置、资产曲线 |
| 实时行情 | 批量获取、腾讯/新浪切换、行情表格增量更新 |
| 数据更新 | 增量更新、失败跳过、定时调度、财务更新、概念更新 |
| 日志系统 | 500 条上限、筛选、导出 txt、折叠/展开 |
| 回测历史 | 保存、加载、列表、删除 |
| 条件选股 | 卡片筛选、概念过滤、行业过滤、市值过滤、流通股本过滤 |
| 概念板块 | 个股概念查询、概念列表、按概念筛选股票 |
