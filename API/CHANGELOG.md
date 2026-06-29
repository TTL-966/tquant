# 更新日志 (Changelog)

## v1.6.0 (2026-06-29)

### 新功能

**Optuna 参数优化**
- 策略构建器新增参数优化面板，TPE 智能超参搜索
- 支持单股/多股双模式，多股模式使用 MultiBacktestExecutor 共享资金池
- 试验次数自动缩放：`adjusted = max(30, base / sqrt(stock_count))`
- ECharts 实时进度图 + 参数重要性分析 + 最优参数一键应用
- 新增 `start_optimization` / `get_optimization_progress` / `get_optimization_result` / `cancel_optimization` API

**数据更新增强**
- 日线更新同时覆盖个股+指数（8个默认指数写入同一张表）
- 资金流向增量更新：东方财富 API 每日最近 N 日，ThreadPoolExecutor 并发
- 调度器新增资金流向定时任务 + 独立子进程隔离
- 新增 `populate_fund_flow.py` 空表初始化脚本

### 新文件

| 文件 | 说明 |
|------|------|
| `backend/optimization/` | Optuna 参数优化模块 |
| `backend/populate_fund_flow.py` | 资金流向初次填充脚本 |
| `tests/test_opt_objective.py` | 参数优化测试 |
| `tests/test_multi_opt_objective.py` | 多股优化测试 |
### 更新

- `fund_flow_updater.py`：新增 `get_fund_flow_recent(code, days)` 多日方法
- `standalone_updater.py`：新增 `--type fund_flow --days N` 分支
- `scheduler.py`：新增 `_run_fund_flow_update()` 资金流调度
- `strategyBuilder.js`：优化面板 + 单股/多股模式切换
- `daily_kline_updater.py`：个股更新后自动追加指数更新

---

## v1.5.0 (2026-06-07)

### 重大架构重构

**异步回测引擎**
- 回测执行从 Qt 主线程移至 `BacktestWorker(QThread)` 后台线程，彻底消除 UI 白屏/未响应
- 新增 `BacktestJobManager`：任务追踪、进度轮询、结果缓存、取消支持
- `run_custom_backtest` / `run_multi_backtest` / `run_compare_backtest` 改为异步：立即返回 `{success, job_id}`，前端轮询获取进度和结果
- 新增 4 个 Bridge API：`get_backtest_progress` / `get_backtest_result` / `cancel_backtest` / `cleanup_backtest`
- 回测执行器新增 `progress_callback` 和 `_cancelled` 支持，可实时汇报进度并中途取消
- JS 前端改为 500ms 轮询模式，状态栏实时显示进度百分比
- 并发回测支持：多个独立任务并行执行，互不阻塞

**实时策略引擎异步化**
- `RealtimeStrategyEngine` 和 `MultiRealtimeStrategyEngine` 重写为 asyncio + aiohttp 架构
- 不再使用 `threading.Thread` + 阻塞 `requests`，改为专用守护线程运行 asyncio 事件循环
- 新增 `AsyncQuoteFetcher`：aiohttp 异步行情获取，Semaphore 控制并发（最大 20），腾讯→新浪降级
- `stop()` 方法从阻塞 `join(timeout=10)` 改为非阻塞（0ms 返回），消除僵尸线程
- 行情获取并发化：200 只股票分 4 批 asyncio.gather，延迟从 ~10s 降至 ~1s
- 线程安全增强：`_state_lock` 保护 signals/logs 跨线程读写
- 移除 `MAX_STOCKS=50` 限制，支持 200+ 股票

**QWebEngine 缓存修复**
- `main_window.py` 设置 `MemoryHttpCache` + `clearHttpCache()` 禁用磁盘缓存
- `Tquant.html` 添加 `main.js?v=20260607` 版本 hash
- JS 模块添加 `console.log` 版本标记，便于 F12 调试验证

### 新文件

