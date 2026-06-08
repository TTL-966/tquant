# Tquant 量化工作站

基于 Python + PySide6 的桌面端量化回测系统，支持可视化策略构建、自定义代码策略、多股组合回测、K线图表分析和实时行情监控。

## 功能列表

- **K线图表**：ECharts 渲染的蜡烛图，支持日/周/月周期切换、MA 均线叠加、SAR 抛物线转向叠加、控制面板切换显示、多副图技术指标（MACD/RSI/KDJ/布林带/ATR/CCI/威廉%R/OBV/ROC/趋势强度/超级趋势/CMF/共振指标）、成交量副图、买卖点标记
- **策略工厂**：拖拽式卡片策略构建器，25 种策略卡片（MA 交叉、RSI、MACD、布林带、布林带宽度、KDJ、成交量、成交量萎缩、ATR 突破、CCI、均线排列、周几效应、SAR 抛物线转向、OBV 能量潮、锤子线/吊颈线、威廉指标、ROC 变动率、PSY 心理线、止损止盈、仓位管理、涨跌停过滤、PE低于、PB低于、ROE高于、指数情绪），6 套内置策略模板，**支持多策略变体对比回测（单股/多股组合，共享资金池）**
- **代码编辑器**：直接编写 Python 策略代码，支持 `initialize`/`handle_bar` 标准接口，含 API 帮助文档
- **回测引擎**：支持单股和多股组合回测，共享资金池，含滑点/佣金/印花税模拟。**v1.5.0 起后台 QThread 异步执行**，实时进度反馈，支持中途取消
- **绩效报告**：累计收益率、年化收益率、最大回撤、夏普比率、胜率、交易次数，支持导出 Excel 和 PDF，回测记录自动保存到历史
- **模拟交易**：手动买卖、持仓管理、盈亏计算、一键平仓、重置模拟盘、每日资产曲线
- **实时行情**：对接腾讯财经 + 新浪财经双接口获取实时报价，支持批量获取，动态轮询更新
- **实时策略交易**：支持单股/多股组合实时策略运行，共享资金池、T+1 交易规则、独立线程轮询、配置持久化和恢复
- **资金流向**：东方财富 + 同花顺双源获取主力资金流向，含智能分析建议、历史追踪、批量查询
- **条件选股**：基于技术指标和财务指标批量筛选股票，支持 AND 逻辑组合，支持概念板块/行业/市值/流通股本过滤
- **个股资料**：PE、PB、ROE、总市值、净利润、流通股本等财务数据、行业分类、概念题材一键查看
- **数据管理**：Baostock 日线增量更新 + 财务数据定时更新（PE/PB/ROE/营收/净利润）+ 概念板块更新 + 资金流向更新，失败自动跳过
- **日志系统**：级别筛选（全部/信息/警告/错误/成功）、最大 500 条限制、导出 txt、自动滚底

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | PySide6 (Qt 6) + QWebEngineView |
| 前端 | 原生 JavaScript (ES6 Modules) + ECharts 5 |
| 通信 | Qt WebChannel (无缝 Python ↔ JS 互调) |
| 数据库 | SQLite 3 + SQLAlchemy ORM |
| 数据源 | Baostock（历史日线）+ 腾讯财经/新浪财经 API（实时行情）+ 东方财富/同花顺（资金流向） |
| 回测引擎 | 自研 sandbox 策略执行器 + QThread 异步执行 + 进度轮询 + 取消支持（单股/多股组合/对比回测） |
| 实时引擎 | asyncio + aiohttp 异步事件循环 + 并发行情获取 + 共享资金池 + T+1 交易规则 |
| 报告生成 | xlsxwriter (Excel) + reportlab + matplotlib (PDF) |
| 图表库 | ECharts 5（蜡烛图、权益曲线、成交量） |

## 安装与运行

### 环境要求

- Python 3.10+ （推荐 3.12）
- Windows 10/11（Qt WebEngine 在 Linux/macOS 需额外配置）
- 至少 4 GB 可用内存（数据库约 2 GB）

### 安装步骤

```bash
# 1. 克隆项目
git clone <repository-url>
cd Tquant1

# 2. 创建虚拟环境
python -m venv .venv

# 3. 激活虚拟环境 (Windows)
.venv\Scripts\activate

# 4. 安装依赖
pip install -r requirements.txt

# 5. 启动应用
python main.py
```

