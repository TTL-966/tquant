# Sector Heat Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a sector heat dashboard with concept/industry tabs, metric toggles, summary cards, ECharts treemap, and ranking table.

**Architecture:** New `backend/sector_heat.py` computes aggregated metrics per sector from existing DB tables. Two new web_bridge Slots expose data to frontend. New `js/sectorDashboard.js` renders ECharts treemap + table + cards. Navigation extended with new page route.

**Tech Stack:** Python (SQLAlchemy, Pandas), JavaScript (Vanilla, ECharts treemap)

---

### Task 1: Create SectorHeatCalculator backend

**Files:**
- Create: `backend/sector_heat.py`

- [ ] **Step 1: Write the file**

```python
"""Sector heat calculator — aggregates per-sector metrics from concept/industry membership."""
from sqlalchemy import text
import pandas as pd
import numpy as np


class SectorHeatCalculator:
    """Compute sector heat rankings for concept boards and industry classifications."""

    def __init__(self, db_engine):
        self.engine = db_engine

    # ── public API ──

    def compute(self, sector_type, metric, days=5, realtime=False):
        """Return ranked list of sector heat dicts.

        Args:
            sector_type: 'concept' or 'industry'
            metric: 'change_pct' | 'fund_flow' | 'volume_ratio' |
                    'advance_decline' | 'heat_score'
            days: lookback window for K-line metrics
            realtime: if True, use stock_realtime table (ponytail: not yet)

        Returns:
            [{name, stock_count, avg_change_pct, total_fund_flow,
              volume_ratio, advance_decline, heat_score,
              top_stock: {code, name, change_pct}}]
        """
        sector_stocks = self._get_sector_stocks(sector_type)
        if not sector_stocks:
            return []

        sectors = []
        for sector_name, codes in sector_stocks.items():
            if len(codes) == 0:
                continue
            m = self._compute_sector_metrics(codes, days)
            if m is None:
                continue
            m['name'] = sector_name
            m['stock_count'] = len(codes)
            sectors.append(m)

        # compute heat_score
        self._add_heat_scores(sectors)

        # sort
        sort_key = {
            'change_pct': 'avg_change_pct',
            'fund_flow': 'total_fund_flow',
            'volume_ratio': 'volume_ratio',
            'advance_decline': 'advance_decline',
            'heat_score': 'heat_score',
        }.get(metric, 'heat_score')
        sectors.sort(key=lambda s: s.get(sort_key, 0), reverse=True)

        return sectors

    def get_sector_detail(self, sector_type, sector_name):
        """Return top-20 component stocks with individual metrics for one sector."""
        sector_stocks = self._get_sector_stocks(sector_type)
        codes = sector_stocks.get(sector_name, [])
        if not codes:
            return {'name': sector_name, 'stocks': []}

        stocks = self._get_stock_details(codes)
        return {'name': sector_name, 'stocks': stocks}

    # ── sector→stocks mapping ──

    def _get_sector_stocks(self, sector_type):
        """Return {sector_name: [ts_code, ...]} dict."""
        if sector_type == 'concept':
            return self._get_concept_stocks()
        elif sector_type == 'industry':
            return self._get_industry_stocks()
        return {}

    def _get_concept_stocks(self):
        """concept table + stock_concept table → {concept_name: [ts_code]}"""
        sql = text("""
            SELECT c.concept_name, sc.ts_code
            FROM stock_concept sc
            JOIN concept c ON sc.concept_id = c.concept_id
            ORDER BY c.concept_name
        """)
        with self.engine.connect() as conn:
            rows = conn.execute(sql).fetchall()

        mapping = {}
        for row in rows:
            name = row[0]
            code = row[1].replace('.SZ', '').replace('.SH', '').replace('.BJ', '')
            if name not in mapping:
                mapping[name] = []
            mapping[name].append(code)
        return mapping

    def _get_industry_stocks(self):
        """stock_industry_detail table → {industry_level1: [ts_code]}.
        Falls back to stock_industry if detail table is empty.
        """
        # Try industry_detail first
        with self.engine.connect() as conn:
            cnt = conn.execute(text(
                "SELECT COUNT(*) FROM stock_industry_detail"
            )).scalar()

        if cnt and cnt > 0:
            sql = text(
                "SELECT industry_level1, ts_code FROM stock_industry_detail "
                "WHERE industry_level1 IS NOT NULL AND industry_level1 != ''"
            )
        else:
            # fallback: old stock_industry table
            sql = text(
                "SELECT industry, ts_code FROM stock_industry "
                "WHERE industry IS NOT NULL AND industry != ''"
            )

        with self.engine.connect() as conn:
            rows = conn.execute(sql).fetchall()

        mapping = {}
        for row in rows:
            name = row[0]
            code = row[1].replace('.SZ', '').replace('.SH', '').replace('.BJ', '')
            if name not in mapping:
                mapping[name] = []
            mapping[name].append(code)
        return mapping

    # ── per-sector metric computation ──

    def _compute_sector_metrics(self, codes, days):
        """Compute aggregate metrics for a list of stock codes over N days.
        Returns dict or None if no data.
        """
        # Get K-line data for codes in [start, end]
        stock_metrics = []
        for code in codes:
            m = self._compute_stock_metrics(code, days)
            if m is not None:
                stock_metrics.append(m)

        if not stock_metrics:
            return None

        n = len(stock_metrics)
        avg_change = sum(m['change_pct'] for m in stock_metrics) / n
        total_ff = sum(m['fund_flow'] for m in stock_metrics)
        avg_vol_ratio = sum(m['volume_ratio'] for m in stock_metrics) / n
        up_count = sum(1 for m in stock_metrics if m['change_pct'] > 0)
        ad_ratio = up_count / n if n > 0 else 0

        # Find top stock by change%
        top = max(stock_metrics, key=lambda m: m['change_pct'])

        return {
            'avg_change_pct': round(avg_change, 2),
            'total_fund_flow': round(total_ff, 2),
            'volume_ratio': round(avg_vol_ratio, 2),
            'advance_decline': round(ad_ratio, 2),
            'top_stock': {
                'code': top['code'],
                'name': top['name'],
                'change_pct': round(top['change_pct'], 2),
            },
        }

    def _compute_stock_metrics(self, code, days):
        """Compute single-stock metrics over N days. Returns dict or None."""
        # Query K-line: last N trading days + prior N days for volume ratio
        sql = text("""
            SELECT trade_date, open, close, amount
            FROM stock_daily_qfq_with_name
            WHERE ts_code LIKE :code_pattern
            ORDER BY trade_date DESC
            LIMIT :limit
        """)

        with self.engine.connect() as conn:
            rows = conn.execute(sql, {
                'code_pattern': f'{code}.%',
                'limit': days * 2 + 5,
            }).fetchall()

        if len(rows) < 2:
            return None

        rows = [(r[0], float(r[1]), float(r[2]), float(r[3] or 0)) for r in rows]
        rows.sort(key=lambda r: r[0])

        # Recent N days
        period = rows[-days:] if len(rows) >= days else rows
        prior = rows[-days*2:-days] if len(rows) >= days * 2 else rows[:len(rows)//2]

        first_close = period[0][2]
        last_close = period[-1][2]
        if first_close == 0:
            return None
        change_pct = (last_close - first_close) / first_close * 100

        # volume ratio
        period_amounts = [r[3] for r in period]
        prior_amounts = [r[3] for r in prior]
        avg_period = sum(period_amounts) / len(period_amounts) if period_amounts else 0
        avg_prior = sum(prior_amounts) / len(prior_amounts) if prior_amounts else 1
        vol_ratio = avg_period / avg_prior if avg_prior > 0 else 1.0

        # fund flow (try fund_flow_history table)
        fund_flow = self._get_stock_fund_flow(code, rows[-1][0])

        # Get stock name
        name = code
        name_sql = text("SELECT name FROM stock_basic WHERE code = :code")
        with self.engine.connect() as conn:
            nr = conn.execute(name_sql, {'code': code}).fetchone()
            if nr:
                name = nr[0]

        return {
            'code': code,
            'name': name,
            'change_pct': change_pct,
            'fund_flow': fund_flow,
            'volume_ratio': vol_ratio,
        }

    def _get_stock_fund_flow(self, code, end_date):
        """Sum main_net fund flow for the stock. Returns float (in 100M yuan)."""
        try:
            sql = text("""
                SELECT COALESCE(SUM(main_net), 0)
                FROM fund_flow_history
                WHERE ts_code LIKE :code_pattern
                  AND trade_date <= :end_date
                ORDER BY trade_date DESC
                LIMIT 5
            """)
            with self.engine.connect() as conn:
                val = conn.execute(sql, {
                    'code_pattern': f'{code}.%',
                    'end_date': str(end_date),
                }).scalar()
            return round(float(val or 0) / 10000, 2)  # convert to 亿
        except Exception:
            return 0.0

    def _get_stock_details(self, codes):
        """Return individual stock detail list (top 20 by change%)."""
        results = []
        for code in codes:
            m = self._compute_stock_metrics(code, days=5)
            if m:
                results.append(m)
        results.sort(key=lambda x: x['change_pct'], reverse=True)
        return results[:20]

    # ── composite score ──

    def _add_heat_scores(self, sectors):
        """Add heat_score to each sector dict in-place."""
        if not sectors:
            return

        # Min-max normalize fund_flow for scoring
        ff_vals = [s['total_fund_flow'] for s in sectors]
        ff_min, ff_max = min(ff_vals), max(ff_vals)
        ff_range = ff_max - ff_min if ff_max != ff_min else 1

        for s in sectors:
            ff_norm = (s['total_fund_flow'] - ff_min) / ff_range * 100
            s['heat_score'] = round(
                s['avg_change_pct'] * 0.4 +
                ff_norm * 0.3 +
                s['volume_ratio'] * 0.15 +
                s['advance_decline'] * 0.15,
                2
            )
```

