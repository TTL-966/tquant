// js/stockScreener.js
// 条件选股页面 —— 可视化卡片 + 批量筛选 + 模板管理 + 导出 + 模拟交易

import { bridge } from './bridge.js';
import { CARD_TYPE_META } from './strategyTemplates.js';
import { bindDatePicker } from './datepicker.js';
import { escapeHtml, formatStockNameOnly } from './main.js';
import { navigateToKline } from './navigation.js';

// ── Module State ────────────────────────────────────────────────
var cards = [];
var selectedPool = 'all';
var customCodes = '';
var logicMode = 'AND';
var lastResults = [];

// Pagination
var PAGE_SIZE = 100;
var resultPage = 0;

// Pre-filter state (mirrors Strategy Factory pool selector)
var poolSource = 'all';
var poolCustomCodes = '';
var poolIndustryFilter = '';
var poolConceptFilter = [];
var poolConceptMatchMode = 'any';
var poolMarketCapMin = '';
var poolMarketCapMax = '';
var poolFloatSharesMin = '';
var poolFloatSharesMax = '';

// Dynamic options cache (loaded once on page init)
var conceptListCache = [];
var industryListCache = [];
var dynamicOptionsLoaded = false;

function loadDynamicOptions() {
    if (dynamicOptionsLoaded) return;
    dynamicOptionsLoaded = true; // mark early to avoid duplicate requests

    if (bridge && typeof bridge.get_concept_list === 'function') {
        bridge.get_concept_list().then(function (jsonStr) {
            try {
                var list = JSON.parse(jsonStr);
                if (Array.isArray(list)) {
                    conceptListCache = list.map(function (c) { return { value: c, label: c }; });
                    // update CARD_TYPE_META options reference
                    if (CARD_TYPE_META.concept_contains) {
                        CARD_TYPE_META.concept_contains.paramFields[0].options = conceptListCache;
                    }
                }
            } catch (e) { console.warn('[Screener] 加载概念列表失败', e); }
        }).catch(function (e) { console.warn('[Screener] 加载概念列表失败', e); });
    }

    if (bridge && typeof bridge.get_industry_list === 'function') {
        bridge.get_industry_list().then(function (jsonStr) {
            try {
                var list = JSON.parse(jsonStr);
                if (Array.isArray(list)) {
                    industryListCache = list.map(function (i) { return { value: i, label: i }; });
                    if (CARD_TYPE_META.industry_contains) {
                        CARD_TYPE_META.industry_contains.paramFields[0].options = industryListCache;
                    }
                }
            } catch (e) { console.warn('[Screener] 加载行业列表失败', e); }
        }).catch(function (e) { console.warn('[Screener] 加载行业列表失败', e); });
    }
}

// ── SessionStorage 持久化 ──────────────────────────────────────

function saveScreenerState() {
    var state = {
        cards: cards,
        selectedPool: selectedPool,
        customCodes: customCodes,
        logicMode: logicMode,
        lastResults: lastResults,
        resultPage: resultPage,
        poolSource: poolSource,
        poolCustomCodes: poolCustomCodes,
        poolIndustryFilter: poolIndustryFilter,
        poolConceptFilter: poolConceptFilter,
        poolConceptMatchMode: poolConceptMatchMode,
        poolMarketCapMin: poolMarketCapMin,
        poolMarketCapMax: poolMarketCapMax,
        poolFloatSharesMin: poolFloatSharesMin,
        poolFloatSharesMax: poolFloatSharesMax
    };
    try {
        sessionStorage.setItem('tquant_screener_state', JSON.stringify(state));
    } catch (e) {}
}

function loadScreenerState() {
    var saved = sessionStorage.getItem('tquant_screener_state');
    if (!saved) return false;
    try {
        var state = JSON.parse(saved);
        cards = state.cards || [];
        selectedPool = state.selectedPool || 'all';
        customCodes = state.customCodes || '';
        logicMode = state.logicMode || 'AND';
        lastResults = state.lastResults || [];
        resultPage = state.resultPage || 0;
        poolSource = state.poolSource || 'all';
        poolCustomCodes = state.poolCustomCodes || '';
        poolIndustryFilter = state.poolIndustryFilter || '';
        poolConceptFilter = state.poolConceptFilter || [];
        poolConceptMatchMode = state.poolConceptMatchMode || 'any';
        poolMarketCapMin = state.poolMarketCapMin || '';
        poolMarketCapMax = state.poolMarketCapMax || '';
        poolFloatSharesMin = state.poolFloatSharesMin || '';
        poolFloatSharesMax = state.poolFloatSharesMax || '';
        return true;
    } catch (e) { return false; }
}

// ── Public ──────────────────────────────────────────────────────