| 文件 | 说明 |
|------|------|
| `backend/backtest_worker.py` | QThread 回测工作线程（单股/多股/对比） |
| `backend/backtest_job_manager.py` | 回测任务管理器（追踪/进度/缓存/取消） |
| `backend/async_quote_fetcher.py` | aiohttp 异步行情获取器（腾讯+新浪双源） |
| `backend/async_db.py` | 异步数据库辅助（run_in_executor 包装） |

### 更新

- 回测 API 从同步阻塞改为异步轮询模式（向后兼容前端需更新JS）
- 实时策略引擎移除 ThreadPoolExecutor 行情获取，改用 asyncio.gather
- `data_feed.py` 新增 `get_realtime_quotes_batch` 方法
- `main_window.py` 新增 DataFeed 预热缓存（启动 5s 后加载 10 只常用股）

### Bug 修复

- 修复 QWebEngine 缓存导致回测返回 0 信号（旧 JS 不识别 `{success, job_id}` 新格式）
- 修复实时策略引擎 `stop()` 阻塞 UI 10 秒的问题
- 修复多股轮询间隔被网络延迟撑大导致信号丢失
- 修复回测结果 JSON 序列化中 numpy 类型转换问题（`_to_json_safe` 递归包装）

---

## v1.4.0 (2026-05-30)

### 新功能

**指数情绪卡片**
- 新增 `index_sentiment` 卡片类型：基于大盘指数技术指标判断市场情绪，作为买卖信号的辅助条件
- 支持 6 种基准指数：沪深300、上证指数、深证成指、中证500、创业板指、科创50
- 支持 7 种技术指标：收盘价>均线、收盘价<均线、RSI大于、RSI小于、MACD金叉、MACD死叉、成交量比率
- **严格模式**（默认开启）：所有指标计算排除当日数据，基于截至前一日数据判断，彻底避免未来函数
- 多张指数情绪卡片使用 **OR 逻辑**（任一满足即允许交易）
- 多股回测中指数条件每个交易日只计算一次（全局 run_daily），避免重复计算

**策略 API 扩展**
- 新增 `get_index_history(index_code, count, field, strict)` 函数：获取指数历史K线数据，支持严格模式
- 新增 `run_daily(func, time)` 函数：注册每日执行函数，在 `handle_bar` 之前运行
- `run_daily` 执行顺序调整：现在在 `handle_bar` **之前**执行，确保最新条件可供交易决策使用

### 更新

- 策略工厂卡片类型从 24 增至 **25**（新增指数情绪）
- API 文档新增第 2.7 节（指数情绪 API）和第 6 节（指数情绪卡片完整说明）

### Bug 修复

- 修复指数情绪代码生成中 `run_daily` 注册在错误作用域的问题（导致恒为 False 无信号）
- 修复严格模式下日期对齐时误排除已有数据的问题
- 修复多股回测中 `_index_cache` 未在运行时重置的缓存泄漏

---

## v1.3.0 (2026-05-29)

### 新功能

**多股实时模拟交易**
- 新增「⚡ 多股实时模拟交易」页面（`realtimeSim.js`），支持策略代码直接运行在实时行情上
- 多股实时策略引擎（`MultiRealtimeStrategyEngine`）：共享资金池、先卖后买、独立线程轮询
- T+1 交易规则：当天买入的股票当日不可卖出，自动跨日清空锁定
- 历史数据缓存（5 分钟 TTL），新交易日自动清空，减少数据库查询
- 轮询间隔动态调整：≤10 只 3 秒、≤20 只 5 秒、≤30 只 8 秒，支持自定义
- 可视化持仓行情表格（增量更新，不闪烁）、信号表格（最多 200 条）、实时日志
- 策略配置自动持久化（`realtime_config.py`），应用重启时可选择恢复
- 页面隐藏时自动暂停轮询，节约资源

**资金流向分析**
- 新增 `FundFlowFetcher`：东方财富 API（主源）+ 同花顺页面抓取（备用源）双源获取
- 支持单股查询 `get_fund_flow()` + 批量查询 `get_batch_fund_flow()`（最多 50 只）
- 智能分析建议：基于当日主力净额 + 近 5 日历史趋势自动生成中文建议文案
- 资金流向历史数据存储（`fund_flow_history` 表），支持 `get_fund_flow_history()` 查询
- 缓存机制（60 秒 TTL），减少重复请求

