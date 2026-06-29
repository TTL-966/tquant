# Sector Heat Dashboard Design

**Date:** 2026-06-29
**Status:** approved

## Summary

Visual dashboard showing real-time sector/concept heat rankings. Tabs toggle between concept boards and industry classifications. Users switch between metrics (change%, fund flow, volume ratio, advance/decline). Full dashboard: summary cards + ranking table + treemap heatmap.

## Architecture

```
Frontend (sectorDashboard.js)
  ├─ Tab toggle: [概念板块] [行业板块]
  ├─ Metric toggle: [涨跌幅▼] [资金流] [成交额变化] [涨跌比]
  ├─ 4 summary cards (top gainer, top loser, fund inflow top, highest heat)
  ├─ ECharts treemap (size=market_cap/volume, color=change%)
  └─ Ranking table (rank, name, change%, volume, fund flow, advance/decline, top stock)
       │ get_sector_heat(json)   │ get_sector_detail(json)
       ▼                         ▼
web_bridge.py
  Slot: get_sector_heat(type, metric, days, realtime=False)
  Slot: get_sector_detail(type, sector_name)
       │
       ▼
backend/sector_heat.py (NEW)
  SectorHeatCalculator:
    compute(type, metric, days) → [{name, stock_count, avg_change_pct,
      total_fund_flow, volume_ratio, advance_decline, heat_score, top_stock}]
  Data sources:
    - stock_concept JOIN concept (concept boards)
    - stock_industry (industry classifications)
    - daily_kline (OHLCV history)
    - fund_flow (capital flow, if available)
    - stock_realtime (optional realtime mode)
```

## Data Model

### Sector Heat Metrics

| Metric | Formula | Meaning |
|--------|---------|---------|
| `avg_change_pct` | mean of component stock N-day change% | overall direction |
| `total_fund_flow` | sum of component stock N-day net inflow (in 100M yuan) | capital heat |
| `volume_ratio` | avg N-day turnover / avg prior N-day turnover | volume expansion |
| `advance_decline` | stocks up / total stocks | breadth |

### Composite Heat Score (default sort)

```
heat_score = avg_change_pct × 0.4
           + normalized_fund_flow × 0.3
           + volume_ratio × 0.15
           + advance_decline × 0.15
```

When user selects specific metric, sort by that single dimension descending.

### API Contract

**`get_sector_heat(type, metric, days, realtime=False)`**
```json
{
  "sectors": [
    {
      "name": "人工智能", "stock_count": 156,
      "avg_change_pct": 3.2, "total_fund_flow": 12.5,
      "volume_ratio": 1.8, "advance_decline": 0.72,
      "heat_score": 85.3,
      "top_stock": { "code": "002230", "name": "科大讯飞", "change_pct": 8.5 }
    }
  ]
}
```

**`get_sector_detail(type, sector_name)`**
```json
{
  "name": "人工智能",
  "stocks": [
    { "code": "002230", "name": "科大讯飞", "change_pct": 8.5, "fund_flow": 1.2 }
  ]
}
```

## Frontend

### File: `js/sectorDashboard.js` (NEW)

- Single-page dashboard, loaded via `loadPage('sectorHeat')`
- State: `_heatType` ('concept'|'industry'), `_heatMetric` ('change_pct'|'fund_flow'|'volume_ratio'|'advance_decline'), `_heatDays` (5), `_heatRealtime` (false)
- `renderDashboard()`: builds entire HTML via innerHTML
- `loadHeatData()`: calls `bridge.get_sector_heat()`, re-renders
- `renderTreemap()`: ECharts treemap, size = avg volume, color = change%
- `renderTable()`: sortable ranking table
- `renderCards()`: 4 summary cards at top
- `showSectorDetail(sectorName)`: modal popup with top 20 component stocks
- Realtime mode: polling every 60s when enabled, only in market hours

### Navigation