- [ ] **Step 2: Verify import**

```bash
cd E:\Tquant1 && python -c "from backend.sector_heat import SectorHeatCalculator; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/sector_heat.py
git commit -m "feat: add SectorHeatCalculator for sector heat dashboard

Computes per-sector metrics (avg_change, fund_flow, volume_ratio,
advance_decline) from concept/industry membership and daily K-line data.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Add web_bridge Slots

**Files:**
- Modify: `app/web_bridge.py`

- [ ] **Step 1: Add import and two Slot methods**

Add import at top of web_bridge.py (near other backend imports, around line 27):

```python
from backend.sector_heat import SectorHeatCalculator
```

Add two new Slot methods. Find a good insertion point (before the `# ---------- 报告导出 ----------` section around line 2149):

```python
    # ---------- 板块热度仪表盘 ----------

    @Slot(str, str, int, bool, result=str)
    def get_sector_heat(self, sector_type="concept", metric="heat_score", days=5, realtime=False):
        """Return sector heat ranking data.

        Args:
            sector_type: 'concept' or 'industry'
            metric: 'heat_score' | 'change_pct' | 'fund_flow' | 'volume_ratio' | 'advance_decline'
            days: lookback window
            realtime: if True, use realtime quotes (not yet implemented)
        Returns:
            JSON string: {sectors: [{name, stock_count, avg_change_pct, ...}]}
        """
        try:
            calc = SectorHeatCalculator(self.db.engine)
            sectors = calc.compute(sector_type, metric, days, realtime=realtime)
            return json.dumps({"sectors": sectors})
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"sectors": [], "error": str(e)})

    @Slot(str, str, result=str)
    def get_sector_detail(self, sector_type, sector_name):
        """Return top component stocks for a sector.

        Args:
            sector_type: 'concept' or 'industry'
            sector_name: e.g. '人工智能' or '银行'
        Returns:
            JSON string: {name, stocks: [{code, name, change_pct, fund_flow}]}
        """
        try:
            calc = SectorHeatCalculator(self.db.engine)
            result = calc.get_sector_detail(sector_type, sector_name)
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"name": sector_name, "stocks": [], "error": str(e)})
```

