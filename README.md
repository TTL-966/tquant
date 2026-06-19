# Tquant 量化工作站

基于 PySide6 + QtWebEngine 的桌面端量化交易平台，集成选股、回测、策略引擎与自动交易。

## 功能

- **K线图表** — 日K/周K/月K，支持副图指标叠加
- **股票筛选器** — 多维度条件筛选，支持预过滤
- **策略回测** — 单股/多股回测，异步执行，结果可视化
- **策略引擎** — 自定义策略构建与实时信号生成
- **自动交易** — 通过 PyAutoGUI 对接券商客户端自动下单
- **数据更新** — 日K线、财务数据、资金流向自动更新（Tushare/BaoStock）
- **实时行情** — 实时报价与策略信号监控

## 技术栈

| 层 | 技术 |
|------|------|
| 前端 | JavaScript (ECharts), HTML/CSS |
| 桌面框架 | PySide6 (Qt WebEngine + WebChannel) |
| 后端 | Python (异步/多线程) |
| 数据库 | SQLite (SQLAlchemy ORM) |
| 数据源 | Tushare, Baostock, AkShare |
| 自动化 | PyAutoGUI |

## 项目结构

```
Tquant/
├── main.py               # 应用入口，QWebEngineView 加载前端
├── Tquant.html           # 单页应用 HTML
├── app/                  # PySide6 桌面层
│   ├── web_bridge.py     # Python ↔ JS 桥接 (QWebChannel)
│   ├── main_window.py    # 主窗口
│   └── settings.py       # 应用设置
├── backend/              # 核心逻辑
│   ├── db.py             # 数据库连接与查询
│   ├── data_feed.py      # K线数据供给
│   ├── strategy_engine.py      # 策略执行引擎
│   ├── backtest_executor.py    # 单股回测
│   ├── multi_backtest_executor.py # 多股回测
│   ├── stock_screener.py      # 股票筛选
│   ├── realtime_strategy_engine.py  # 实时策略引擎
│   ├── auto_trader.py          # 自动交易
│   └── data_updater/           # 数据更新模块
├── js/                   # 前端 JS 模块
│   ├── main.js           # 应用入口
│   ├── chartRenderer.js  # K线图表渲染
│   ├── strategyBuilder.js      # 策略构建器
│   ├── stockScreener.js        # 筛选器界面
│   ├── indicators.js           # 技术指标计算
│   └── kline.js                # K线数据结构
├── strategies/           # 策略 JSON 配置
├── docs/                 # 设计文档与计划
├── tests/                # 测试
└── scripts/              # 工具脚本
```

## 快速开始

### 环境要求

- Python 3.12+
- Windows（PySide6 桌面应用）

### 安装

```bash
git clone https://github.com/TTL-966/tquant.git
cd tquant
python -m venv .venv
source .venv/Scripts/activate  # Windows
pip install -r requirements.txt
```

### 配置

复制配置模板并填入你的 Tushare token：

```bash
cp config.example.json config.json
```

编辑 `config.json`，将 `YOUR_TUSHARE_TOKEN_HERE` 替换为你的 [Tushare](https://tushare.pro) token。

### 运行

```bash
python main.py
```

## 免责声明

本软件仅供学习与研究使用。量化交易涉及风险，使用者需自行承担交易结果。