export function renderScreenerPage(container) {
    // 尝试恢复上次的筛选条件和结果
    var restored = loadScreenerState();
    if (!restored) {
        cards = [];
        selectedPool = 'all';
        customCodes = '';
        logicMode = 'AND';
        lastResults = [];
        resultPage = 0;
    }

    var today = new Date();
    var endDateStr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
    // 默认起始日期为结束日期前推 7 个自然日（约 5 个交易日）
    var startDt = new Date(today);
    startDt.setDate(startDt.getDate() - 7);
    var startDateStr = startDt.getFullYear() + '-' +
        String(startDt.getMonth() + 1).padStart(2, '0') + '-' +
        String(startDt.getDate()).padStart(2, '0');

    container.innerHTML = `
        <div class="card">
            <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
                <span>🔎 条件选股</span>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button id="screenerSaveTplBtn" style="background:#2a3a5a;font-size:12px;padding:4px 12px;">💾 保存模板</button>
                    <select id="screenerLoadTplSelect" style="display:none;">
                        <option value="">-- 加载模板 --</option>
                    </select>
                    <input id="screenerLoadTplInput" type="text" readonly value="-- 加载模板 --"
                        style="background:#1e253b;border:1px solid #323d5a;
                        border-radius:8px;color:#fff;padding:4px 8px;font-size:12px;max-width:160px;cursor:pointer;">
                    <button id="screenerDelTplBtn" style="background:#3d2020;font-size:12px;padding:4px 10px;"
                        title="删除当前选中的模板">🗑️</button>
                </div>
            </div>
            <p style="color:#9aa9cc; margin-bottom:16px;">
                设置技术指标条件，从全市场或指定股票池中筛选符合条件的股票。可按条件模板保存和加载。
            </p>

            <!-- ── 股票池预筛选（折叠面板） ── -->
            <div class="card" style="margin-bottom:12px;background:#0e1220;border:1px solid #323d5a;border-radius:12px;padding:12px 16px;">
            <div id="screenerPrefilterHeader" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
            <span style="color:#fff;font-weight:600;font-size:14px;">📦 股票池预筛选</span>
            <span id="screenerPrefilterToggle" style="color:#9aa9cc;font-size:12px;">▲ 折叠</span>
            </div>
            <div id="screenerPrefilterBody">
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 8px;">
            <label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="all"' + (poolSource === 'all' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 全市场</label>
            <label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="hs300"' + (poolSource === 'hs300' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 沪深300</label>
            <label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="zz500"' + (poolSource === 'zz500' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 中证500</label>
            <label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="zz1000"' + (poolSource === 'zz1000' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 中证1000</label>
            <label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="cyb"' + (poolSource === 'cyb' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 创业板</label>
            <label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="kc50"' + (poolSource === 'kc50' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 科创50</label>
            <label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="custom"' + (poolSource === 'custom' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 自定义</label>
            </div>
            <textarea id="poolCustomCodes" rows="2" placeholder="输入股票代码，每行一个或用逗号分隔"
            style="display:' + (poolSource === 'custom' ? 'block' : 'none') + ';width:100%;background:#1e253b;border:1px solid #323d5a;border-radius:12px;color:#fff;padding:6px 10px;font-size:12px;font-family:monospace;resize:vertical;box-sizing:border-box;margin-bottom:8px;">' + escapeHtml(poolCustomCodes) + '</textarea>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span style="color:#9aa9cc;font-size:11px;">筛选:</span>
            <span style="color:#7a8ba8;font-size:10px;">总市值(亿)</span>
            <input id="poolMarketCapMin" type="number" min="0" step="1" placeholder="最小" value="' + escapeHtml(poolMarketCapMin) + '"
            style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;">
            <span style="color:#7a8ba8;font-size:10px;">-</span>
            <input id="poolMarketCapMax" type="number" min="0" step="1" placeholder="最大" value="' + escapeHtml(poolMarketCapMax) + '"
            style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;">
            <span style="color:#7a8ba8;font-size:10px;">股本(亿股)</span>
            <input id="poolFloatSharesMin" type="number" min="0" step="0.1" placeholder="最小" value="' + escapeHtml(poolFloatSharesMin) + '"
            style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;">
            <span style="color:#7a8ba8;font-size:10px;">-</span>
            <input id="poolFloatSharesMax" type="number" min="0" step="0.1" placeholder="最大" value="' + escapeHtml(poolFloatSharesMax) + '"
            style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;">
            <select id="poolIndustryFilter" style="display:none;">
            <option value="">-- 行业(可选) --</option>
            </select>
            <input id="poolIndustryFilterInput" type="text" readonly placeholder="-- 行业(可选) --"
            style="background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 10px;font-size:11px;max-width:160px;cursor:pointer;">
            <input id="poolConceptSearch" type="text" placeholder="搜索概念..."
            style="width:110px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 10px;font-size:11px;">
            <select id="poolConceptFilter" multiple size="3"
            style="min-width:160px;max-width:240px;background:#1e253b;border:1px solid #323d5a;border-radius:8px;color:#fff;font-size:11px;padding:2px;"></select>
            <select id="poolConceptMatchMode" style="display:none;">
            <option value="any"' + (poolConceptMatchMode === 'any' ? ' selected' : '') + '>任一</option>
            <option value="all"' + (poolConceptMatchMode === 'all' ? ' selected' : '') + '>全部</option>
            </select>
            <input id="poolConceptMatchModeInput" type="text" readonly
            value="' + (poolConceptMatchMode === 'all' ? '全部' : '任一') + '"
            style="background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;cursor:pointer;">
            <span id="poolConceptCount" style="color:#9aa9cc;font-size:11px;"></span>
            <button id="poolResetFiltersBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;padding:3px 10px;border-radius:20px;font-size:11px;cursor:pointer;">重置</button>
            </div>
            <div style="margin-top:4px;color:#9aa9cc;font-size:11px;">
            <span id="poolPreviewText" style="color:#7a8ba8;">--</span>
            </div>
            </div>
            </div>

            <!-- 日期 / 逻辑 -->
            <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end; margin-bottom:16px;">

                <div style="min-width:150px;">
                    <label style="color:#9aa9cc;font-size:12px;display:block;margin-bottom:4px;">起始日期</label>
                    <input id="screenerStartDate" type="text" value="${startDateStr}" placeholder="YYYY-MM-DD"
                        style="width:100%;background:#1e253b;border:1px solid #323d5a;border-radius:8px;
                        color:#fff;padding:8px 10px;font-size:13px;box-sizing:border-box;cursor:pointer;">
                </div>

                <div style="min-width:150px;">
                    <label style="color:#9aa9cc;font-size:12px;display:block;margin-bottom:4px;">结束日期</label>
                    <input id="screenerEndDate" type="text" value="${endDateStr}" placeholder="YYYY-MM-DD"
                        style="width:100%;background:#1e253b;border:1px solid #323d5a;border-radius:8px;
                        color:#fff;padding:8px 10px;font-size:13px;box-sizing:border-box;cursor:pointer;">
                </div>

                <div style="min-width:220px;">
                    <label style="color:#9aa9cc;font-size:12px;display:block;margin-bottom:4px;">逻辑组合</label>
                    <div style="display:flex;gap:14px;padding-top:6px;">
                        <label style="color:#fff;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:4px;">
                            <input type="radio" name="screenerLogic" value="AND" checked> 全部满足 (AND)
                        </label>
                        <label style="color:#fff;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:4px;">
                            <input type="radio" name="screenerLogic" value="OR" disabled> 任一满足 (OR)
                        </label>
                    </div>
                </div>
            </div>

            <!-- 条件卡片列表 -->
            <div id="screenerCardList" style="margin-bottom:14px; min-height:60px;">
                ${renderEmptyHint()}
            </div>

            <!-- 操作按钮 -->
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                <button id="screenerAddBtn" style="background:#2d3a5e;">+ 添加条件</button>
                <button id="screenerClearBtn" style="background:#3d3040;">清空</button>
                <button id="screenerStartBtn" style="background:#4f7eff;flex:1;min-width:160px;padding:10px 24px;font-size:14px;">
                    🔍 开始选股
                </button>
            </div>
        </div>

        <!-- 结果区域 -->
        <div class="card" id="screenerResultCard" style="display:none;">
            <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
                <span>📋 选股结果 <span id="screenerResultCount" style="color:#4f7eff;"></span></span>
                <button id="screenerExportBtn" style="background:#2a4a3a;font-size:12px;padding:4px 12px;">📥 导出 CSV</button>
            </div>
            <div id="screenerResultMeta" style="color:#9aa9cc;font-size:13px;margin-bottom:12px;"></div>

            <!-- 批量操作栏 -->
            <div id="screenerBatchBar" style="display:none;align-items:center;gap:10px;margin-bottom:10px;
                padding:8px 12px;background:#0e1220;border-radius:8px;">
                <label style="color:#9aa9cc;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px;">
                    <input type="checkbox" id="screenerSelectAll"> 全选
                </label>
                <button id="screenerBatchBuyBtn" style="background:#4f7eff;font-size:12px;padding:4px 14px;">🛒 批量买入选中</button>
                <span style="color:#9aa9cc;font-size:11px;">每只买入</span>
                <input id="screenerBatchQty" type="number" value="100" min="100" step="100"
                    style="width:70px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;
                    color:#fff;padding:4px 8px;font-size:12px;">
                <span style="color:#9aa9cc;font-size:11px;">股</span>
            </div>

            <div class="scrollable-table" style="max-height:55vh;" id="screenerTableContainer">
                <table>
                    <thead>
                        <tr>
                            <th style="width:36px;"><input type="checkbox" id="screenerHeaderCheck" style="display:none;"></th>
                            <th style="width:40px;">#</th>
                            <th style="width:80px;">代码</th>
                            <th style="width:110px;">名称</th>
                            <th style="width:90px;">触发日期</th>
                            <th>条件详情</th>
                            <th style="width:130px;">操作</th>
                        </tr>
                    </thead>
                    <tbody id="screenerResultBody"></tbody>
                </table>
                <div id="screenerLoadMore" style="display:none;text-align:center;padding:14px;">
                    <button id="screenerLoadMoreBtn" style="background:#2d3a5e;padding:8px 40px;">
                        加载更多（剩余 <span id="screenerRemaining">0</span> 条）
                    </button>
                </div>
            </div>
        </div>
    `;

    // 绑定事件
    bindScreenerEvents();
    refreshTemplateDropdown();

    // 预加载概念/行业列表
    loadDynamicOptions();

    // 绑定日期选择器
    var startDateInput = document.getElementById('screenerStartDate');
    var endDateInput = document.getElementById('screenerEndDate');
    if (startDateInput && typeof bindDatePicker === 'function') {
        bindDatePicker(startDateInput);
    }
    if (endDateInput && typeof bindDatePicker === 'function') {
        bindDatePicker(endDateInput);
    }

    // 如果恢复了筛选条件，渲染卡片列表并同步 UI 控件状态
    if (restored) {
        if (cards.length > 0) {
            renderCardList();
        }
        // 同步逻辑模式单选按钮
        document.getElementsByName('screenerLogic').forEach(function (r) {
            r.checked = (r.value === logicMode);
        });
        // 恢复选股结果表格
        if (lastResults.length > 0) {
            renderResults({ stocks: lastResults, total: lastResults.length });
            // 恢复分页状态
            if (resultPage > 0) {
                for (var p = 0; p < resultPage; p++) {
                    renderNextPage();
                }
            }
        }
    }

    // 从数据库获取最新交易日
    if (bridge && typeof bridge.get_latest_trading_date === 'function') {
        bridge.get_latest_trading_date().then(function (jsonStr) {
            var res = JSON.parse(jsonStr);
            if (res.success && res.date) {
                var endInput = document.getElementById('screenerEndDate');
                if (endInput) endInput.value = res.date;
                // 起始日期设为结束日期前推 7 个自然日
                var startInput = document.getElementById('screenerStartDate');
                if (startInput) {
                    var endDt = new Date(res.date);
                    endDt.setDate(endDt.getDate() - 7);
                    var s = endDt.getFullYear() + '-' +
                        String(endDt.getMonth() + 1).padStart(2, '0') + '-' +
                        String(endDt.getDate()).padStart(2, '0');
                    startInput.value = s;
                }
            }
        }).catch(function (e) { console.warn('[Screener] 获取最新交易日失败', e); });
    }
}

// ── Events ──────────────────────────────────────────────────────