**回测历史记录**
- 新增 `backtest_history` 表，回测结果可保存到数据库
- `save_backtest_result()` / `get_backtest_history()` / `load_backtest_history()` / `delete_backtest_history()` 完整 CRUD
- 存储完整的权益曲线、交易信号、绩效指标、股票绩效归因

**持仓管理增强**
- 一键平仓 `close_all_positions()`：按最新价格卖出所有持仓
- 重置模拟盘 `reset_portfolio()`：清空持仓和交易记录，恢复初始资金
- 持仓汇总 `get_portfolio_summary()`：总市值、总成本、浮动盈亏
- 每日资产曲线 `get_daily_assets()`：基于历史交易记录重构资产权益曲线

**概念板块与行业筛选**
- 新增 `concept` 和 `stock_concept` 表，存储概念板块数据
- `get_stock_concepts()`：查询个股概念题材
- `get_concept_list()` / `get_industry_list()`：获取完整的板块/行业列表
- `filter_stocks_by_concepts()`：按概念过滤股票（支持 any/all 模式）
- `filter_stocks_by_industry()`：按一级行业过滤股票
- `filter_stocks_by_market_cap()`：按总市值区间过滤
- `filter_stocks_by_float_shares()`：按流通股本区间过滤
- 概念板块更新器（`concept_updater.py`）

**批量实时行情**
- 新增 `RealtimeQuoteFetcher`：腾讯 + 新浪双源，自动容错切换
- `get_realtime_quotes()`：批量获取行情（自动拆分批次、并发请求）
- 支持最多 50 只股票同时获取

**条件选股增强**
- 新增 5 种选股评估器：资金流向（fund_flow_single）、超级趋势（supertrend）、CMF、共振（resonance）、趋势强度（trend_strength）
- `screen_stocks` API 新增 start_date/end_date 参数支持

**指数成分股更新**
- 新增 `index_updater_akshare.py`：使用 AKShare 更新指数成分股数据

**数据更新增强**
- 新增 `trigger_financial_update()`：独立触发财务数据更新（PE/PB/ROE 等）
- 新增 `everydaystock.py`：每日增量更新专用脚本（含数据完整性检查）
- 新增资金流向数据更新器（`fund_flow_updater.py`）

**文件导出增强**
- `save_text_file` 新增 CSV 格式支持（utf-8-sig 编码，含 BOM，确保 Excel 正确打开中文）

### 更新

- 页面总数从 10 增至 **11**（新增多股实时模拟交易页面）
- Bridge API 总数从约 35 增至 **60+**
- 副图指标新增：超级趋势（Supertrend）、CMF（蔡金资金流）、共振指标
- 实时行情数据源从单源（腾讯）升级为双源（腾讯+新浪自动切换）

### Bug 修复

- 修复实时策略引擎 T+1 规则在非交易日时未正确重置的问题
- 修复历史行情缓存未在新交易日清空导致的数据延迟
- 修复多股轮询耗时超过间隔 80% 时未告警的问题

---

## v1.2.1 (2026-05-28)

### 新功能

**趋势强度副图指标**
- 新增「趋势强度」副图指标（`trend_strength`），基于通达信可计算部分实现
- 21 周期线性加权移动平均线（`weightedSMA`），反应优于普通 SMA
- 20 日压力线（HHV(H,20)）+ 20 日支撑线（LLV(L,20)）
- 短底信号：基于 168 日低点和 21 日高点的归一化 EMA 交叉，蓝色▲标记
- 金手指信号：MA20 上穿 MA120，金色▼标记
- 所有计算在前端完成，无需后端改动
- 新增 `indicators.js` 四个导出函数：`weightedSMA`、`shortBottomSignal`、`calcSupportResistance`、`calcGoldenFinger`

### 更新

- 副图指标总数从 9 增至 **10**（新增趋势强度）

---

## v1.2.0 (2026-05-25)

### 新功能