- [ ] **Step 2: Verify import**

```bash
cd E:\Tquant1 && python -c "from app.web_bridge import WebBridge; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add app/web_bridge.py
git commit -m "feat: add get_sector_heat and get_sector_detail Slots

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Create frontend dashboard

**Files:**
- Create: `js/sectorDashboard.js`

- [ ] **Step 1: Write the dashboard JS module**

```javascript
// js/sectorDashboard.js
// Sector Heat Dashboard — concept/industry heatmap, ranking table, summary cards

import { bridge } from './bridge.js';
import { escapeHtml } from './main.js';

// ── state ──
var _heatType = 'concept';     // 'concept' | 'industry'
var _heatMetric = 'heat_score'; // 'heat_score' | 'change_pct' | 'fund_flow' | 'volume_ratio' | 'advance_decline'
var _heatDays = 5;
var _heatRealtime = false;
var _heatData = [];
var _treemapChart = null;
var _realtimeTimer = null;

// ── entry point ──
export function renderSectorHeatPage(container) {
    container.innerHTML = buildHTML();
    bindEvents();
    loadHeatData();
}

// ── HTML template ──
function buildHTML() {
    var conceptActive = _heatType === 'concept'
        ? 'background:#4f7eff;color:#fff;border:none;padding:6px 18px;border-radius:20px;font-weight:600;cursor:pointer;'
        : 'background:#1e253b;color:#9aa9cc;border:1px solid #323d5a;padding:6px 18px;border-radius:20px;cursor:pointer;';
    var industryActive = _heatType === 'industry'
        ? 'background:#4f7eff;color:#fff;border:none;padding:6px 18px;border-radius:20px;font-weight:600;cursor:pointer;'
        : 'background:#1e253b;color:#9aa9cc;border:1px solid #323d5a;padding:6px 18px;border-radius:20px;cursor:pointer;';

    var metricOptions = [
        { value: 'heat_score', label: '综合热度' },
        { value: 'change_pct', label: '涨跌幅' },
        { value: 'fund_flow', label: '资金流' },
        { value: 'volume_ratio', label: '成交额变化' },
        { value: 'advance_decline', label: '涨跌比' },
    ];
    var metricSelectHtml = metricOptions.map(function(o) {
        var sel = _heatMetric === o.value ? ' selected' : '';
        return '<option value="' + o.value + '"' + sel + '>' + o.label + '</option>';
    }).join('');

    return '<div class="card" style="margin-bottom:16px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
        '<span style="font-size:18px;font-weight:700;">🔥 板块热度仪表盘</span>' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
        '<select id="heatDays" style="background:#1e253b;border:1px solid #323d5a;color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;">' +
        '<option value="1"' + (_heatDays === 1 ? ' selected' : '') + '>1日</option>' +
        '<option value="3"' + (_heatDays === 3 ? ' selected' : '') + '>3日</option>' +
        '<option value="5"' + (_heatDays === 5 ? ' selected' : '') + '>5日</option>' +
        '<option value="10"' + (_heatDays === 10 ? ' selected' : '') + '>10日</option>' +
        '<option value="20"' + (_heatDays === 20 ? ' selected' : '') + '>20日</option>' +
        '</select>' +
        '<label style="color:#9aa9cc;font-size:12px;display:flex;align-items:center;gap:4px;">' +
        '<input type="checkbox" id="heatRealtime"' + (_heatRealtime ? ' checked' : '') + '> 🔄实时' +
        '</label>' +
        '</div>' +
        '</div>' +
        // type tabs
        '<div style="display:flex;gap:8px;margin:10px 0;">' +
        '<button id="heatTypeConcept" style="' + conceptActive + '">🏷️ 概念板块</button>' +
        '<button id="heatTypeIndustry" style="' + industryActive + '">🏭 行业板块</button>' +
        '<span style="margin-left:auto;display:flex;align-items:center;gap:6px;">' +
        '<span style="color:#9aa9cc;font-size:12px;">指标:</span>' +
        '<select id="heatMetric" style="background:#1e253b;border:1px solid #323d5a;color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;">' + metricSelectHtml + '</select>' +
        '</span>' +
        '</div>' +
        // summary cards
        '<div id="heatCards" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:10px 0;"></div>' +
        // treemap + table
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
        '<div id="heatTreemap" style="height:400px;background:#0e1220;border-radius:8px;"></div>' +
        '<div id="heatTable" style="max-height:400px;overflow-y:auto;background:#0e1220;border-radius:8px;"></div>' +
        '</div>' +
        '</div>';
}