function bindScreenerEvents() {
    // 股票池切换
    var poolSelect = document.getElementById('screenerPool');
    var poolInput = document.getElementById('screenerPoolInput');
    var POOL_OPTIONS = [
        { value: 'all', label: '全市场 A 股' },
        { value: 'hs300', label: '沪深 300' },
        { value: 'zz500', label: '中证 500' },
        { value: 'custom', label: '自定义代码' }
    ];

    function syncPoolInput() {
        if (poolSelect && poolInput) {
            var selOpt = poolSelect.options[poolSelect.selectedIndex];
            if (selOpt) poolInput.value = selOpt.textContent;
        }
    }

    if (poolSelect) {
        poolSelect.value = selectedPool;
        poolSelect.addEventListener('change', function () {
            selectedPool = this.value;
            syncPoolInput();
            var customArea = document.getElementById('screenerCustomArea');
            if (customArea) customArea.style.display = (selectedPool === 'custom') ? 'block' : 'none';
            saveScreenerState();
        });
        var customArea = document.getElementById('screenerCustomArea');
        if (customArea) customArea.style.display = (selectedPool === 'custom') ? 'block' : 'none';
    }

    if (poolInput) {
        poolInput.addEventListener('click', function (e) {
            e.stopPropagation();
            showCustomSelect(poolInput, POOL_OPTIONS, function (value) {
                if (poolSelect) {
                    poolSelect.value = value;
                    poolSelect.dispatchEvent(new Event('change'));
                }
            });
        });
        syncPoolInput();
    }

    // 自定义代码
    var customInput = document.getElementById('screenerCustomCodes');
    if (customInput) {
        customInput.value = customCodes;
        customInput.addEventListener('input', function () { customCodes = this.value.trim(); saveScreenerState(); });
    }

    // 逻辑单选
    document.getElementsByName('screenerLogic').forEach(function (r) {
        r.addEventListener('change', function () { if (this.checked) { logicMode = this.value; saveScreenerState(); } });
    });

    // 添加条件
    var addBtn = document.getElementById('screenerAddBtn');
    if (addBtn) addBtn.addEventListener('click', showAddCardModal);

    // 清空
    var clearBtn = document.getElementById('screenerClearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            if (cards.length === 0) return;
            if (confirm('确定清空所有筛选条件吗？')) { cards = []; renderCardList(); }
        });
    }

    // 开始选股
    var startBtn = document.getElementById('screenerStartBtn');
    if (startBtn) startBtn.addEventListener('click', runScreening);

    // ── 模板管理 ──
    var saveTpl = document.getElementById('screenerSaveTplBtn');
    if (saveTpl) saveTpl.addEventListener('click', saveTemplate);

    var loadTpl = document.getElementById('screenerLoadTplSelect');
    var loadTplInput = document.getElementById('screenerLoadTplInput');

    if (loadTpl) loadTpl.addEventListener('change', function () {
        var key = this.value;
        if (!key) return;
        loadTemplate(key);
        this.value = '';
        // 同步自定义输入框回默认值
        if (loadTplInput && this.options[0]) loadTplInput.value = this.options[0].textContent;
    });

    if (loadTplInput) {
        loadTplInput.addEventListener('click', function (e) {
            e.stopPropagation();
            var sel = document.getElementById('screenerLoadTplSelect');
            var opts = [];
            if (sel) {
                for (var i = 0; i < sel.options.length; i++) {
                    opts.push({ value: sel.options[i].value, label: sel.options[i].textContent });
                }
            }
            showCustomSelect(loadTplInput, opts, function (value) {
                if (sel) {
                    sel.value = value;
                    sel.dispatchEvent(new Event('change'));
                }
            });
        });
    }

    var delTpl = document.getElementById('screenerDelTplBtn');
    if (delTpl) delTpl.addEventListener('click', deleteTemplate);

    // ── 导出 ──
    var exportBtn = document.getElementById('screenerExportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportToCsv);

    // ── 全选 ──
    var selectAll = document.getElementById('screenerSelectAll');
    if (selectAll) {
        selectAll.addEventListener('change', function () {
            var checked = this.checked;
            document.querySelectorAll('.sc-row-check').forEach(function (cb) { cb.checked = checked; });
        });
    }

    // ── 批量买入 ──
    var batchBuyBtn = document.getElementById('screenerBatchBuyBtn');
    if (batchBuyBtn) {
        batchBuyBtn.addEventListener('click', function () {
            var checked = document.querySelectorAll('.sc-row-check:checked');
            if (checked.length === 0) { showToast('请先勾选股票', true); return; }
            var qty = parseInt(document.getElementById('screenerBatchQty').value) || 100;
            var codes = [];
            checked.forEach(function (cb) { codes.push(cb.getAttribute('data-code')); });
            batchBuyStocks(codes, qty);
        });
    }

    // ── 加载更多 ──
    var loadMoreBtn = document.getElementById('screenerLoadMoreBtn');
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', renderNextPage);

    // ── 卡片列表事件代理 ──
    var cardList = document.getElementById('screenerCardList');
    if (cardList) {
        cardList.addEventListener('click', function (e) {
            var t = e.target;
            if (t.classList.contains('sc-edit')) { showEditCardModal(cards[parseInt(t.getAttribute('data-idx'))], parseInt(t.getAttribute('data-idx'))); }
            else if (t.classList.contains('sc-delete')) { var i = parseInt(t.getAttribute('data-idx')); if (i >= 0 && i < cards.length) { cards.splice(i, 1); renderCardList(); } }
            else if (t.classList.contains('sc-up')) { var i = parseInt(t.getAttribute('data-idx')); if (i > 0) { var tmp = cards[i]; cards[i] = cards[i - 1]; cards[i - 1] = tmp; renderCardList(); } }
            else if (t.classList.contains('sc-down')) { var i = parseInt(t.getAttribute('data-idx')); if (i < cards.length - 1) { var tmp = cards[i]; cards[i] = cards[i + 1]; cards[i + 1] = tmp; renderCardList(); } }
        });
    }

    // ── 结果表格事件代理 ──
    var resultBody = document.getElementById('screenerResultBody');
    if (resultBody) {
        resultBody.addEventListener('click', function (e) {
            var t = e.target;
            // K线
            if (t.classList.contains('sc-kline-btn')) {
                var code = t.getAttribute('data-code');
                if (code) {
    // 设置全局当前股票代码
				    window.currentStockCode = code;
				    // 触发导航到“个股详情”页面
				    var navItem = document.querySelector('.nav-item[data-page="stock"]');
				    if (navItem) navItem.click();
				}
            }
            // 买入
            else if (t.classList.contains('sc-buy-btn')) {
                var code = t.getAttribute('data-code');
                var name = t.getAttribute('data-name') || code;
                if (code) showBuyModal(code, name);
            }
            // 展开/折叠详情
            else if (t.classList.contains('sc-toggle-detail')) {
                var code = t.getAttribute('data-code');
                var detailRow = document.getElementById('sc-detail-' + code);
                if (detailRow) {
                    var isHidden = detailRow.style.display === 'none';
                    detailRow.style.display = isHidden ? 'table-row' : 'none';
                    t.textContent = isHidden ? '▲ 收起' : '▼ 详情';
                }
            }
            // 勾选
            else if (t.classList.contains('sc-row-check')) {
                updateBatchBar();
            }
        });
    }
}

// ── Card Rendering ──────────────────────────────────────────────

function renderEmptyHint() {
    return '<div style="color:#9aa9cc;text-align:center;padding:28px 0;' +
        'border:2px dashed #323d5a;border-radius:12px;">' +
        '暂无筛选条件<br><span style="font-size:12px;">点击"添加条件"开始构建</span></div>';
}

function renderCardList() {
    var container = document.getElementById('screenerCardList');
    if (!container) return;
    if (cards.length === 0) { container.innerHTML = renderEmptyHint(); saveScreenerState(); return; }

    container.innerHTML = cards.map(function (card, i) {
        var meta = CARD_TYPE_META[card.type];
        if (!meta) return '';
        return '<div class="strategy-card" style="background:#0e1220;border:1px solid #323d5a;' +
            'border-radius:12px;padding:10px 14px;margin-bottom:8px;transition:border-color 0.2s;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
            '<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">' +
            '<span style="font-size:18px;">' + meta.icon + '</span>' +
            '<span style="color:#fff;font-weight:600;white-space:nowrap;">' + escapeHtml(meta.label) + '</span>' +
            '<span style="color:#9aa9cc;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
            buildParamSummary(card) + '</span></div>' +
            '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">' +
            (i > 0 ? '<button class="sc-up" data-idx="' + i + '" title="上移" style="background:none;border:none;color:#9aa9cc;cursor:pointer;font-size:14px;padding:2px 6px;">⬆</button>' : '<span style="width:28px;"></span>') +
            (i < cards.length - 1 ? '<button class="sc-down" data-idx="' + i + '" title="下移" style="background:none;border:none;color:#9aa9cc;cursor:pointer;font-size:14px;padding:2px 6px;">⬇</button>' : '<span style="width:28px;"></span>') +
            '<button class="sc-edit" data-idx="' + i + '" title="编辑" style="background:none;border:none;color:#4f7eff;cursor:pointer;font-size:14px;padding:2px 6px;">✏️</button>' +
            '<button class="sc-delete" data-idx="' + i + '" title="删除" style="background:none;border:none;color:#ff4c4c;cursor:pointer;font-size:14px;padding:2px 6px;">🗑️</button>' +
            '</div></div></div>';
    }).join('');
    saveScreenerState();
}

