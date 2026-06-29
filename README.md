# Tquant 量化工作站

基于 PySide6 + QtWebEngine 的桌面端量化交易平台，集成选股、回测、策略优化与自动交易。

## 功能概览

### 图表与分析
- **K线图表** — 日K/周K/月K，支持副图指标叠加（MACD/RSI/KDJ/布林带/CCI/OBV 等 12+ 指标）
- **个股详情** — 基本面数据（PE/PB/ROE）、概念/行业归属、资金流向历史

### 策略与回测
- **策略工厂** — 可视化卡片式策略构建，拖拽组合技术指标
- **参数优化** — Optuna TPE 智能超参搜索，实时进度 + 参数重要性分析
- **单股回测** — 自定义策略回测，K线买卖点标注，绩效指标（夏普/回撤/胜率）
- **多股组合回测** — 共享资金池，按日收集订单先卖后买
- **策略对比** — 多策略变体同屏对比回测结果

### 实时与自动交易
- **实时策略引擎** — asyncio + aiohttp 异步行情驱动，单股/多股模式
- **实时模拟** — 模拟交易环境，信号日志 + 持仓跟踪
- **自动交易** — PyAutoGUI 对接券商客户端自动下单，含紧急停止机制

### 数据管理
- **日K线更新** — Tushare/Baostock 双源，增量更新个股+指数
- **财务数据** — PE/PB/ROE/总市值/流通股本定时更新
- **资金流向** — 东方财富 API 每日增量，主力/超大单/大单/中单/小单
- **概念/行业** — AkShare 概念板块 + Baostock 行业分类
- **定时调度** — 启动自动检查 + 每日 18:00 定时，子进程隔离避免冲突

### 选股与筛选
- **条件选股** — 12+ 技术指标批量筛选，行业/概念/市值/流通股本预过滤
- **股票池** — 沪深300/中证500/中证1000/创业板/科创50/自定义

## 技术栈

| 层 | 技术 |
|------|------|
| 前端 | JavaScript (ECharts), HTML/CSS |
| 桌面框架 | PySide6 (Qt WebEngine + WebChannel) |
| 后端 | Python 3.12+ (asyncio/multithreading) |
| 数据库 | SQLite 3 (SQLAlchemy ORM) |
| 数据源 | Tushare Pro, Baostock, AkShare, 东方财富, 腾讯财经 |
| 优化引擎 | Optuna (TPE Sampler + Median Pruner) |
| 自动化 | PyAutoGUI, PyWin32 |

## 项目结构

```
Tquant/
├── main.py                          # 应用入口
├── Tquant.html                      # SPA 前端页面
├── app/                             # PySide6 桌面层
│   ├── web_bridge.py                # Python ↔ JS 桥接 (QWebChannel, 80+ API)
│   └── main_window.py               # 主窗口（调度器/快捷键）
├── backend/                         # 核心逻辑
│   ├── db.py                        # 数据库连接与表结构
│   ├── data_feed.py                 # K线数据供给（进程级缓存）
│   ├── strategy_engine.py           # 策略执行引擎
│   ├── backtest_executor.py         # 单股回测引擎
│   ├── multi_backtest_executor.py   # 多股组合回测引擎
│   ├── stock_screener.py            # 股票筛选器（91K）
│   ├── realtime_strategy_engine.py  # 实时策略引擎（asyncio）
│   ├── auto_trader.py               # 自动交易
│   ├── trade_simulation.py          # 交易模拟
│   ├── report_exporter.py           # 报告导出
│   ├── optimization/                # Optuna 参数优化
│   └── data_updater/                # 数据更新模块
│       ├── daily_kline_updater.py   # 日K线更新
│       ├── financial_updater.py     # 财务数据更新
│       ├── fund_flow_updater.py     # 资金流向更新
│       ├── concept_updater.py       # 概念板块更新
│       └── scheduler.py             # 定时调度器
├── js/                              # 前端 JS 模块
│   ├── main.js                      # 应用入口
│   ├── navigation.js                # 导航与路由
│   ├── chartRenderer.js             # K线图表渲染
│   ├── strategyBuilder.js           # 策略构建器 + 参数优化面板
│   ├── stockScreener.js             # 筛选器界面
│   ├── indicators.js                # 技术指标计算
│   └── realtimeSim.js               # 实时策略模拟
├── strategies/                      # 策略 JSON 配置
├── API/                             # API 文档（参考/开发/用户指南/更新日志）
├── tests/                           # 测试用例
└── scripts/                         # 工具脚本
```

## 快速开始

### 环境要求

- Windows 10/11
- Python 3.12+

### 安装

```bash
git clone https://github.com/TTL-966/tquant.git
cd tquant
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 配置

复制配置模板并填入 Tushare token：

```bash
cp config.example.json config.json
```

编辑 `config.json`，设置 `tushare_token` 和 `data_source`（baostock/tushare）。

### 首次使用

1. **更新日K线数据** — 设置页 → 点击"立即全量更新日线数据"
2. **更新概念/行业** — 设置页 → 点击"手动更新概念题材"和"手动更新行业分类"
3. **填充资金流向** — `python backend/populate_fund_flow.py --limit 50`（测试），确认无误后全量 `--limit 0`
4. **启动应用** — `python main.py`

### 运行

```bash
python main.py
```

## API 文档

完整 API 参考见 [`API/`](API/) 目录：
- [API_REFERENCE.md](API/API_REFERENCE.md) — Bridge API 完整参考（80+ 方法）
- [DEVELOPER.md](API/DEVELOPER.md) — 开发者指南
- [USER_GUIDE.md](API/USER_GUIDE.md) — 用户手册
- [CHANGELOG.md](API/CHANGELOG.md) — 更新日志

## 免责声明

本软件仅供学习与研究使用。量化交易涉及风险，使用者需自行承担交易结果。自动交易功能请谨慎使用。