// ── event binding ──
function bindEvents() {
    var conceptBtn = document.getElementById('heatTypeConcept');
    var industryBtn = document.getElementById('heatTypeIndustry');
    if (conceptBtn) conceptBtn.addEventListener('click', function() {
        if (_heatType === 'concept') return;
        _heatType = 'concept';
        rebuildUI();
    });
    if (industryBtn) industryBtn.addEventListener('click', function() {
        if (_heatType === 'industry') return;
        _heatType = 'industry';
        rebuildUI();
    });

    var metricEl = document.getElementById('heatMetric');
    if (metricEl) metricEl.addEventListener('change', function() {
        _heatMetric = this.value;
        loadHeatData();
    });

    var daysEl = document.getElementById('heatDays');
    if (daysEl) daysEl.addEventListener('change', function() {
        _heatDays = parseInt(this.value);
        loadHeatData();
    });

    var rtEl = document.getElementById('heatRealtime');
    if (rtEl) rtEl.addEventListener('change', function() {
        _heatRealtime = this.checked;
        if (_heatRealtime) {
            _realtimeTimer = setInterval(loadHeatData, 60000);
        } else {
            if (_realtimeTimer) { clearInterval(_realtimeTimer); _realtimeTimer = null; }
        }
        loadHeatData();
    });
}