function buildParamSummary(card) {
    var meta = CARD_TYPE_META[card.type];
    if (!meta) return '';
    var parts = [];
    meta.paramFields.forEach(function (f) {
        var val = card.params[f.key];
        if (val === undefined || val === null) return;
        var display = val;
        if (f.multiple && Array.isArray(val)) {
            display = val.join(', ') || '(无)';
        } else if (f.type === 'select' && f.options) {
            var opt = f.options.find(function (o) { return o.value === val; });
            display = opt ? opt.label : val;
        }
        parts.push('<span style="color:#9aa9cc;">' + f.label + ':</span> <span style="color:#fff;">' + display + '</span>');
    });
    return parts.join(' &nbsp;|&nbsp; ');
}

// ═══════════════════════════════════════════════════════════════
//  模板管理（localStorage）
// ═══════════════════════════════════════════════════════════════

var TPL_KEY = 'tquant_screener_templates';

function getTemplates() {
    try {
        return JSON.parse(localStorage.getItem(TPL_KEY) || '[]');
    } catch (e) { return []; }
}

function saveTemplates(list) {
    try { localStorage.setItem(TPL_KEY, JSON.stringify(list)); } catch (e) {
        showToast('localStorage 存储空间不足', true);
    }
}

function saveTemplate() {
    if (cards.length === 0) { showToast('没有筛选条件可保存', true); return; }

    var name = prompt('请输入模板名称：', '选股模板 ' + new Date().toLocaleDateString());
    if (!name || !name.trim()) return;
    name = name.trim();

    var templates = getTemplates();

    // 检查同名覆盖
    var existing = templates.findIndex(function (t) { return t.name === name; });
    if (existing >= 0) {
        if (!confirm('模板 "' + name + '" 已存在，是否覆盖？')) return;
        templates.splice(existing, 1);
    }

    templates.push({
        name: name,
        cards: JSON.parse(JSON.stringify(cards)),
        poolType: selectedPool,
        customCodes: customCodes,
        logicMode: logicMode,
        createdAt: new Date().toISOString()
    });

    // 最多保留 20 个模板
    if (templates.length > 20) templates = templates.slice(-20);

    saveTemplates(templates);
    refreshTemplateDropdown();
    showToast('模板 "' + name + '" 已保存', false);
}

function loadTemplate(key) {
    var templates = getTemplates();
    var tpl = templates.find(function (t) { return t.createdAt === key; });
    if (!tpl) { showToast('模板不存在', true); return; }

    if (cards.length > 0 && !confirm('加载模板将覆盖当前筛选条件，确定继续？')) return;

    cards = JSON.parse(JSON.stringify(tpl.cards));
    selectedPool = tpl.poolType || 'all';
    customCodes = tpl.customCodes || '';
    logicMode = tpl.logicMode || 'AND';

    // 同步 UI
    var poolSelect = document.getElementById('screenerPool');
    if (poolSelect) { poolSelect.value = selectedPool; poolSelect.dispatchEvent(new Event('change')); }

    var customInput = document.getElementById('screenerCustomCodes');
    if (customInput) customInput.value = customCodes;

    var radios = document.getElementsByName('screenerLogic');
    radios.forEach(function (r) { r.checked = (r.value === logicMode); });

    renderCardList();
    showToast('已加载模板: ' + escapeHtml(tpl.name), false);
}

function deleteTemplate() {
    var select = document.getElementById('screenerLoadTplSelect');
    if (!select || !select.value) { showToast('请先在模板下拉框中选择要删除的模板', true); return; }
    var key = select.value;
    var templates = getTemplates();
    var tpl = templates.find(function (t) { return t.createdAt === key; });
    if (!tpl) return;
    if (!confirm('确定删除模板 "' + tpl.name + '" 吗？')) return;

    templates = templates.filter(function (t) { return t.createdAt !== key; });
    saveTemplates(templates);
    refreshTemplateDropdown();
    select.value = '';
    showToast('模板已删除', false);
}

function refreshTemplateDropdown() {
    var select = document.getElementById('screenerLoadTplSelect');
    if (!select) return;
    var templates = getTemplates();
    var html = '<option value="">-- 加载模板 (' + templates.length + ') --</option>';
    templates.forEach(function (t) {
        var dateLabel = t.createdAt ? t.createdAt.slice(0, 10) : '';
        var poolLabel = { all: '全市场', hs300: '沪深300', zz500: '中证500', custom: '自定义' }[t.poolType] || t.poolType;
        html += '<option value="' + t.createdAt + '">' + escapeHtml(t.name) + ' (' + (t.cards ? t.cards.length : 0) + '条件, ' + poolLabel + ', ' + dateLabel + ')</option>';
    });
    select.innerHTML = html;
    // 同步自定义输入框
    var tplInput = document.getElementById('screenerLoadTplInput');
    if (tplInput && select.options[0]) tplInput.value = select.options[0].textContent;
}

// ═══════════════════════════════════════════════════════════════
//  CSV 导出
// ═══════════════════════════════════════════════════════════════

function exportToCsv() {
    if (lastResults.length === 0) { showToast('没有可导出的结果', true); return; }

    var startInput = document.getElementById('screenerStartDate');
    var endInput = document.getElementById('screenerEndDate');
    var startStr = startInput ? startInput.value : '';
    var endStr = endInput ? endInput.value : '';

    // 收集所有可能的指标列名
    var indicatorKeys = [];
    var seen = {};
    lastResults.forEach(function (stock) {
        var details = stock.details || {};
        Object.keys(details).forEach(function (k) {
            if (!k.startsWith('_mask_') && !seen[k]) { seen[k] = true; indicatorKeys.push(k); }
        });
    });

    // 标题行: 条件信息
    var condSummary = cards.map(function (c) {
        var meta = CARD_TYPE_META[c.type];
        return meta ? meta.label : c.type;
    }).join('+');

    var lines = [];
    // BOM for Excel UTF-8
    var BOM = '﻿';
    lines.push(BOM + 'Tquant 条件选股结果');
    lines.push('起始日期,' + startStr + ',结束日期,' + endStr + ',条件,' + condSummary + ',逻辑,' + logicMode);
    lines.push('');

    // 表头
    var header = ['序号', '代码', '名称', '触发日期'];
    indicatorKeys.forEach(function (k) { header.push(escapeCsvField(friendlyLabel(k))); });
    header.push('条件满足');
    lines.push(header.join(','));

    // 数据行
    lastResults.forEach(function (stock, i) {
        var details = stock.details || {};
        var row = [i + 1, stock.code, stock.name || '', stock.trigger_date || ''];
        indicatorKeys.forEach(function (k) {
            var v = details[k];
            if (typeof v === 'boolean') v = v ? '是' : '否';
            else if (typeof v === 'number') v = v.toFixed ? v.toFixed(2) : String(v);
            else if (v === null || v === undefined) v = '';
            row.push(escapeCsvField(String(v)));
        });

        // 各条件满足情况
        var satisfied = cards.map(function (c) {
            return details[c.type] ? '✓' : '✗';
        }).join('|');
        row.push(satisfied);
        lines.push(row.join(','));
    });

    var csvContent = lines.join('\n');
    var suggestedName = 'tquant_screener_' + startStr + '_to_' + endStr + '.csv';

    if (!bridge || typeof bridge.save_text_file !== 'function') {
        // 降级：使用浏览器 Blob 下载
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = suggestedName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('已导出 ' + lastResults.length + ' 条记录到浏览器默认下载目录', false);
        return;
    }

    bridge.save_text_file(csvContent, suggestedName).then(function (jsonStr) {
        var res = JSON.parse(jsonStr);
        if (res.cancelled) {
            showToast('已取消保存', false);
        } else if (res.success) {
            showToast('已保存到: ' + res.path + ' (' + lastResults.length + ' 条)', false);
        } else {
            showToast('保存失败: ' + (res.error || '未知错误'), true);
        }
    }).catch(function (err) {
        showToast('保存失败: ' + (err.message || err), true);
    });
}