Add to `Tquant.html`:
```html
<div class="nav-item" data-page="sectorHeat">🔥 板块热度</div>
```

Add route in `navigation.js` loadPage to load `sectorDashboard.js` and call render.

## Backend

### File: `backend/sector_heat.py` (NEW)

```python
class SectorHeatCalculator:
    def __init__(self, db_engine):
        self.engine = db_engine

    def compute(self, type, metric, days, realtime=False) -> list[dict]:
        """Compute sector heat ranking."""
        # 1. Get sector→stocks mapping
        # 2. For each sector, get K-line data for component stocks
        # 3. Compute per-stock metrics, aggregate to sector level
        # 4. Sort by metric or composite score
        # 5. Return top N sectors (all for concept, all for industry)

    def _get_sector_stocks(self, type) -> dict[str, list[str]]:
        """Return {sector_name: [ts_code, ...]}"""

    def get_sector_detail(self, type, sector_name) -> dict:
        """Return detailed stock list for one sector."""
```

### web_bridge.py changes

Two new slots:
- `get_sector_heat(type, metric, days, realtime)`: compute and return sector ranking
- `get_sector_detail(type, sector_name)`: return component stock list for one sector

### Data Sources

| Data | Source | Notes |
|------|--------|-------|
| Concept→stocks | `stock_concept` JOIN `concept` | Already populated by ConceptUpdater |
| Industry→stocks | `stock_industry` | Already populated by industry.py |
| K-line | `daily_kline` | Via DataFeed.get_kline_json() |
| Fund flow | `fund_flow` table | Via fund_flow_updater |
| Realtime | `stock_realtime` | Fallback to last close if not available |

### Performance

- `compute()` caches per-stock metrics in memory for the request duration
- Sector count: ~300 concepts, ~30 industries
- Each sector: 50-300 stocks → compute aggregation vectorized via pandas
- First load: ~2-5 seconds (300 concept × K-line queries)
- ponytail: naive loop per sector, add per-sector parallel/concurrent if >5s

## UI Layout

```
┌─────────────────────────────────────────────────┐
│ 🔥 板块热度仪表盘                    [日期间隔: 5日▼] [🔄实时] │
│                                                  │
│ [概念板块] [行业板块]    指标: [综合热度▼]          │
│                                                  │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│ │ 🔥 领涨  │ │ ❄️ 领跌  │ │ 💰 资金  │ │ 📊 最高  │ │
│ │ 人工智能  │ │ 房地产   │ │ 芯片    │ │ 热度    │ │
│ │ +3.2%   │ │ -2.1%   │ │ +12.5亿 │ │ 85分    │ │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │
│                                                  │
│ ┌──────────────────────┐ ┌──────────────────────┐│
│ │   ECharts Treemap    │ │   Top 20 排名表       ││
│ │   (热力色块)          │ │ # 板块    涨跌  资金   ││
│ │                      │ │ 1 AI     +3.2  12.5  ││
│ │  [AI] [芯片]          │ │ 2 芯片   +2.8  8.3   ││
│ │  [新能源] [医药]       │ │ 3 新能源 +2.1  6.7   ││
│ └──────────────────────┘ └──────────────────────┘│
└─────────────────────────────────────────────────┘
```

## Edge Cases

- **概念表为空**: 显示"请先在设置页更新概念数据"，提供跳转按钮
- **资金流数据缺失**: 资金流和热度综合分不可用，只显示涨跌幅+涨跌比
- **实时模式非交易时段**: 自动退回到日级数据，标注"非交易时段，显示最新日级数据"
- **板块成分股全部停牌/退市**: 跳过该板块，标记为0成分股
- **部门股票无K线**: 用已有数据计算，不因个别缺失跳过整个板块

## Not in Scope

- 个股级别的热度排序（现有条件选股已覆盖）
- 板块历史热度时间序列/趋势图
- 自定义板块（用户自建股票组合）
- 热度预警/推送通知
- 板块轮动分析