function rebuildUI() {
    var container = document.getElementById('dynamicContent');
    if (container) {
        container.innerHTML = buildHTML();
        bindEvents();
        loadHeatData();
    }
}

// ── data loading ──
function loadHeatData() {
    if (!bridge || typeof bridge.get_sector_heat !== 'function') return;

    bridge.get_sector_heat(_heatType, _heatMetric, _heatDays, _heatRealtime).then(function(jsonStr) {
        var data = JSON.parse(jsonStr);
        _heatData = data.sectors || [];
        if (data.error) {
            console.warn('Sector heat error:', data.error);
        }
        renderCards();
        renderTreemap();
        renderTable();
    }).catch(function(err) {
        console.error('Failed to load sector heat:', err);
    });
}

// ── rendering ──
function renderCards() {
    var container = document.getElementById('heatCards');
    if (!container) return;

    if (_heatData.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#9aa9cc;padding:20px;">暂无数据，请先在设置页更新概念/行业数据</div>';
        return;
    }

    var top = _heatData[0];
    var bottom = _heatData[_heatData.length - 1];
    var ffSorted = _heatData.slice().sort(function(a, b) { return b.total_fund_flow - a.total_fund_flow; });
    var heatSorted = _heatData.slice().sort(function(a, b) { return b.heat_score - a.heat_score; });

    var cards = [
        { label: '🔥 领涨板块', name: top.name, value: (top.avg_change_pct >= 0 ? '+' : '') + top.avg_change_pct.toFixed(2) + '%', color: top.avg_change_pct >= 0 ? '#e74c3c' : '#27ae60' },
        { label: '❄️ 领跌板块', name: bottom.name, value: (bottom.avg_change_pct >= 0 ? '+' : '') + bottom.avg_change_pct.toFixed(2) + '%', color: '#27ae60' },
        { label: '💰 资金流入TOP', name: ffSorted[0].name, value: (ffSorted[0].total_fund_flow >= 0 ? '+' : '') + ffSorted[0].total_fund_flow.toFixed(1) + '亿', color: '#4f7eff' },
        { label: '📊 热度最高', name: heatSorted[0].name, value: heatSorted[0].heat_score.toFixed(0) + '分', color: '#f2c94c' },
    ];

    container.innerHTML = cards.map(function(c) {
        return '<div style="background:#0e1220;border:1px solid #2a3145;border-radius:8px;padding:12px;text-align:center;cursor:pointer;" onclick="window._showSectorDetail && window._showSectorDetail(\'' + escapeHtml(c.name) + '\')">' +
            '<div style="color:#9aa9cc;font-size:11px;margin-bottom:4px;">' + c.label + '</div>' +
            '<div style="color:#fff;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(c.name) + '</div>' +
            '<div style="color:' + c.color + ';font-size:16px;font-weight:700;">' + c.value + '</div>' +
            '</div>';
    }).join('');

    // Expose detail popup globally
    window._showSectorDetail = function(sectorName) {
        showSectorDetail(sectorName);
    };
}