**对比回测多股扩展**
- 对比回测从单股扩展到多股组合回测，支持共享资金池
- 对比回测弹窗股票输入框改为多行文本域，支持批量输入（逗号/换行分隔）
- 新增「快速填仓」按钮（沪深300、中证500、中证1000、创业板、科创50）
- `run_compare_backtest` API 新增 `stock_pool` 参数，长度 > 1 时自动使用 `MultiBacktestExecutor`
- 对比结果页显示「股票池」标签和个股绩效归因折叠面板
- 变体代码在多股模式下保留 `STOCK_CODE_PLACEHOLDER`，由后端对每只股票独立替换
- 保持向后兼容：单股模式（`stock_code`）仍正常工作

---

## v1.1.0 (2026-05-24)

### 新功能

**财务数据系统**
- 新增 `stock_financial` 表（PE/PB/ROE/总市值/营收/净利润/流通股本）
- 新增 `stock_financial_history` 表（历史财务数据追踪）
- 新增 `stock_industry_detail` 表（三级行业分类 + 概念板块）
- FinancialUpdater（基于 Baostock）：定时更新 PE(TTM)、PB、ROE、营收、净利润、流通股本
- 自动过滤近一年无交易的退市股，增量更新（90 天过期或新股触发）
- 总市值基于本地最新收盘价 × 流通股本自动计算
- 定时调度：每 6 小时检查一次财务数据是否需要更新

**条件选股**
- 新增 `stock_screener.py`：批量条件选股引擎
- `screen_stocks()` API：根据卡片条件批量筛选股票（支持 AND 逻辑组合）
- `test_evaluate_stock()` API：单只股票条件验证（含结果原因说明）
- 新增 3 种财务指标卡片：PE低于(pe_below)、PB低于(pb_below)、ROE高于(roe_above)
- 批量向量化筛选：PE/PB/ROE 通过 pandas groupby+transform 高效计算

**个股资料弹窗**
- 「📊 个股资料」按钮：个股详情页和 K 线图页均可一键查看
- 显示 PE、PB、ROE、总市值、净利润、流通股本等财务指标
- 异步加载，loading 状态提示，错误处理和空数据保护

**界面改进**
- 策略工厂卡片选择器从 3 列改为 5 列布局，适配 24 种卡片类型
- 弹窗宽度从 480px 扩展到 680px，卡片间距更紧凑

### 更新

- 卡片总数从 21 增至 **24**（新增 pe_below、pb_below、roe_above）
- `standalone_updater.py` 支持 `--type financial` 参数运行财务更新
- API 文档更新至 v1.2，新增 4 个 Bridge API 文档

---

## v1.0.0 (2026-05)

### 新功能

**桌面应用框架**
- PySide6 + QWebEngineView 桌面应用
- Qt WebChannel 实现 Python ↔ JavaScript 双向通信
- 左侧导航栏 + 动态内容区布局（10 个页面）
- 自定义日期选择器（解决 QtWebEngine 中 `<input type="date">` 不兼容问题）
- 自定义下拉选择面板（解决 QtWebEngine 中 `<select>` / `<datalist>` 不兼容问题）
- F12 快捷键打开 Chrome DevTools（调试用）

**K线图表**
- ECharts 蜡烛图渲染，支持日/周/月周期切换
- MA5/MA10/MA20/MA30 均线叠加
- SAR 抛物线转向散点叠加于主 K 线图
- 控制面板（左上角复选框）：独立切换 K线/MA5/MA10/MA20/MA30/SAR 显示/隐藏
- 成交量副图（含 VOLMA5/VOLMA10）
- 多副图技术指标支持：MACD、RSI、KDJ、布林带、ATR 通道、CCI、威廉 %R、OBV 能量潮、ROC 变动率
- 副图指标基于连续日历日序列计算（消除周末缺口），图表仅显示交易日
- 买卖点标记（向上红三角 = 买，向下绿三角 = 卖）
- 主图与副图缩放联动、十字光标同步
- 主图 y 轴虚线网格（splitLine）
- 悬停显示交易详情卡片（右上角展示成交价/手数，图例不显示买卖点以避免标记冲突）
- 渐进式渲染（1000+ 数据点优化）