### 数据初始化

应用首次启动时数据库可能为空。可通过以下方式获取数据：

**方式一：从 MySQL 迁移（如有旧库）**
```bash
python scripts/migrate_mysql_to_sqlite.py --host <mysql_host> --user <user> --password <pwd> --database <db_name>
```

**方式二：手动触发数据更新**
启动应用后，进入「设置」页面，点击「手动更新数据」按钮，系统将从 Baostock 下载全部 A 股历史日线。

**方式三：同步新股列表**
```bash
python backend/sync_new_stocks.py    # 同步最新股票列表
python backend/standalone_updater.py # 下载历史日线
```

## 目录结构

```
Tquant1/
├── main.py                          # 应用入口
├── Tquant.html                      # 主界面 HTML（SPA）
├── requirements.txt                 # Python 依赖
├── tquant.db                        # SQLite 数据库（运行时生成）
├── echarts.min.js                   # ECharts 库
│
├── app/                             # 桌面应用层
│   ├── main_window.py               # 主窗口（QMainWindow + QWebEngineView）
│   └── web_bridge.py                # WebChannel 桥接（所有 @Slot API）
│
├── backend/                         # 业务逻辑层
│   ├── db.py                        # 数据库访问（SQLAlchemy）
│   ├── data_feed.py                 # K线数据提供者（缓存 + 聚合）
│   ├── backtest_executor.py         # 单股回测引擎
│   ├── multi_backtest_executor.py   # 多股组合回测引擎
│   ├── backtest_worker.py           # QThread 回测工作线程（单股/多股/对比）NEW v1.5.0
│   ├── backtest_job_manager.py      # 回测任务管理器（进度/缓存/取消）NEW v1.5.0
│   ├── strategy_engine.py           # 内置双均线策略
│   ├── strategy_storage.py          # 策略 JSON 持久化
│   ├── trade_simulation.py          # 模拟交易引擎
│   ├── report_exporter.py           # Excel/PDF 报告导出
│   ├── stock_screener.py            # 条件选股引擎（批量 + 单只验证 + 资金流向选股）
│   ├── standalone_updater.py        # 独立数据更新脚本（子进程调用）
│   ├── sync_new_stocks.py           # 新股同步脚本
│   ├── industry.py                  # 行业分类数据
│   ├── realtime_strategy_engine.py  # 单股实时策略引擎（asyncio + aiohttp）v1.5.0 重写
│   ├── multi_realtime_strategy_engine.py  # 多股实时策略引擎（asyncio + aiohttp）v1.5.0 重写
│   ├── realtime_quote_fetcher.py    # 实时行情获取器（腾讯+新浪双源，同步版）
│   ├── async_quote_fetcher.py       # 异步行情获取器（aiohttp，腾讯+新浪双源）NEW v1.5.0
│   ├── async_db.py                  # 异步数据库辅助（run_in_executor）NEW v1.5.0
│   ├── realtime_config.py           # 实时策略配置持久化
│   ├── fund_flow_fetcher.py         # 资金流向获取器（东方财富+同花顺双源）
│   ├── everydaystock.py             # 每日增量更新脚本
│   └── data_updater/                # 数据更新子系统
│       ├── base_updater.py          # 更新器基类
│       ├── daily_kline_updater.py   # 日线增量更新器
│       ├── financial_updater.py      # 财务数据更新器（PE/PB/ROE）
│       ├── concept_updater.py        # 概念板块更新器
│       ├── fund_flow_updater.py      # 资金流向数据更新器
│       ├── index_updater_akshare.py  # 指数成分股更新器（AKShare）
│       └── scheduler.py             # 定时调度器（每日 18:00 + 财务 6h 检查）
│
├── js/                              # 前端 JavaScript 模块
│   ├── main.js                      # 入口 + 全局状态
│   ├── bridge.js                    # Qt WebChannel 客户端
│   ├── navigation.js                # 页面路由（11 个页面）
│   ├── chartRenderer.js             # K线图渲染（ECharts）
│   ├── SubChartManager.js           # 多副图指标管理（MACD/RSI/KDJ 等）
│   ├── subChartRenderer.js          # 成交量副图
│   ├── indicators.js                # 技术指标纯函数计算库
│   ├── kline.js                     # K线数据获取
│   ├── strategyBuilder.js           # 策略工厂（卡片式）
│   ├── codeEditor.js                # 代码编辑器
│   ├── compareStrategy.js           # 对比回测弹窗与逻辑
│   ├── compareView.js               # 对比回测结果渲染（多曲线图/指标表/信号）
│   ├── strategyTemplates.js         # 卡片类型定义 + 策略模板
│   ├── strategyUtils.js             # 代码生成 + 序列化
│   ├── stockData.js                 # 股票静态数据
│   ├── datepicker.js                # 自定义日期选择器
│   ├── suggestions.js               # 搜索建议
│   ├── profile.js                   # 个人中心 / 模拟持仓
│   ├── realtimeSim.js               # 多股实时模拟交易页面
│   ├── stockScreener.js             # 条件选股页面（可视化卡片 + 筛选 + 模板）
│   ├── logger.js                    # 统一日志组件
│   └── troubleshoot.js              # 常见错误排查指南
│
├── web/                             # Web 端文件
│   ├── qwebchannel.js               # Qt WebChannel JS 库
│   └── index.html                   # Web 端测试页面
│
├── strategies/                      # 策略持久化存储
│   └── strategies.json
│
├── scripts/                         # 工具脚本
│   └── migrate_mysql_to_sqlite.py   # MySQL → SQLite 迁移
│
├── feedback/                        # 导出的回测报告
└── temp_reports/                    # 临时报告文件
```