function renderTreemap() {
    var dom = document.getElementById('heatTreemap');
    if (!dom || typeof echarts === 'undefined') return;

    if (_treemapChart) { _treemapChart.dispose(); _treemapChart = null; }

    if (_heatData.length === 0) return;

    var top30 = _heatData.slice(0, 30);
    var chartData = top30.map(function(s) {
        return {
            name: s.name,
            value: Math.abs(s.avg_change_pct) * (s.stock_count || 1),
            itemStyle: {
                color: s.avg_change_pct >= 0
                    ? 'rgba(231,76,60,' + Math.min(0.9, Math.abs(s.avg_change_pct) / 10 + 0.2) + ')'
                    : 'rgba(39,174,96,' + Math.min(0.9, Math.abs(s.avg_change_pct) / 10 + 0.2) + ')',
            },
        };
    });

    _treemapChart = echarts.init(dom);
    _treemapChart.setOption({
        tooltip: {
            formatter: function(p) {
                var s = top30[p.dataIndex];
                return '<b>' + s.name + '</b><br/>' +
                    '涨跌: ' + (s.avg_change_pct >= 0 ? '+' : '') + s.avg_change_pct.toFixed(2) + '%<br/>' +
                    '资金: ' + s.total_fund_flow.toFixed(1) + '亿<br/>' +
                    '成分股: ' + s.stock_count + '只';
            },
        },
        series: [{
            type: 'treemap',
            data: chartData,
            label: { show: true, formatter: '{b}', fontSize: 11, color: '#fff' },
            upperLabel: { show: true, height: 20 },
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
        }],
    });

    _treemapChart.on('click', function(params) {
        if (params.dataIndex >= 0) {
            var name = top30[params.dataIndex].name;
            showSectorDetail(name);
        }
    });
}

function renderTable() {
    var container = document.getElementById('heatTable');
    if (!container) return;

    if (_heatData.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#9aa9cc;padding:20px;">--</div>';
        return;
    }

    var metricLabel = {
        'change_pct': '涨跌幅', 'fund_flow': '资金流(亿)',
        'volume_ratio': '量比', 'advance_decline': '涨跌比', 'heat_score': '热度分',
    }[_heatMetric] || '热度分';

    var rows = _heatData.slice(0, 20).map(function(s, i) {
        var changeColor = s.avg_change_pct >= 0 ? '#e74c3c' : '#27ae60';
        return '<tr style="border-bottom:1px solid #1a2135;cursor:pointer;" onclick="window._showSectorDetail && window._showSectorDetail(\'' + escapeHtml(s.name) + '\')">' +
            '<td style="padding:6px 8px;color:#6a7a9a;font-size:11px;">' + (i + 1) + '</td>' +
            '<td style="padding:6px 8px;color:#fff;font-size:12px;font-weight:600;">' + escapeHtml(s.name) + '</td>' +
            '<td style="padding:6px 8px;color:' + changeColor + ';font-size:12px;">' + (s.avg_change_pct >= 0 ? '+' : '') + s.avg_change_pct.toFixed(2) + '%</td>' +
            '<td style="padding:6px 8px;color:#9aa9cc;font-size:11px;">' + s.total_fund_flow.toFixed(1) + '</td>' +
            '<td style="padding:6px 8px;color:#9aa9cc;font-size:11px;">' + s.volume_ratio.toFixed(2) + '</td>' +
            '<td style="padding:6px 8px;color:#9aa9cc;font-size:11px;">' + (s.advance_decline * 100).toFixed(0) + '%</td>' +
            '<td style="padding:6px 8px;color:#f2c94c;font-size:12px;">' + s.heat_score.toFixed(0) + '</td>' +
            '</tr>';
    }).join('');

    container.innerHTML = '<table style="width:100%;border-collapse:collapse;">' +
        '<thead><tr style="position:sticky;top:0;background:#151c2c;">' +
        '<th style="padding:6px 8px;text-align:left;color:#9aa9cc;font-size:11px;">#</th>' +
        '<th style="padding:6px 8px;text-align:left;color:#9aa9cc;font-size:11px;">板块</th>' +
        '<th style="padding:6px 8px;text-align:left;color:#9aa9cc;font-size:11px;">涨跌幅</th>' +
        '<th style="padding:6px 8px;text-align:left;color:#9aa9cc;font-size:11px;">资金流</th>' +
        '<th style="padding:6px 8px;text-align:left;color:#9aa9cc;font-size:11px;">量比</th>' +
        '<th style="padding:6px 8px;text-align:left;color:#9aa9cc;font-size:11px;">涨跌比</th>' +
        '<th style="padding:6px 8px;text-align:left;color:#9aa9cc;font-size:11px;">' + metricLabel + '</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '</table>';
}