function escapeCsvField(str) {
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function friendlyLabel(key) {
    var map = {
        '_ma5': 'MA5', '_ma10': 'MA10', '_ma20': 'MA20',
        '_rsi': 'RSI', '_vol_avg': '均量', '_vc_avg': '均量',
        'volume': '成交量', 'ma_cross': '均线交叉', 'rsi': 'RSI',
        'volume_signal': '放量', 'volume_contraction': '缩量',
        'macd': 'MACD', 'bollinger': '布林带', 'kdj': 'KDJ',
        '_fund_flow_main_net': '主力净流入(万元)',
        '_fund_flow_super_net': '超大单净流入(万元)',
        '_fund_flow_big_net': '大单净流入(万元)',
        '_fund_flow_medium_net': '中单净流入(万元)',
        '_fund_flow_small_net': '小单净流入(万元)',
        '_supertrend_trend': '超级趋势',
        '_supertrend_period': 'ATR周期',
        '_supertrend_multiplier': '倍数',
        '_cmf_value': 'CMF值',
        '_cmf_period': 'CMF周期',
        '_resonance_score': '共振分数',
        '_resonance_threshold': '共振阈值',
        '_trend_strength_signal': '趋势强度信号',
        '_trend_strength_type': '信号类型'
    };
    return map[key] || key;
}

// ═══════════════════════════════════════════════════════════════
//  模拟交易（单只 & 批量买入）
// ═══════════════════════════════════════════════════════════════

function showBuyModal(code, name) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';
    overlay.onclick = function () { overlay.remove(); modal.remove(); };

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;' +
        'min-width:360px;z-index:10000;color:#fff;';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;' +
        'border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function () { overlay.remove(); modal.remove(); };

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:16px;';
    title.innerHTML = '🛒 模拟买入 <span style="color:#4f7eff;">' + escapeHtml(name) + ' (' + escapeHtml(code) + ')</span>';

    var body = document.createElement('div');

    // 数量
    var qtyRow = document.createElement('div');
    qtyRow.style.cssText = 'margin-bottom:12px;';
    qtyRow.innerHTML = '<div style="color:#9aa9cc;font-size:12px;margin-bottom:4px;">买入数量（股）</div>' +
        '<input id="buyQty" type="number" value="100" min="100" step="100" style="width:100%;background:#1e253b;' +
        'border:1px solid #323d5a;border-radius:8px;color:#fff;padding:6px 10px;font-size:13px;box-sizing:border-box;">';

    // 价格
    var priceRow = document.createElement('div');
    priceRow.style.cssText = 'margin-bottom:12px;';
    priceRow.innerHTML = '<div style="color:#9aa9cc;font-size:12px;margin-bottom:4px;">买入价格</div>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
        '<input id="buyPrice" type="number" value="" step="0.01" placeholder="手动输入" style="flex:1;background:#1e253b;' +
        'border:1px solid #323d5a;border-radius:8px;color:#fff;padding:6px 10px;font-size:13px;box-sizing:border-box;">' +
        '<button id="fetchPriceBtn" style="background:#2d3a5e;font-size:12px;padding:6px 12px;white-space:nowrap;">📡 获取最新价</button>' +
        '</div>' +
        '<div id="buyPriceHint" style="color:#9aa9cc;font-size:11px;margin-top:4px;"></div>';

    // 预估金额
    var estRow = document.createElement('div');
    estRow.id = 'buyEstimate';
    estRow.style.cssText = 'color:#9aa9cc;font-size:12px;padding:8px;background:#0e1220;border-radius:6px;margin-bottom:12px;';
    estRow.textContent = '预估金额: --';

    // 按钮
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'background:#3d3040;border:none;border-radius:8px;color:#fff;padding:6px 18px;cursor:pointer;font-size:13px;';
    cancelBtn.onclick = function () { overlay.remove(); modal.remove(); };

    var confirmBtn = document.createElement('button');
    confirmBtn.textContent = '确认买入';
    confirmBtn.style.cssText = 'background:#4cff4c;color:#000;border:none;border-radius:8px;padding:6px 24px;cursor:pointer;font-size:13px;font-weight:600;';
    confirmBtn.onclick = function () {
        var qty = parseInt(document.getElementById('buyQty').value) || 0;
        var price = parseFloat(document.getElementById('buyPrice').value) || 0;
        if (qty < 100) { showToast('最少买入 100 股（1手）', true); return; }
        if (qty % 100 !== 0) { showToast('买入数量必须为 100 的整数倍', true); return; }
        if (price <= 0) { showToast('请输入有效的买入价格', true); return; }
        overlay.remove(); modal.remove();
        executeBuy(code, qty, price);
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);

    body.appendChild(qtyRow);
    body.appendChild(priceRow);
    body.appendChild(estRow);
    body.appendChild(btnRow);

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(body);
    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    // 自动获取最新价
    setTimeout(function () {
        var qtyInput = document.getElementById('buyQty');
        var priceInput = document.getElementById('buyPrice');
        var estEl = document.getElementById('buyEstimate');
        if (qtyInput && priceInput) {
            qtyInput.addEventListener('input', function () {
                var q = parseInt(this.value) || 0;
                var p = parseFloat(priceInput.value) || 0;
                if (estEl) estEl.textContent = '预估金额: ' + (q * p).toFixed(2) + ' 元';
            });
            priceInput.addEventListener('input', function () {
                var q = parseInt(qtyInput.value) || 0;
                var p = parseFloat(this.value) || 0;
                if (estEl) estEl.textContent = '预估金额: ' + (q * p).toFixed(2) + ' 元';
            });
        }
        fetchQuoteForBuy(code, priceInput, qtyInput);
    }, 50);

    // 获取最新价按钮
    var fetchBtn = document.getElementById('fetchPriceBtn');
    if (fetchBtn) {
        fetchBtn.addEventListener('click', function () {
            var priceInput = document.getElementById('buyPrice');
            fetchQuoteForBuy(code, priceInput);
        });
    }
}

function fetchQuoteForBuy(code, priceInput, qtyInput) {
    var hintEl = document.getElementById('buyPriceHint');
    if (hintEl) hintEl.textContent = '正在获取...';
    var fetchBtn = document.getElementById('fetchPriceBtn');
    if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.textContent = '⏳'; }

    if (bridge && typeof bridge.get_realtime_quote === 'function') {
        bridge.get_realtime_quote(code).then(function (jsonStr) {
            var data = JSON.parse(jsonStr);
            if (data && data.success && data.price > 0) {
                if (priceInput) {
                    priceInput.value = data.price;
                    priceInput.dispatchEvent(new Event('input'));
                }
                if (hintEl) hintEl.innerHTML = '最新价: <span style="color:#4cff4c;">' + data.price.toFixed(2) +
                    '</span> &nbsp;涨跌: <span style="color:' + (data.change_pct >= 0 ? '#ef5350' : '#26a69a') + ';">' +
                    (data.change_pct >= 0 ? '+' : '') + data.change_pct.toFixed(2) + '%</span>';
            } else {
                if (hintEl) hintEl.textContent = '无法获取实时价格，请手动输入';
            }
            if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = '📡 获取最新价'; }
        }).catch(function () {
            if (hintEl) hintEl.textContent = '获取失败，请手动输入价格';
            if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = '📡 获取最新价'; }
        });
    } else {
        if (hintEl) hintEl.textContent = 'Bridge 未连接，请手动输入价格';
        if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = '📡 获取最新价'; }
    }
}

function executeBuy(code, shares, price) {
    if (!bridge || typeof bridge.execute_trade !== 'function') {
        showToast('Bridge 未连接，无法执行模拟交易', true);
        return;
    }

    var today = new Date().toISOString().slice(0, 10);
    bridge.execute_trade(code, 'buy', shares, price, today).then(function (jsonStr) {
        try {
            var res = JSON.parse(jsonStr);
            if (res.error) { showToast('买入失败: ' + res.error, true); return; }
            showToast('模拟买入成功: ' + code + ' ' + shares + '股 @' + price.toFixed(2), false);
        } catch (e) {
            showToast('模拟买入已提交: ' + code, false);
        }
    }).catch(function (err) {
        showToast('交易失败: ' + (err.message || err), true);
    });
}

function batchBuyStocks(codes, sharesPerStock) {
    if (!bridge || typeof bridge.execute_trade !== 'function') {
        showToast('Bridge 未连接，无法批量买入', true);
        return;
    }
    if (!confirm('确定对选中的 ' + codes.length + ' 只股票各买入 ' + sharesPerStock + ' 股吗？\n\n将使用默认价格执行。')) return;

    var today = new Date().toISOString().slice(0, 10);
    var successCount = 0;
    var failCount = 0;

    function processNext(index) {
        if (index >= codes.length) {
            showToast('批量买入完成：成功 ' + successCount + ' 只，失败 ' + failCount + ' 只', failCount > 0);
            return;
        }

        var code = codes[index];
        // 先尝试获取最新价，失败则使用默认价
        var usePrice = 0;
        var done = function () {
            var price = usePrice > 0 ? usePrice : 10.0;
            bridge.execute_trade(code, 'buy', sharesPerStock, price, today).then(function (jsonStr) {
                try { var res = JSON.parse(jsonStr); if (res.error) { failCount++; } else { successCount++; } } catch (e) { successCount++; }
                processNext(index + 1);
            }).catch(function () { failCount++; processNext(index + 1); });
        };

        if (bridge && typeof bridge.get_realtime_quote === 'function') {
            bridge.get_realtime_quote(code).then(function (jsonStr) {
                var data = JSON.parse(jsonStr);
                if (data && data.success && data.price > 0) usePrice = data.price;
                done();
            }).catch(function () { done(); });
        } else {
            done();
        }
    }

    processNext(0);
}

// ═══════════════════════════════════════════════════════════════
//  虚拟滚动 / 分页
// ═══════════════════════════════════════════════════════════════