**策略工厂**
- 21 种技术指标卡片（MA 交叉、RSI、MACD、布林带、布林带宽度、KDJ、成交量、成交量萎缩、ATR 突破、CCI、均线排列、周几效应、SAR 抛物线转向、OBV 能量潮、锤子线/吊颈线、威廉指标、ROC 变动率、PSY 心理线、止损止盈、仓位管理、涨跌停过滤）
- 卡片拖拽排序
- 6 套内置策略模板
- 自动生成 Python 策略代码（预览和导出）
- 添加卡片弹窗三列网格布局，紧凑展示
- 策略参数配置（初始资金、日期、滑点、佣金、印花税）
- 指数快速填仓（沪深 300、中证 500 等）
- 策略 JSON 保存/加载/删除
- 策略代码编辑区底部新增运行日志提示说明，引导用户关注日志面板
- **多策略对比回测**：基于卡片参数自动生成变体，无需手写代码
  - 自动提取卡片中的数值型参数，用户可配置每个变体的参数组合
  - 可编辑共享参数（初始资金、滑点模式、佣金、印花税）
  - 多线程并行执行（最多 5 个线程），变体间互不阻塞
  - 三标签页结果展示：多曲线权益图、指标对比表（最优/最差高亮）、交易信号查看器
  - 支持导出所有变体的完整策略代码（原生保存对话框，用户自选路径）

**代码编辑器**
- 直接编写 Python 策略代码
- Tab 键插入 4 空格缩进
- 单股和多股回测支持
- API 帮助文档（折叠面板）
- 回测完成后显示绩效指标摘要

**回测引擎**
- 单股回测：沙箱环境执行用户策略
- 多股组合回测：共享资金池、先卖后买、FIFO 绩效归因
- 风控模拟：佣金、印花税、滑点（3 种模式，支持次日开盘价等实际影响成交价）
- 绩效指标：累计收益率、年化收益率、最大回撤、夏普比率、年化波动率、信息比率、胜率、交易次数
- 策略 API：`history_bars`、`order_target_percent`、`order_target_value`、`get_current_data`、`log`、`context.portfolio`

**回测报告**
- 权益曲线图表
- 交易信号表格（日期、代码、方向、价格、数量、市值）
- 交易信号列表按持仓市值降序排列，默认仅展示前 6 支股票
- 买卖点成交图下拉框同步显示持仓市值前 6 支股票
- 策略详情按实际成交过的股票统计
- 股票绩效（多股回测）
- Excel 导出（4 个工作表）
- PDF 导出（图表 + 表格，支持中文）
- 信号同步到模拟盘

**模拟交易**
- 手动买卖股票
- 持仓管理（数量、成本价、现价、盈亏）
- 交易历史记录
- 总资产 / 可用现金展示

**行情与数据**
- 腾讯财经 API 实时行情（5 秒轮询）
- 股票搜索（模糊匹配代码和名称）
- 行业分类查询
- 指数成分股查询
- Baostock 日线历史数据
- 增量数据更新（仅下载缺失日期）
- 定时调度（每日 18:00 自动检查更新）
- 手动触发数据更新

**日志系统**
- 4 级日志（INFO / WARN / ERROR / SUCCESS）
- 颜色区分（灰蓝 / 黄色 / 红色 / 绿色）
- 筛选按钮（全部 / 信息 / 警告 / 错误 / 成功）
- 最大 500 条限制（超出自动删除最旧）
- 导出为 txt 文件（完整日志，不受筛选影响）
- 用户上滚时暂停自动滚底
- 日志区域折叠/展开

**个股详情**
- 实时模糊搜索容器，支持股票代码和名称输入
- 回测后批量加载股票名称，K 线页下拉框优先使用回测结果的 topPositionCodes

**其他**
- 故障排查指南页面（常见策略错误 + 解决方案）
- 头像上传（localStorage 持久化）
- 数据库连接状态检测
- MySQL 到 SQLite 数据迁移脚本（高性能，支持断点续传）