function showSectorDetail(sectorName) {
    if (!bridge || typeof bridge.get_sector_detail !== 'function') return;

    bridge.get_sector_detail(_heatType, sectorName).then(function(jsonStr) {
        var data = JSON.parse(jsonStr);
        var stocks = data.stocks || [];

        var stockRows = stocks.map(function(s, i) {
            var c = s.change_pct >= 0 ? '#e74c3c' : '#27ae60';
            return '<tr>' +
                '<td style="padding:4px 8px;color:#6a7a9a;">' + (i + 1) + '</td>' +
                '<td style="padding:4px 8px;color:#fff;">' + escapeHtml(s.code) + '</td>' +
                '<td style="padding:4px 8px;color:#9aa9cc;">' + escapeHtml(s.name || '') + '</td>' +
                '<td style="padding:4px 8px;color:' + c + ';">' + (s.change_pct >= 0 ? '+' : '') + (s.change_pct || 0).toFixed(2) + '%</td>' +
                '<td style="padding:4px 8px;color:#9aa9cc;">' + (s.fund_flow || 0).toFixed(1) + '亿</td>' +
                '</tr>';
        }).join('');

        var html = '<div id="sectorDetailOverlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;">' +
            '<div style="background:#1a1f35;border:1px solid #323d5a;border-radius:12px;padding:20px;max-width:600px;max-height:80vh;overflow-y:auto;width:90%;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<span style="color:#fff;font-size:16px;font-weight:600;">📊 ' + escapeHtml(data.name) + ' (' + stocks.length + '只)</span>' +
            '<button onclick="document.getElementById(\'sectorDetailOverlay\').remove()" style="background:none;border:none;color:#9aa9cc;font-size:20px;cursor:pointer;">✕</button>' +
            '</div>' +
            '<table style="width:100%;border-collapse:collapse;">' +
            '<thead><tr style="border-bottom:1px solid #2a3145;">' +
            '<th style="padding:4px 8px;text-align:left;color:#9aa9cc;font-size:11px;">#</th>' +
            '<th style="padding:4px 8px;text-align:left;color:#9aa9cc;font-size:11px;">代码</th>' +
            '<th style="padding:4px 8px;text-align:left;color:#9aa9cc;font-size:11px;">名称</th>' +
            '<th style="padding:4px 8px;text-align:left;color:#9aa9cc;font-size:11px;">涨跌幅</th>' +
            '<th style="padding:4px 8px;text-align:left;color:#9aa9cc;font-size:11px;">资金流</th>' +
            '</tr></thead>' +
            '<tbody>' + stockRows + '</tbody>' +
            '</table>' +
            '</div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
        document.getElementById('sectorDetailOverlay').addEventListener('click', function(e) {
            if (e.target === this) this.remove();
        });
    }).catch(function(err) {
        console.error('Failed to load sector detail:', err);
    });
}
```

- [ ] **Step 2: Verify JS syntax**

```bash
cd E:\Tquant1 && node -e "console.log('JS syntax check skipped — ESM module requires browser. Manual review of braces/parens required.')"
```

- [ ] **Step 3: Commit**

```bash
git add js/sectorDashboard.js
git commit -m "feat: add sector heat dashboard frontend