function renderNextPage() {
    resultPage++;
    var start = resultPage * PAGE_SIZE;
    var end = Math.min(start + PAGE_SIZE, lastResults.length);
    var pageStocks = lastResults.slice(start, end);

    var body = document.getElementById('screenerResultBody');
    if (!body) return;

    body.insertAdjacentHTML('beforeend', buildResultRows(pageStocks, start));

    // 更新加载更多按钮
    updateLoadMore();
    saveScreenerState();
}

function updateLoadMore() {
    var loadMoreDiv = document.getElementById('screenerLoadMore');
    var loadMoreBtn = document.getElementById('screenerLoadMoreBtn');
    var remainingEl = document.getElementById('screenerRemaining');

    var rendered = (resultPage + 1) * PAGE_SIZE;
    var remaining = lastResults.length - rendered;

    if (remaining <= 0) {
        if (loadMoreDiv) loadMoreDiv.style.display = 'none';
    } else {
        if (loadMoreDiv) loadMoreDiv.style.display = 'block';
        if (remainingEl) remainingEl.textContent = remaining;
    }

    updateBatchBar();
}

function updateBatchBar() {
    var checked = document.querySelectorAll('.sc-row-check:checked');
    var bar = document.getElementById('screenerBatchBar');
    if (bar) bar.style.display = (lastResults.length > 0) ? 'flex' : 'none';
}

// ═══════════════════════════════════════════════════════════════
//  结果渲染（含分页、详情展开、买入按钮）
// ═══════════════════════════════════════════════════════════════

function renderResults(data) {
    var card = document.getElementById('screenerResultCard');
    var countEl = document.getElementById('screenerResultCount');
    var metaEl = document.getElementById('screenerResultMeta');
    var body = document.getElementById('screenerResultBody');

    if (card) card.style.display = 'block';

    var total = data.total || (data.stocks ? data.stocks.length : 0);
    if (countEl) countEl.textContent = '（共 ' + total + ' 只）';

    var startInput = document.getElementById('screenerStartDate');
    var endInput = document.getElementById('screenerEndDate');
    var startStr = startInput ? startInput.value : '';
    var endStr = endInput ? endInput.value : '';

    if (metaEl) {
        var condNames = cards.map(function (c) {
            var m = CARD_TYPE_META[c.type];
            return m ? m.label : c.type;
        }).join(' + ');
        metaEl.innerHTML = '筛选区间: <span style="color:#fff;">' + escapeHtml(startStr) + ' ~ ' + escapeHtml(endStr) + '</span>' +
            ' &nbsp;|&nbsp; 条件: <span style="color:#4f7eff;">' + escapeHtml(condNames) + '</span>' +
            ' &nbsp;|&nbsp; 逻辑: <span style="color:#f2c94c;">' + escapeHtml(logicMode) + '</span>' +
            (total > PAGE_SIZE ? ' &nbsp;|&nbsp; <span style="color:#9aa9cc;">已显示 ' + Math.min(PAGE_SIZE, total) + ' / ' + total + ' 条</span>' : '');
    }

    if (!body) return;

    var stocks = data.stocks || [];
    if (stocks.length === 0) {
        body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9aa9cc;padding:40px;">' +
            '😔 区间内未找到符合条件的股票，请调整条件或扩大日期范围后重试</td></tr>';
        document.getElementById('screenerLoadMore').style.display = 'none';
        document.getElementById('screenerBatchBar').style.display = 'none';
        return;
    }

    // 初始化分页
    resultPage = 0;
    body.innerHTML = buildResultRows(stocks.slice(0, PAGE_SIZE), 0);
    updateLoadMore();
}

function buildResultRows(stocks, startIndex) {
    return stocks.map(function (stock, i) {
        var globalIdx = startIndex + i;
        var code = stock.code || '';
        var name = stock.name || formatStockNameOnly(code);
        var details = stock.details || {};
        var triggerDate = stock.trigger_date || '';

        // 主行
        var mainRow = '<tr style="vertical-align:top;border-bottom:1px solid #2a314a;" id="sc-main-' + escapeHtml(code) + '">' +
            '<td style="padding:8px 6px;">' +
            '<input type="checkbox" class="sc-row-check" data-code="' + escapeHtml(code) + '" style="accent-color:#4f7eff;">' +
            '</td>' +
            '<td style="padding:8px 6px;">' + (globalIdx + 1) + '</td>' +
            '<td style="padding:8px 6px;color:#4f7eff;font-weight:600;">' + escapeHtml(code) + '</td>' +
            '<td style="padding:8px 6px;">' + escapeHtml(name) + '</td>' +
            '<td style="padding:8px 6px;color:#f2c94c;font-size:12px;white-space:nowrap;">' + escapeHtml(triggerDate) + '</td>' +
            '<td style="padding:8px 6px;font-size:12px;">' + buildCompactDetails(details, code) + '</td>' +
            '<td style="padding:8px 6px;text-align:center;white-space:nowrap;">' +
            '<button class="sc-buy-btn" data-code="' + escapeHtml(code) + '" data-name="' + escapeHtml(name) + '" ' +
            'style="background:#2a4a2a;border:1px solid #4cff4c;color:#4cff4c;border-radius:6px;cursor:pointer;' +
            'padding:4px 10px;font-size:12px;margin-right:4px;">🛒 买入</button>' +
            '<button class="sc-kline-btn" data-code="' + escapeHtml(code) + '" ' +
            'style="background:#2d3a5e;border:none;border-radius:6px;color:#fff;cursor:pointer;' +
            'padding:4px 10px;font-size:12px;">📈</button>' +
            '</td></tr>';

        // 详情展开行
        var detailRow = '<tr id="sc-detail-' + escapeHtml(code) + '" style="display:none;background:#0a0d14;">' +
            '<td colspan="7" style="padding:8px 16px;">' +
            buildExpandedDetails(details, code) +
            '</td></tr>';

        return mainRow + detailRow;
    }).join('');
}

function buildCompactDetails(details, code) {
    // 紧凑模式：显示指标值摘要 + 展开按钮
    var parts = [];
    var indicatorKeys = Object.keys(details).filter(function (k) { return !k.startsWith('_mask_'); });

    // 取前 4 个指标值展示
    var shown = 0;
    indicatorKeys.forEach(function (key) {
        if (shown >= 4) return;
        if (typeof details[key] === 'boolean') return; // skip boolean results in compact view
        shown++;
        var val = details[key];
        var displayVal = (typeof val === 'number') ? (val.toFixed ? val.toFixed(2) : String(val)) : String(val);
        parts.push('<span style="color:#9aa9cc;font-size:11px;">' + friendlyLabel(key) + '</span>=' +
            '<span style="color:#fff;font-size:11px;">' + escapeHtml(displayVal) + '</span>');
    });

    // 条件满足状态
    cards.forEach(function (card) {
        var ok = details[card.type];
        var meta = CARD_TYPE_META[card.type];
        var label = meta ? meta.icon + meta.label : card.type;
        parts.push('<span style="font-size:11px;' + (ok ? 'color:#4cff4c;' : 'color:#ff4c4c;') + '">' +
            (ok ? '✓' : '✗') + escapeHtml(label) + '</span>');
    });

    var result = parts.join(' &nbsp;|&nbsp; ');
    result += ' &nbsp;<span class="sc-toggle-detail" data-code="' + escapeHtml(code) + '" ' +
        'style="color:#4f7eff;cursor:pointer;font-size:11px;margin-left:8px;">▼ 详情</span>';
    return result;
}

function buildExpandedDetails(details, code) {
    // 分类展示指标值
    var indicatorKeys = Object.keys(details).filter(function (k) { return !k.startsWith('_mask_') && typeof details[k] !== 'boolean'; });
    var booleanKeys = Object.keys(details).filter(function (k) { return !k.startsWith('_mask_') && typeof details[k] === 'boolean'; });

    var html = '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">';

    // 条件判断
    html += '<div style="min-width:200px;">' +
        '<div style="color:#4f7eff;font-size:12px;font-weight:600;margin-bottom:4px;">📋 条件满足</div>';
    cards.forEach(function (card) {
        var ok = details[card.type];
        var meta = CARD_TYPE_META[card.type];
        var label = meta ? meta.label : card.type;
        html += '<div style="font-size:12px;margin-bottom:2px;">' +
            '<span style="' + (ok ? 'color:#4cff4c;' : 'color:#ff4c4c;') + '">' + (ok ? '✓' : '✗') + '</span> ' +
            escapeHtml(label) + '</div>';
    });
    html += '</div>';

    // 指标数值
    html += '<div style="min-width:250px;">' +
        '<div style="color:#4f7eff;font-size:12px;font-weight:600;margin-bottom:4px;">📊 指标值</div>';
    if (indicatorKeys.length === 0) {
        html += '<div style="color:#9aa9cc;font-size:12px;">--</div>';
    } else {
        html += '<table style="font-size:12px;width:100%;">';
        indicatorKeys.forEach(function (key) {
            var val = details[key];
            var displayVal = (typeof val === 'number') ? (val.toFixed ? val.toFixed(2) : String(val)) : String(val);
            html += '<tr><td style="padding:2px 8px 2px 0;color:#9aa9cc;">' + friendlyLabel(key) + '</td>' +
                '<td style="padding:2px 0;color:#fff;font-weight:500;">' + escapeHtml(displayVal) + '</td></tr>';
        });
        html += '</table>';
    }
    html += '</div>';

    html += '</div>';
    return html;
}