## 常见问题 (FAQ)

### Q: 启动后界面空白或加载失败？
确保 `Tquant.html` 和 `echarts.min.js` 在项目根目录，且 `tquant.db` 数据库文件存在（可为空文件，首次启动会自动建表）。

### Q: 回测没有信号？
常见原因：
1. 策略条件过于严格（如 RSI 超卖阈值设得过低）
2. 回测区间内数据不足（检查起止日期和数据范围）
3. 股票在该区间停牌（查看日志确认是否有数据）
4. 使用了 `bar_dict['close']` 而非 `bar_dict[stock]['close']` 的正确写法
5. **v1.5.0 新增：QWebEngine 缓存了旧版 JS** — 按 F12 查看控制台，应显示 `[codeEditor.js] v20260607 async loaded`。若未显示，重启应用或清除 WebEngine 缓存

### Q: 数据更新失败或卡住？
1. Baostock 服务器可能有频率限制，系统已内置 0.5 秒请求间隔
2. 已退市股票连续失败 3 次后会自动跳过 30 天
3. 查看设置页的手动更新状态
4. 可在 SQLite 中手动清除失败记录：`DELETE FROM stock_update_fail WHERE code='000001';`

### Q: 实时行情不更新？
实时行情依赖腾讯财经 API (`web.sqt.gtimg.cn`)，需要网络连接。在股票详情页会每 5 秒自动轮询。如果网络不通，会回退显示最近一次收盘价。

### Q: 如何编写自定义策略？
两种方式：
1. **策略工厂**：通过拖拽卡片构建，自动生成 Python 代码
2. **代码编辑器**：直接手写 Python，需实现 `initialize(context)` 和 `handle_bar(context, bar_dict)` 两个函数

### Q: 支持哪些股票市场？
目前支持沪深 A 股（代码 60xxxx、00xxxx、30xxxx、68xxxx），不含北交所（可选开启）。

### Q: 如何运行实时策略？
进入「⚡ 多股实时模拟交易」页面，填写策略代码和股票池，设置初始资金和轮询间隔，点击「启动多股策略」即可。系统会在独立线程中循环执行，自动下单到模拟盘。支持 T+1 交易规则（当天买入的股票当日不可卖出）。

### Q: 如何查看资金流向？
在个股详情页可查看单只股票的主力资金流向和智能分析建议。资金流向数据来自东方财富 API（主源），失败时自动切换同花顺备用源。

### Q: 回测记录会丢失吗？
不会。回测完成后可点击「保存记录」将结果存入数据库（含权益曲线、信号、绩效等），后续可在历史记录页面随时加载查看。

## 许可证

本项目仅用于学习和研究目的。Baostock 数据版权归其原作者所有。