### Bug 修复

- 修复每次页面切换后日志工具栏消失的问题（Logger 改为每次渲染新建实例）
- 修复 strategyBuilder.js 中 `strategyLogger` 未定义导致的引用错误
- 修复已退市股票每次更新都反复请求 Baostock 的问题（增加失败计数和 30 天跳过机制）
- 修复停牌股票数据更新时的异常处理
- 修复 QWebEngineView 缓存导致的前端代码不更新问题
- 修复日期选择器在非当前月份日期的显示问题
- 修复均线等简单策略无买卖点信号的问题（移除沙箱限制、修复 `history_bars` 数据不足时返回空数组、策略模板增加数据长度检查）
- 修复回测后股票名称缺失问题（回测完成后批量调用 `fetchStockName` 动态加载名称）
- 买卖点成交图和个股详情页 K 线默认显示最近 220 根日线
- 多股票回测收益率失真问题（检测到 >1 只股票时弹出长警告提示，仅展示第一只结果）
- 修复成交价与实际价格不一致问题（引入半价差标记，配合滑点选择器使次日开盘价可实际影响成交价）
- 修复策略详情页面无法打开的问题（`profitClass` 空值保护、`drawEquityCurve` 高度重试、`buildMetricCards` 格式化兼容性处理）
- 修复旧版策略编辑器保存的策略无法加载问题（旧版编辑器已由策略工厂完全替代，不兼容格式会提示用户）
- 修复多股回测导出报告失败问题（`web_bridge.py` `export_report` 增加 snake_case → camelCase 字段兼容转换）
- 修复对比回测结果页「导出报告」按钮无反应（`compareView.js` 缺少 `bridge` 导入和 `showToast` 函数）
- 修复回测引擎静默使用模拟数据的问题（`backtest_executor.py` 增加数据完整性检查，数据不足时明确报错而非降级为随机游走模拟数据）

### 已知问题

- Qt WebEngine 在部分 Windows 系统上偶发崩溃，已通过禁用 WebGL/Accelerated2dCanvas 缓解
- 多股回测时内存占用随股票数量线性增长
- 多股票回测目前为逐股票独立资金运行，尚未实现联合资金池下的真实组合回测（新功能中描述的组合回测为规划目标）
- Baostock 登录偶尔失败（已内置 3 次重试）
- 数据更新无进度条显示（仅控制台输出日志）
- `app/settings.py` 尚未实现（配置持久化功能计划中）
- 北交所股票支持不完整（可通过配置开启但未经充分测试）
- 实时行情在非交易时段可能出现数据延迟
- 无自动数据备份机制
- 日线数据表不含成交量字段，依赖成交量的策略（如成交量放大策略）无法实际运行
- 回测引擎的手续费/滑点模型仅实现了成交价的简单偏移，未包含完整的佣金和印花税计算
- 旧版策略编辑器已完全由策略工厂替代，旧版保存的策略格式不兼容

### 计划中 (Roadmap)

- [ ] 配置持久化（设置页面保存到本地文件）
- [ ] 数据更新进度条和 ETA 显示
- [ ] 更多数据源支持（Tushare、AKShare）
- [ ] 分钟级回测
- [ ] 参数优化（网格搜索）
- [x] 策略回测对比（v1.0.0 已实现）
- [ ] 邮箱/微信通知
- [ ] Linux/macOS 平台支持
- [ ] Docker 部署方案
- [ ] 单元测试覆盖
- [ ] CI/CD 流水线
- [ ] 大股票池回测支持（沪深 300、中证 1000 等），适配打板、海龟交易法等需大量股票验证的策略场景
- [x] 个股详情页开放成交量、KDJ 等指标展示区域（v1.0.0 已实现）
- [ ] 技术指标内置函数支持（RSI / MACD / KDJ 等，目前需通过卡片代码生成器生成）
- [ ] 回测报告字体与排版美化（数字与标签的对齐优化）
- [ ] 成交量数据扩展（当前日线表不含成交量字段）