// ═══════════════════════════════════════════════════════════════
//  Modals（添加 / 编辑卡片）
// ═══════════════════════════════════════════════════════════════

function showAddCardModal() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';
    overlay.onclick = function () { overlay.remove(); modal.remove(); };

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;' +
        'min-width:720px;z-index:10000;color:#fff;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:16px;';
    title.textContent = '选择条件类型';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;' +
        'border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function () { overlay.remove(); modal.remove(); };

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:6px;max-height:420px;overflow-y:auto;';

    var typeKeys = ['ma_cross', 'rsi', 'macd', 'bollinger', 'bollinger_width', 'kdj',
        'volume', 'volume_contraction', 'volume_ratio', 'day_of_week', 'sar', 'obv',
        'hammer_hanging', 'williams_r', 'roc', 'psy', 'atr_breakout', 'cci',
        'ma_alignment', 'stop_loss_profit',
        'yesterday_change', 'n_day_high', 'n_day_low', 'consecutive_up',
        'realtime_change',
        'pe_below', 'pb_below', 'roe_above',
        'total_mv_between', 'float_mv_between', 'float_shares_between',
        'concept_contains', 'industry_contains', 'fund_flow_single',
        'turnover_threshold', 'turnover_ratio',
        'vwap_signal', 'median_signal', 'mean_signal',
        'supertrend', 'cmf', 'resonance', 'seven_swords', 'trend_strength'];

    typeKeys.forEach(function (key) {
        var meta = CARD_TYPE_META[key];
        if (!meta) return;
        var item = document.createElement('div');
        item.style.cssText = 'background:#0e1220;border:1px solid #323d5a;border-radius:10px;' +
            'padding:8px 6px;cursor:pointer;text-align:center;transition:background 0.2s;';
        item.title = meta.description;
        item.innerHTML = '<div style="font-size:22px;">' + meta.icon + '</div>' +
            '<div style="color:#fff;font-weight:600;font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(meta.label) + '</div>';
        item.onmouseenter = function () { item.style.background = '#1a2540'; };
        item.onmouseleave = function () { item.style.background = '#0e1220'; };
        item.onclick = function () { overlay.remove(); modal.remove(); addCard(key); };
        grid.appendChild(item);
    });

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(grid);
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

function showEditCardModal(card, index) {
    var meta = CARD_TYPE_META[card.type];
    if (!meta) return;

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';
    overlay.onclick = function () { closeAllCustomSelects(); overlay.remove(); modal.remove(); };

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;' +
        'min-width:380px;max-width:460px;max-height:80vh;overflow-y:auto;z-index:10000;color:#fff;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:16px;';
    title.textContent = '编辑 - ' + meta.label;

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;' +
        'border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function () { closeAllCustomSelects(); overlay.remove(); modal.remove(); };

    var body = document.createElement('div');

    meta.paramFields.forEach(function (f) {
        var row = document.createElement('div');
        row.style.cssText = 'margin-bottom:12px;';
        var label = document.createElement('div');
        label.style.cssText = 'color:#9aa9cc;font-size:12px;margin-bottom:4px;';
        label.textContent = f.label;
        row.appendChild(label);

        var curVal = card.params[f.key] !== undefined ? card.params[f.key] : f.default;

        // Resolve options: use field options, or fall back to cache
        var opts = f.options;
        if ((!opts || opts.length === 0) && f.key === 'concepts') opts = conceptListCache;
        if ((!opts || opts.length === 0) && f.key === 'industry') opts = industryListCache;

        if (f.key === 'concepts' && opts) {
            // 概念多选：搜索框 + 原生 select[multiple]
            var container = document.createElement('div');

            var searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = '输入关键字筛选概念';
            searchInput.style.cssText = 'width:100%; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px; font-size:12px; margin-bottom:8px; box-sizing:border-box;';
            container.appendChild(searchInput);

            var selectEl = document.createElement('select');
            selectEl.multiple = true;
            selectEl.size = 8;
            selectEl.setAttribute('data-field', f.key);
            selectEl.style.cssText = 'width:100%; background:#1e253b; border:1px solid #323d5a; border-radius:8px; color:#fff; font-size:12px; padding:4px;';

            var selectedArr = Array.isArray(curVal) ? curVal : (curVal ? [curVal] : []);

            function populateSelect(filterText) {
                selectEl.innerHTML = '';
                var lowerFilter = (filterText || '').toLowerCase();
                (opts || []).forEach(function(opt) {
                    if (!filterText || opt.label.toLowerCase().indexOf(lowerFilter) !== -1) {
                        var option = document.createElement('option');
                        option.value = opt.value;
                        option.textContent = opt.label;
                        if (selectedArr.indexOf(opt.value) !== -1) {
                            option.selected = true;
                        }
                        selectEl.appendChild(option);
                    }
                });
            }
            populateSelect('');

            searchInput.addEventListener('input', function(e) {
                var sel = Array.from(selectEl.selectedOptions).map(function(o) { return o.value; });
                selectedArr = sel;
                populateSelect(e.target.value);
            });

            selectEl.addEventListener('change', function() {
                selectedArr = Array.from(selectEl.selectedOptions).map(function(o) { return o.value; });
            });

            container.appendChild(selectEl);
            row.appendChild(container);

        } else if (f.type === 'select' && opts) {
            var curLabel = curVal;
            var found = opts.find(function (o) { return o.value === curVal; });
            if (found) curLabel = found.label;
            var input = document.createElement('input');
            input.type = 'text'; input.setAttribute('data-field', f.key);
            input.setAttribute('data-value', String(curVal));
            input.setAttribute('readonly', 'readonly'); input.value = curLabel;
            input.style.cssText = 'width:100%;background:#1e253b;border:1px solid #323d5a;' +
                'border-radius:8px;color:#fff;padding:6px 10px;font-size:13px;box-sizing:border-box;cursor:pointer;';
            input.addEventListener('click', function (e) { e.stopPropagation(); showCustomSelect(input, opts); });
            row.appendChild(input);
        } else {
            var input2 = document.createElement('input');
            input2.type = 'number'; input2.setAttribute('data-field', f.key); input2.value = curVal;
            if (f.min !== undefined) input2.min = f.min;
            if (f.max !== undefined) input2.max = f.max;
            if (f.step !== undefined) input2.step = f.step;
            input2.style.cssText = 'width:100%;background:#1e253b;border:1px solid #323d5a;' +
                'border-radius:8px;color:#fff;padding:6px 10px;font-size:13px;box-sizing:border-box;';
            row.appendChild(input2);
        }
        body.appendChild(row);
    });

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:16px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'background:#3d3040;border:none;border-radius:8px;color:#fff;padding:6px 18px;cursor:pointer;font-size:13px;';
    cancelBtn.onclick = function () { closeAllCustomSelects(); overlay.remove(); modal.remove(); };

    var saveBtn = document.createElement('button');
    saveBtn.textContent = '保存';
    saveBtn.style.cssText = 'background:#4f7eff;border:none;border-radius:8px;color:#fff;padding:6px 24px;cursor:pointer;font-size:13px;font-weight:600;';
    saveBtn.onclick = function () {
        var newParams = {};
        modal.querySelectorAll('[data-field]').forEach(function (el) {
            var fieldKey = el.getAttribute('data-field');
            var fieldDef = meta.paramFields.find(function (pf) { return pf.key === fieldKey; });
            if (fieldDef && fieldDef.multiple && el.multiple) {
                newParams[fieldKey] = Array.from(el.selectedOptions).map(function(opt) { return opt.value; });
            } else {
                var rawValue = el.type === 'text' && el.hasAttribute('data-value') ? el.getAttribute('data-value') : el.value;
                if (fieldDef && fieldDef.type === 'number') {
                    newParams[fieldKey] = parseFloat(rawValue);
                    if (isNaN(newParams[fieldKey])) newParams[fieldKey] = fieldDef.default;
                } else { newParams[fieldKey] = rawValue; }
            }
        });
        cards[index].params = newParams;
        closeAllCustomSelects(); overlay.remove(); modal.remove();
        renderCardList();
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    body.appendChild(btnRow);
    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(body);
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

// ── Custom Select ───────────────────────────────────────────────

function showCustomSelect(input, options, callback) {
    closeAllCustomSelects();
    if (!options || options.length === 0) return;

    var panel = document.createElement('div');
    panel.className = 'screener-custom-select';
    panel.style.cssText = 'position:fixed;z-index:10001;background:#1a2135;border:1px solid #4f7eff;' +
        'border-radius:12px;padding:6px 0;max-height:220px;overflow-y:auto;min-width:260px;box-shadow:0 8px 20px rgba(0,0,0,0.5);';

    options.forEach(function (opt) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:8px 16px;cursor:pointer;color:#fff;font-size:13px;white-space:nowrap;';
        item.textContent = opt.label;
        item.setAttribute('data-value', opt.value);
        item.addEventListener('mouseenter', function () { item.style.background = '#2d3a5e'; });
        item.addEventListener('mouseleave', function () { item.style.background = 'transparent'; });
        item.addEventListener('click', function (e) {
            e.stopPropagation();
            input.value = opt.label;
            input.setAttribute('data-value', opt.value);
            panel.remove();
            if (typeof callback === 'function') callback(opt.value);
        });
        panel.appendChild(item);
    });

    document.body.appendChild(panel);
    var rect = input.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.style.top = (rect.bottom + 4) + 'px';

    setTimeout(function () { document.addEventListener('click', closeAllCustomSelectsOnDoc); }, 0);
}

function closeAllCustomSelectsOnDoc(e) {
    var panel = document.querySelector('.screener-custom-select');
    if (panel && !panel.contains(e.target)) closeAllCustomSelects();
}

function closeAllCustomSelects() {
    document.querySelectorAll('.screener-custom-select').forEach(function (p) { p.remove(); });
    document.removeEventListener('click', closeAllCustomSelectsOnDoc);
}

// ── Card CRUD ───────────────────────────────────────────────────

function addCard(typeKey) {
    var meta = CARD_TYPE_META[typeKey];
    if (!meta) return;
    cards.push({ type: typeKey, params: JSON.parse(JSON.stringify(meta.defaultParams)) });
    renderCardList();
}

// ═══════════════════════════════════════════════════════════════
//  Screening Logic
// ═══════════════════════════════════════════════════════════════

function runScreening() {
    if (cards.length === 0) { showToast('请先添加至少一个筛选条件', true); return; }

    var startInput = document.getElementById('screenerStartDate');
    var endInput = document.getElementById('screenerEndDate');
    var startDate = startInput ? startInput.value.trim() : '';
    var endDate = endInput ? endInput.value.trim() : '';

    if (!startDate || !endDate) {
        showToast('请输入起始日期和结束日期', true); return;
    }
    if (startDate > endDate) {
        showToast('起始日期不能晚于结束日期', true); return;
    }

    var startBtn = document.getElementById('screenerStartBtn');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = '⏳ 筛选中...'; }

    // 收集股票池并执行筛选
    function proceedWithScreening() {
        var indexMap = { hs300: '000300.XSHG', zz500: '000905.XSHG' };
        var indexCode = indexMap[selectedPool];

        if (indexCode && bridge && typeof bridge.get_index_stocks === 'function') {
            bridge.get_index_stocks(indexCode).then(function (jsonStr) {
                var pool = JSON.parse(jsonStr);
                if (!Array.isArray(pool) || pool.length === 0) {
                    showToast('获取 ' + selectedPool + ' 成分股失败', true);
                    if (startBtn) { startBtn.disabled = false; startBtn.textContent = '🔍 开始选股'; }
                    return;
                }
                console.log("[Screener] " + selectedPool + " 成分股:", pool.length + " 只");
                doRunScreening(startDate, endDate, pool);
            }).catch(function (err) {
                console.error('[Screener] 获取成分股失败:', err);
                showToast('获取成分股失败，使用模拟数据', true);
                onScreeningDone(mockScreening());
            });
        } else if (selectedPool === 'custom') {
            var raw = customCodes || '';
            var pool = raw.split(/[,，\s]+/).filter(function (s) { return s.length > 0; });
            if (pool.length === 0) { showToast('请输入自定义股票代码', true); return; }
            console.log("[Screener] 自定义股票池:", pool.length + " 只");
            doRunScreening(startDate, endDate, pool);
        } else {
            console.log("[Screener] 股票池: 全市场");
            doRunScreening(startDate, endDate, null);
        }
    }

    // 检查结束日期是否晚于最新交易日（仅警告）
    if (bridge && typeof bridge.get_latest_trading_date === 'function') {
        bridge.get_latest_trading_date().then(function (jsonStr) {
            var latest = JSON.parse(jsonStr);
            if (latest.success && latest.date && endDate > latest.date) {
                if (!confirm('结束日期 ' + endDate + ' 晚于最新交易日 ' + latest.date + '，超出部分将无数据。\n\n是否继续？')) {
                    var endInput2 = document.getElementById('screenerEndDate');
                    if (endInput2) endInput2.value = latest.date;
                    endDate = latest.date;
                }
            }
            proceedWithScreening();
        }).catch(function (e) {
            console.warn('[Screener] 日期校验失败，跳过', e);
            proceedWithScreening();
        });
    } else {
        proceedWithScreening();
    }
}

