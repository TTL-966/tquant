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

function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
    // cleanup before rebuild
    if (_treemapChart) { _treemapChart.dispose(); _treemapChart = null; }
    if (_realtimeTimer) { clearInterval(_realtimeTimer); _realtimeTimer = null; }

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
        return '<div style="background:#0e1220;border:1px solid #2a3145;border-radius:8px;padding:12px;text-align:center;cursor:pointer;" onclick="window._showSectorDetail && window._showSectorDetail(\'' + escapeAttr(c.name) + '\')">' +
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
        return '<tr style="border-bottom:1px solid #1a2135;cursor:pointer;" onclick="window._showSectorDetail && window._showSectorDetail(\'' + escapeAttr(s.name) + '\')">' +
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
        var stocks = (data.stocks || []).slice(0, 20);

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