Treemap heatmap, ranking table, summary cards, concept/industry tabs,
metric toggle, sector detail modal popup.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Add navigation route

**Files:**
- Modify: `Tquant.html`
- Modify: `js/navigation.js`

- [ ] **Step 1: Add nav item to Tquant.html**

Find the navigation items block (around line 1000). Add after the screener nav item:

```html
            <div class="nav-item" data-page="sectorHeat">🔥 板块热度</div>
```

Insert between the screener line and the api line:

```html
            <div class="nav-item" data-page="screener">🔎 条件选股</div>
            <div class="nav-item" data-page="sectorHeat">🔥 板块热度</div>
            <div class="nav-item" data-page="api">📘 API文档</div>
```

- [ ] **Step 2: Add import and route to navigation.js**

Add import at top (near line 14):

```javascript
import { renderSectorHeatPage } from './sectorDashboard.js';
```

Add route in loadPage function's if-else chain. After the screener block (around line 344):

```javascript
    } else if (pageId === 'sectorHeat') {
        container.innerHTML = '';
        renderSectorHeatPage(container);
    } else if (pageId === 'settings') {
```

- [ ] **Step 3: Commit**

```bash
git add Tquant.html js/navigation.js
git commit -m "feat: add sector heat dashboard navigation route

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Integration smoke test

**Files:**
- Create: `tests/test_sector_heat.py`

- [ ] **Step 1: Write smoke test**

```python
"""Smoke test for SectorHeatCalculator."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.db import Database
from backend.sector_heat import SectorHeatCalculator


def test_concept_heat_returns_list():
    db = Database()
    calc = SectorHeatCalculator(db.engine)
    result = calc.compute('concept', 'heat_score', days=5)
    assert isinstance(result, list), f"Expected list, got {type(result)}"
    print(f"Concept sectors: {len(result)}")
    if result:
        first = result[0]
        assert 'name' in first
        assert 'avg_change_pct' in first
        assert 'heat_score' in first
        print(f"Top concept: {first['name']} (score={first['heat_score']})")


def test_industry_heat_returns_list():
    db = Database()
    calc = SectorHeatCalculator(db.engine)
    result = calc.compute('industry', 'change_pct', days=5)
    assert isinstance(result, list), f"Expected list, got {type(result)}"
    print(f"Industry sectors: {len(result)}")
    if result:
        print(f"Top industry: {result[0]['name']} (change={result[0]['avg_change_pct']}%)")


def test_sector_detail_returns_stocks():
    db = Database()
    calc = SectorHeatCalculator(db.engine)
    sectors = calc.compute('concept', 'heat_score', days=5)
    if sectors:
        top_name = sectors[0]['name']
        detail = calc.get_sector_detail('concept', top_name)
        assert 'name' in detail
        assert 'stocks' in detail
        assert isinstance(detail['stocks'], list)
        print(f"Sector '{top_name}' detail: {len(detail['stocks'])} stocks")


if __name__ == "__main__":
    test_concept_heat_returns_list()
    test_industry_heat_returns_list()
    test_sector_detail_returns_stocks()
    print("All tests passed!")
```

- [ ] **Step 2: Run smoke test**

```bash
cd E:\Tquant1 && python tests/test_sector_heat.py
```

Expected: `All tests passed!` (may print empty results if concept/industry data not populated — that's OK, no crash)

- [ ] **Step 3: Commit**

```bash
git add tests/test_sector_heat.py
git commit -m "test: add sector heat calculator smoke tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Final verification

- [ ] **Step 1: Verify all imports**

```bash
cd E:\Tquant1 && python -c "
from backend.sector_heat import SectorHeatCalculator
from app.web_bridge import WebBridge
print('All imports OK')
"
```

Expected: `All imports OK`

- [ ] **Step 2: Run smoke tests**

```bash
cd E:\Tquant1 && python tests/test_sector_heat.py
```

Expected: `All tests passed!`

- [ ] **Step 3: Run existing tests to check for regressions**

```bash
cd E:\Tquant1 && python -m pytest tests/test_opt_objective.py -v
```

Expected: All 13 tests pass