function doRunScreening(startDate, endDate, stockPool) {
    console.log("[Screener] 发送卡片:", cards);
    console.log("[Screener] 股票池:", stockPool);
    console.log("[Screener] 筛选区间:", startDate, "~", endDate);

    var startBtn = document.getElementById('screenerStartBtn');

    if (bridge && typeof bridge.screen_stocks === 'function') {
        var cardsJson = JSON.stringify(cards);
        var poolJson = stockPool ? JSON.stringify(stockPool) : '';
        bridge.screen_stocks(cardsJson, poolJson, startDate, endDate).then(function (jsonStr) {
            onScreeningDone(JSON.parse(jsonStr));
        }).catch(function (err) {
            console.error('[Screener] Bridge call failed, using mock:', err);
            onScreeningDone(mockScreening());
        });
    } else {
        setTimeout(function () { onScreeningDone(mockScreening()); }, 600);
    }
}

function onScreeningDone(data) {
    var startBtn = document.getElementById('screenerStartBtn');
    if (startBtn) { startBtn.disabled = false; startBtn.textContent = '🔍 开始选股'; }

    if (!data || !data.success) {
        showToast('选股失败: ' + (data && data.error ? data.error : '未知错误'), true);
        return;
    }

    lastResults = data.stocks || [];
    resultPage = 0;
    saveScreenerState();
    renderResults(data);
}

// ── Mock Data ───────────────────────────────────────────────────

function mockScreening() {
    var endInput = document.getElementById('screenerEndDate');
    var mockTriggerDate = endInput ? endInput.value : '2024-01-15';

    var mockCodes = ['000001', '000002', '000333', '000651', '000858', '002415', '300750',
        '600036', '600276', '600519', '600585', '600809', '600887', '601012', '601318'];
    var mockNames = {
        '000001': '平安银行', '000002': '万科A', '000333': '美的集团', '000651': '格力电器',
        '000858': '五粮液', '002415': '海康威视', '300750': '宁德时代', '600036': '招商银行',
        '600276': '恒瑞医药', '600519': '贵州茅台', '600585': '海螺水泥', '600809': '山西汾酒',
        '600887': '伊利股份', '601012': '隆基绿能', '601318': '中国平安'
    };

    var count = 5 + Math.floor(Math.random() * 6);
    var shuffled = mockCodes.sort(function () { return Math.random() - 0.5; });
    var selected = shuffled.slice(0, count);

    return {
        success: true,
        total: selected.length,
        stocks: selected.map(function (code) {
            var details = {};
            cards.forEach(function (card) {
                details[card.type] = Math.random() > 0.3;
                if (card.type === 'ma_cross') {
                    details['_ma5'] = parseFloat((10 + Math.random() * 50).toFixed(2));
                    details['_ma20'] = parseFloat((10 + Math.random() * 50).toFixed(2));
                } else if (card.type === 'rsi') {
                    details['_rsi'] = parseFloat((20 + Math.random() * 60).toFixed(2));
                } else if (card.type === 'volume') {
                    details['volume'] = Math.floor(1000000 + Math.random() * 50000000);
                    details['_vol_avg'] = Math.floor(500000 + Math.random() * 20000000);
                } else if (card.type === 'volume_contraction') {
                    details['volume'] = Math.floor(1000000 + Math.random() * 50000000);
                    details['_vc_avg'] = Math.floor(500000 + Math.random() * 20000000);
                } else if (card.type === 'concept_contains') {
                    details['matched_concepts'] = '新能源,人工智能';
                } else if (card.type === 'industry_contains') {
                    details['industry'] = '银行';
                } else if (card.type === 'fund_flow_single') {
                    var field = card.params.field || 'main_net';
                    details['_fund_flow_' + field] = parseFloat((Math.random() * 20000 - 5000).toFixed(2));
                }
            });
            return { code: code, name: mockNames[code] || code, trigger_date: mockTriggerDate, details: details };
        })
    };
}

// ── Toast ───────────────────────────────────────────────────────

function showToast(msg, isError) {
    var tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:' +
        (isError ? '#ff4c4c' : '#4cff4c') + ';color:#000;padding:10px 20px;border-radius:8px;z-index:99999;font-weight:600;';
    tip.textContent = msg;
    document.body.appendChild(tip);
    setTimeout(function () { tip.remove(); }, 2000);
}


