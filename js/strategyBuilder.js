// js/strategyBuilder.js
// Strategy Factory: visual card-based strategy builder

import { bridge } from './bridge.js';
import { bindDatePicker } from './datepicker.js';
import { escapeHtml } from './main.js';
import { generateCardId, CARD_TYPE_META, STRATEGY_TEMPLATES, createDefaultCard } from './strategyTemplates.js';
import { generateCode, serializeConfig, deserializeConfig, validateCards, extractParamsFromCards } from './strategyUtils.js';
import { stockNameMap, fetchStockName } from './stockData.js';
import { Logger } from './logger.js';
import { showCompareBacktestModal } from './compareStrategy.js';

// ---- State ----
var cards = [];
var strategyName = '';
var strategyId = null;
var initialCapital = window._initialCapital || 100000;
var startDate = '2025-01-01';
var endDate = new Date().toISOString().slice(0, 10);
var stockPool = '';
var slippage = 'close';
var entryLogic = 'all';
var exitLogic = 'any';
var logContainer = null;
var codeExpanded = false;
var logExpanded = true;
var strategyLogger = null;

// Stock pool state - layered selector
var poolSource = 'all';  // 'all', 'hs300', 'zz500', 'zz1000', 'cyb', 'kc50', 'custom'
var _optMode = 'single';  // 'single' | 'multi'
var customStockCodes = '';
var poolIndustryFilter = '';
var poolConceptFilter = [];
var poolConceptMatchMode = 'any';
var poolMarketCapMin = '';
var poolMarketCapMax = '';
var poolFloatSharesMin = '';
var poolFloatSharesMax = '';
var currentStockPool = [];  // computed final pool
var allStocksCache = [];
var poolInitialized = false;
var poolDebounceTimer = null;  // debounce timer for filter inputs

// Dynamic options cache (for concept/industry selects)
var conceptListCache = [];
var industryListCache = [];
var dynOptionsLoaded = false;

function loadDynamicOptions() {
    if (dynOptionsLoaded) return;
    dynOptionsLoaded = true;
    if (bridge && typeof bridge.get_concept_list === 'function') {
        bridge.get_concept_list().then(function (jsonStr) {
            try {
                var list = JSON.parse(jsonStr);
                if (Array.isArray(list)) {
                    conceptListCache = list.map(function (c) { return { value: c, label: c }; });
                    if (CARD_TYPE_META.concept_contains) {
                        CARD_TYPE_META.concept_contains.paramFields[0].options = conceptListCache;
                    }
                }
            } catch (e) {}
        }).catch(function (e) {});
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
            } catch (e) {}
        }).catch(function (e) {});
    }
}

// ---- Custom Select Panel ----

function showCustomSelect(input, options, callback) {
    closeCustomSelect();
    if (!options || options.length === 0) return;

    var panel = document.createElement('div');
    panel.className = 'custom-select-panel';
    panel.style.cssText = 'position:fixed; z-index:99999; background:#1a2135; border:1px solid #4f7eff; border-radius:12px; padding:6px 0; max-height:250px; overflow-y:auto; min-width:260px; box-shadow:0 8px 20px rgba(0,0,0,0.5);';

    options.forEach(function(opt) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:8px 16px; cursor:pointer; color:#fff; font-size:13px; transition:background 0.15s; white-space:nowrap;';
        item.textContent = opt.label;
        item.setAttribute('data-value', opt.value);
        item.addEventListener('mouseenter', function() { item.style.background = '#2d3a5e'; });
        item.addEventListener('mouseleave', function() { item.style.background = 'transparent'; });
        item.addEventListener('click', function(e) {
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

    setTimeout(function() {
        document.addEventListener('click', closeCustomSelectOnClick);
    }, 0);
}

function closeCustomSelectOnClick(e) {
    var panel = document.querySelector('.custom-select-panel');
    if (panel && !panel.contains(e.target)) {
        closeCustomSelect();
    }
}

function closeCustomSelect() {
    var panel = document.querySelector('.custom-select-panel');
    if (panel) panel.remove();
    document.removeEventListener('click', closeCustomSelectOnClick);
}

// ---- Logging & Toast ----

function addLog(level, text) {
    if (strategyLogger) strategyLogger.addLog(level, text);
}

function clearLog() {
    if (strategyLogger) strategyLogger.clearLog();
}

function showToast(msg, isError, duration) {
    var tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:' +
        (isError ? '#ff4c4c' : '#4cff4c') + ';color:#000;padding:10px 20px;border-radius:8px;z-index:99999;font-weight:600;';
    tip.textContent = msg;
    document.body.appendChild(tip);
    setTimeout(function() { tip.remove(); }, duration || 2000);
}

// ---- Card Rendering ----

function buildParamSummary(card) {
    var meta = CARD_TYPE_META[card.type];
    if (!meta) return '';
    var parts = [];
    meta.paramFields.forEach(function(f) {
        var val = card.params[f.key];
        if (val === undefined || val === null) return;
        // 检查可见性条件
        if (f.visible) {
            var visKey = Object.keys(f.visible)[0];
            var visVal = card.params[visKey];
            if (visVal === undefined || visVal === null) visVal = meta.defaultParams[visKey];
            if (f.visible[visKey].indexOf(visVal) === -1) return;
        }
        var display = val;
        if (f.type === 'boolean') {
            display = val ? '是' : '否';
        } else if (f.multiple && Array.isArray(val)) {
            display = val.join(', ') || '(无)';
        } else if (f.type === 'select' && f.options) {
            var opt = f.options.find(function(o) { return o.value === val; });
            display = opt ? opt.label : val;
        }
        parts.push('<span style="color:#9aa9cc;">' + f.label + ':</span> ' +
            '<span style="color:#fff;">' + display + '</span>');
    });
    return parts.join(' &nbsp;|&nbsp; ');
}

function buildActionBadge(card) {
    if (card.type === 'position') {
        return '<span style="color:#f2c94c;">⚖️ 仓位设置</span>';
    }
    if (card.type === 'stop_loss_profit') {
        return '<span style="color:#ff6b6b;">🛡️ 风控</span>';
    }
    if (card.type === 'index_sentiment') {
        return '<span style="color:#f2c94c;">📊 情绪</span>';
    }
    if (card.action === 'buy') {
        return '<span style="color:#4cff4c;">🟢 买入</span>';
    }
    if (card.action === 'sell') {
        return '<span style="color:#ff4c4c;">🔴 卖出</span>';
    }
    return '';
}

function renderSingleCard(card, index) {
    var meta = CARD_TYPE_META[card.type];
    if (!meta) return '';
    return '<div class="strategy-card" draggable="true" data-card-index="' + index + '" ' +
        'style="background:#0e1220;border:1px solid #323d5a;border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:grab;transition:border-color 0.2s;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;">' +
        '<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">' +
        '<span style="color:#4f7eff;cursor:grab;font-size:16px;" class="drag-handle">≡</span>' +
        '<span style="font-size:18px;">' + meta.icon + '</span>' +
        '<span style="color:#fff;font-weight:600;white-space:nowrap;">' + meta.label + '</span>' +
        '<span style="color:#9aa9cc;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
        buildParamSummary(card) + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
        '<span style="font-size:12px;margin-right:4px;">' + buildActionBadge(card) + '</span>' +
        (index > 0 ? '<button class="card-btn card-up" data-idx="' + index + '" title="上移">⬆</button>' : '<span style="width:28px;"></span>') +
        (index < cards.length - 1 ? '<button class="card-btn card-down" data-idx="' + index + '" title="下移">⬇</button>' : '<span style="width:28px;"></span>') +
        '<button class="card-btn card-edit" data-idx="' + index + '" title="编辑">✏️</button>' +
        '<button class="card-btn card-delete" data-idx="' + index + '" title="删除">🗑️</button>' +
        '</div></div></div>';
}

function renderCards() {
    var container = document.getElementById('cardList');
    if (!container) return;
    if (cards.length === 0) {
        container.innerHTML = '<div style="color:#9aa9cc;text-align:center;padding:32px 0;border:2px dashed #323d5a;border-radius:12px;">还没有添加条件卡片<br><span style="font-size:12px;">点击下方按钮开始构建策略</span></div>';
    } else {
        container.innerHTML = cards.map(function(c, i) { return renderSingleCard(c, i); }).join('');
    }
    bindCardEvents();
    updateCodePreview();
}

function bindCardEvents() {
    // Drag events
    var cardEls = document.querySelectorAll('.strategy-card');
    cardEls.forEach(function(el) {
        el.addEventListener('dragstart', function(e) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', el.getAttribute('data-card-index'));
            el.style.opacity = '0.5';
        });
        el.addEventListener('dragend', function() {
            el.style.opacity = '1';
            document.querySelectorAll('.strategy-card').forEach(function(c) { c.style.borderColor = '#323d5a'; });
        });
        el.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            el.style.borderColor = '#4f7eff';
        });
        el.addEventListener('dragleave', function() {
            el.style.borderColor = '#323d5a';
        });
        el.addEventListener('drop', function(e) {
            e.preventDefault();
            el.style.borderColor = '#323d5a';
            var fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
            var toIdx = parseInt(el.getAttribute('data-card-index'));
            if (!isNaN(fromIdx) && !isNaN(toIdx) && fromIdx !== toIdx) {
                moveCard(fromIdx, toIdx);
            }
        });
    });

    // Up/down buttons
    document.querySelectorAll('.card-up').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.getAttribute('data-idx'));
            if (idx > 0) moveCard(idx, idx - 1);
        });
    });
    document.querySelectorAll('.card-down').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.getAttribute('data-idx'));
            if (idx < cards.length - 1) moveCard(idx, idx + 1);
        });
    });

    // Edit
    document.querySelectorAll('.card-edit').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.getAttribute('data-idx'));
            showEditCardModal(cards[idx], idx);
        });
    });

    // Delete
    document.querySelectorAll('.card-delete').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.getAttribute('data-idx'));
            deleteCard(idx);
        });
    });
}

// ---- Card CRUD ----

function addCard(typeKey, action, params) {
    var meta = CARD_TYPE_META[typeKey];
    if (!meta) return;
    var card = {
        id: generateCardId(),
        type: typeKey,
        action: action !== undefined ? action : meta.defaultAction,
        params: params ? JSON.parse(JSON.stringify(params)) : JSON.parse(JSON.stringify(meta.defaultParams))
    };
    cards.push(card);
    renderCards();
}

function deleteCard(index) {
    if (index < 0 || index >= cards.length) return;
    cards.splice(index, 1);
    renderCards();
}

function moveCard(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= cards.length || toIdx < 0 || toIdx >= cards.length) return;
    var item = cards.splice(fromIdx, 1)[0];
    cards.splice(toIdx, 0, item);
    renderCards();
}

// ---- Modals ----

function showAddCardModal() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';
    overlay.onclick = function() { overlay.remove(); modal.remove(); };

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;min-width:720px;z-index:10000;color:#fff;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:16px;';
    title.textContent = '选择条件类型';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function() { overlay.remove(); modal.remove(); };

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(6, 1fr);gap:6px;';

    var typeKeys = ['ma_cross', 'rsi', 'macd', 'bollinger', 'bollinger_width', 'kdj',
        'volume', 'volume_contraction', 'volume_ratio', 'day_of_week', 'sar', 'obv',
        'hammer_hanging', 'williams_r', 'roc', 'psy', 'atr_breakout', 'cci',
        'ma_alignment', 'stop_loss_profit', 'position', 'price_limit',
        'yesterday_change', 'n_day_high', 'n_day_low', 'consecutive_up',
        'pe_below', 'pb_below', 'roe_above', 'concept_contains', 'industry_contains',
        'turnover_threshold', 'turnover_ratio',
        'vwap_signal', 'median_signal', 'mean_signal',
        'index_sentiment'];
    typeKeys.forEach(function(key) {
        var meta = CARD_TYPE_META[key];
        var item = document.createElement('div');
        item.style.cssText = 'background:#0e1220;border:1px solid #323d5a;border-radius:10px;padding:8px 6px;cursor:pointer;text-align:center;transition:background 0.2s;';
        item.title = meta.description;
        item.innerHTML = '<div style="font-size:22px;">' + meta.icon + '</div>' +
            '<div style="color:#fff;font-weight:600;font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + meta.label + '</div>';
        item.onmouseenter = function() { item.style.background = '#1a2540'; };
        item.onmouseleave = function() { item.style.background = '#0e1220'; };
        item.onclick = function() {
            overlay.remove();
            modal.remove();
            if (key === 'position' || key === 'index_sentiment') {
                addCard(key, null);
            } else if (key === 'stop_loss_profit') {
                addCard(key, 'sell');
            } else {
                // Show action picker inline
                showActionPicker(key);
            }
        };
        grid.appendChild(item);
    });

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(grid);
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

function showActionPicker(typeKey) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:10001;';
    overlay.onclick = function() { overlay.remove(); picker.remove(); };

    var picker = document.createElement('div');
    picker.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;z-index:10002;color:#fff;text-align:center;';

    var meta = CARD_TYPE_META[typeKey];
    picker.innerHTML = '<div style="font-size:28px;margin-bottom:8px;">' + meta.icon + '</div>' +
        '<div style="font-weight:600;margin-bottom:12px;">' + meta.label + '</div>' +
        '<div style="color:#9aa9cc;margin-bottom:16px;">选择交易方向</div>';

    var buyBtn = document.createElement('button');
    buyBtn.textContent = '🟢 买入';
    buyBtn.style.cssText = 'background:#2a4a2a;border:1px solid #4cff4c;color:#4cff4c;padding:8px 24px;border-radius:8px;cursor:pointer;margin-right:8px;font-size:14px;';
    buyBtn.onclick = function() { overlay.remove(); picker.remove(); addCard(typeKey, 'buy'); };

    var sellBtn = document.createElement('button');
    sellBtn.textContent = '🔴 卖出';
    sellBtn.style.cssText = 'background:#4a2a2a;border:1px solid #ff4c4c;color:#ff4c4c;padding:8px 24px;border-radius:8px;cursor:pointer;font-size:14px;';
    sellBtn.onclick = function() { overlay.remove(); picker.remove(); addCard(typeKey, 'sell'); };

    picker.appendChild(buyBtn);
    picker.appendChild(sellBtn);
    document.body.appendChild(overlay);
    document.body.appendChild(picker);
}

function showEditCardModal(card, index) {
    var meta = CARD_TYPE_META[card.type];
    if (!meta) return;

    // 归一化旧格式仓位卡片为新的 position_mode / position_value 格式
    if (card.type === 'position') {
        var _pm = card.params.position_mode;
        if (!_pm) {
            var oldPct = card.params.fixedPercent;
            if (oldPct !== undefined) {
                card.params.position_mode = 'percentage';
                card.params.position_value = oldPct * 100;
                card.params.quantity_unit = 'shares';
            }
        }
        if (!card.params.position_mode) {
            card.params.position_mode = 'percentage';
            card.params.position_value = 100;
            card.params.quantity_unit = 'shares';
        }
        var _pv = card.params.position_value;
        card.params.position_pct = (card.params.position_mode === 'percentage') ? _pv : 100;
        card.params.position_shares = (card.params.position_mode === 'fixed_quantity') ? _pv : 1000;
    }

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';
    overlay.onclick = function() { closeCustomSelect(); overlay.remove(); modal.remove(); };

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;min-width:380px;max-width:460px;z-index:10000;color:#fff;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:16px;';
    title.textContent = '编辑 - ' + meta.label;

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function() { closeCustomSelect(); overlay.remove(); modal.remove(); };

    var body = document.createElement('div');

    // Build form fields
    var formData = {};
    var fieldRows = {};  // track row elements for visibility toggling
    meta.paramFields.forEach(function(f) {
        formData[f.key] = card.params[f.key] !== undefined ? card.params[f.key] : f.default;

        var row = document.createElement('div');
        row.style.cssText = 'margin-bottom:12px;overflow:hidden;';
        fieldRows[f.key] = row;

        // Check visibility condition
        if (f.visible) {
            var visField = Object.keys(f.visible)[0];
            var visValues = f.visible[visField];
            var currentVisVal = formData[visField];
            if (visValues.indexOf(currentVisVal) === -1) {
                row.style.display = 'none';
            }
        }

        var label = document.createElement('div');
        label.style.cssText = 'color:#9aa9cc;font-size:12px;margin-bottom:4px;';
        label.textContent = f.label;
        row.appendChild(label);

        var opts = f.options;
        if ((!opts || opts.length === 0) && f.key === 'concepts') opts = conceptListCache;
        if ((!opts || opts.length === 0) && f.key === 'industry') opts = industryListCache;

        if (f.key === 'concepts' && opts) {
            // ... (concepts handling unchanged)
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

            var selectedArr = Array.isArray(formData[f.key]) ? formData[f.key] : (formData[f.key] ? [formData[f.key]] : []);

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
            var currentValue = formData[f.key];
            var currentLabel = currentValue;
            var foundOpt = opts.find(function(opt) { return opt.value === currentValue; });
            if (foundOpt) currentLabel = foundOpt.label;

            var input = document.createElement('input');
            input.type = 'text';
            input.setAttribute('data-field', f.key);
            input.setAttribute('data-value', currentValue);
            input.setAttribute('readonly', 'readonly');
            input.value = currentLabel;
            input.style.cssText = 'width:260px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px; font-size:13px; box-sizing:border-box; cursor:pointer;';

            input.addEventListener('click', function(e) {
                e.stopPropagation();
                showCustomSelect(input, opts, function(selectedValue) {});
            });

            // Check if this field controls visibility of other fields
            var controlsVisibility = false;
            meta.paramFields.forEach(function(otherF) {
                if (otherF.visible) {
                    var visKey = Object.keys(otherF.visible)[0];
                    if (visKey === f.key) controlsVisibility = true;
                }
            });
            if (controlsVisibility) {
                input.addEventListener('click', function(e) {
                    // After selection, update visibility
                    setTimeout(function() {
                        meta.paramFields.forEach(function(otherF) {
                            if (otherF.visible) {
                                var visKey = Object.keys(otherF.visible)[0];
                                var visValues = otherF.visible[visKey];
                                var curVisVal = input.getAttribute('data-value');
                                var rowEl = fieldRows[otherF.key];
                                if (rowEl) {
                                    rowEl.style.display = visValues.indexOf(curVisVal) >= 0 ? '' : 'none';
                                }
                            }
                        });
                    }, 200);
                });
            }

            row.appendChild(input);
        } else if (f.type === 'number') {
            var input = document.createElement('input');
            input.type = 'number';
            input.setAttribute('data-field', f.key);
            if (f.min !== undefined) input.min = f.min;
            if (f.max !== undefined) input.max = f.max;
            if (f.step !== undefined) input.step = f.step;
            input.value = formData[f.key];
            input.style.cssText = 'width:100%;background:#0e1220;border:1px solid #323d5a;border-radius:8px;color:#fff;padding:8px;font-size:13px;box-sizing:border-box;';
            row.appendChild(input);
            // 数量模式下显示 "≈ X 手" 提示
            if (f.key === 'position_shares') {
                var lotsHint = document.createElement('span');
                lotsHint.style.cssText = 'color:#7a8ba8;font-size:11px;margin-left:8px;white-space:nowrap;';
                lotsHint.setAttribute('data-position-lots-hint', '1');
                var updateLotsHint = function() {
                    var v = parseInt(input.value) || 0;
                    lotsHint.textContent = '≈ ' + (v / 100).toFixed(0) + ' 手 (1手=100股)';
                };
                input.addEventListener('input', updateLotsHint);
                updateLotsHint();
                row.appendChild(lotsHint);
            }
        } else if (f.type === 'boolean') {
            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.setAttribute('data-field', f.key);
            checkbox.checked = formData[f.key] === true;
            checkbox.style.cssText = 'width:18px;height:18px;accent-color:#4f7eff;cursor:pointer;';
            row.style.cssText = 'margin-bottom:12px;display:flex;align-items:center;gap:10px;';
            row.innerHTML = '';  // clear label, rebuild
            var cbLabel = document.createElement('span');
            cbLabel.style.cssText = 'color:#9aa9cc;font-size:12px;';
            cbLabel.textContent = f.label;
            row.appendChild(checkbox);
            row.appendChild(cbLabel);
        }

        body.appendChild(row);
    });

    // Action toggle for non-position, non-stop-loss, non-index_sentiment cards
    if (card.type !== 'position' && card.type !== 'stop_loss_profit' && card.type !== 'index_sentiment') {
        var actionRow = document.createElement('div');
        actionRow.style.cssText = 'margin-top:16px;display:flex;gap:8px;align-items:center;';
        actionRow.innerHTML = '<span style="color:#9aa9cc;font-size:12px;">交易方向：</span>';

        var buyToggle = document.createElement('button');
        buyToggle.textContent = '🟢 买入';
        buyToggle.setAttribute('data-action', 'buy');
        buyToggle.style.cssText = 'padding:6px 16px;border-radius:20px;border:1px solid;cursor:pointer;' +
            (card.action === 'buy' ? 'background:#2a4a2a;border-color:#4cff4c;color:#4cff4c;' : 'background:transparent;border-color:#323d5a;color:#9aa9cc;');
        buyToggle.onclick = function() {
            buyToggle.style.cssText = 'padding:6px 16px;border-radius:20px;border:1px solid;cursor:pointer;background:#2a4a2a;border-color:#4cff4c;color:#4cff4c;';
            sellToggle.style.cssText = 'padding:6px 16px;border-radius:20px;border:1px solid;cursor:pointer;background:transparent;border-color:#323d5a;color:#9aa9cc;';
            buyToggle.setAttribute('data-selected', 'true');
            sellToggle.setAttribute('data-selected', 'false');
        };

        var sellToggle = document.createElement('button');
        sellToggle.textContent = '🔴 卖出';
        sellToggle.setAttribute('data-action', 'sell');
        sellToggle.style.cssText = 'padding:6px 16px;border-radius:20px;border:1px solid;cursor:pointer;' +
            (card.action === 'sell' ? 'background:#4a2a2a;border-color:#ff4c4c;color:#ff4c4c;' : 'background:transparent;border-color:#323d5a;color:#9aa9cc;');
        sellToggle.setAttribute('data-selected', card.action === 'sell' ? 'true' : 'false');
        buyToggle.setAttribute('data-selected', card.action === 'buy' ? 'true' : 'false');
        sellToggle.onclick = function() {
            sellToggle.style.cssText = 'padding:6px 16px;border-radius:20px;border:1px solid;cursor:pointer;background:#4a2a2a;border-color:#ff4c4c;color:#ff4c4c;';
            buyToggle.style.cssText = 'padding:6px 16px;border-radius:20px;border:1px solid;cursor:pointer;background:transparent;border-color:#323d5a;color:#9aa9cc;';
            sellToggle.setAttribute('data-selected', 'true');
            buyToggle.setAttribute('data-selected', 'false');
        };

        actionRow.appendChild(buyToggle);
        actionRow.appendChild(sellToggle);
        body.appendChild(actionRow);
    }

    // Save button
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;margin-top:20px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'background:transparent;border:1px solid #323d5a;color:#9aa9cc;padding:6px 18px;border-radius:30px;cursor:pointer;';
    cancelBtn.onclick = function() { closeCustomSelect(); overlay.remove(); modal.remove(); };

    var saveBtn = document.createElement('button');
    saveBtn.textContent = '保存';
    saveBtn.style.cssText = 'background:#4f7eff;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;';
    saveBtn.onclick = function() {
        var newParams = {};
        meta.paramFields.forEach(function(f) {
            var el = modal.querySelector('[data-field="' + f.key + '"]');
            if (el) {
                var val;
                if (f.key === 'concepts' && el.multiple) {
                    val = Array.from(el.selectedOptions).map(function(opt) { return opt.value; });
                } else if (f.type === 'select') {
                    val = el.getAttribute('data-value') || el.value;
                } else if (f.type === 'number') {
                    val = parseFloat(el.value);
                    if (isNaN(val)) val = f.default;
                    if (f.min !== undefined && val < f.min) val = f.min;
                    if (f.max !== undefined && val > f.max) val = f.max;
                } else if (f.type === 'boolean') {
                    val = el.checked;
                } else {
                    val = el.value;
                }
                newParams[f.key] = val;
            }
        });
        // Get action
        var newAction = card.action;
        var buyEl = modal.querySelector('[data-action="buy"]');
        var sellEl = modal.querySelector('[data-action="sell"]');
        if (buyEl && sellEl) {
            if (buyEl.getAttribute('data-selected') === 'true') newAction = 'buy';
            if (sellEl.getAttribute('data-selected') === 'true') newAction = 'sell';
        }
        // 归一化仓位参数: 从当前可见的 UI 控件读取 position_value
        if (card.type === 'position') {
            if (newParams.position_mode === 'percentage') {
                newParams.position_value = newParams.position_pct;
            } else if (newParams.position_mode === 'fixed_quantity') {
                newParams.position_value = newParams.position_shares;
            }
            newParams.quantity_unit = 'shares';
            // 清理仅用于 UI 的临时字段
            delete newParams.position_pct;
            delete newParams.position_shares;
        }
        card.params = newParams;
        card.action = newAction;
        renderCards();
        overlay.remove();
        modal.remove();
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(body);
    modal.appendChild(btnRow);
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

function showTemplateModal() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';
    overlay.onclick = function() { overlay.remove(); modal.remove(); };

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;min-width:420px;max-width:500px;max-height:70vh;overflow-y:auto;z-index:10000;color:#fff;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:16px;';
    title.textContent = '📂 策略模板';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function() { overlay.remove(); modal.remove(); };

    var list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    STRATEGY_TEMPLATES.forEach(function(tpl) {
        var item = document.createElement('div');
        item.style.cssText = 'background:#0e1220;border:1px solid #323d5a;border-radius:10px;padding:14px;cursor:pointer;';
        item.innerHTML = '<div style="color:#fff;font-weight:600;">' + escapeHtml(tpl.name) + '</div>' +
            '<div style="color:#9aa9cc;font-size:12px;margin-top:4px;">' + escapeHtml(tpl.description) + '</div>' +
            '<div style="color:#4f7eff;font-size:11px;margin-top:4px;">' + tpl.cards.length + ' 张卡片</div>';
        item.onmouseenter = function() { item.style.background = '#1a2540'; };
        item.onmouseleave = function() { item.style.background = '#0e1220'; };
        item.onclick = function() {
            cards = tpl.cards.map(function(c) {
                return {
                    id: generateCardId(),
                    type: c.type,
                    action: c.action,
                    params: JSON.parse(JSON.stringify(c.params))
                };
            });
            strategyName = tpl.name;
            var nameInput = document.getElementById('strategyNameInput');
            if (nameInput) nameInput.value = strategyName;
            if (tpl.defaultStock) {
                window._defaultStockFromTemplate = tpl.defaultStock;
            }
            renderCards();
            overlay.remove();
            modal.remove();
            showToast('已加载模板: ' + tpl.name, false);
        };
        list.appendChild(item);
    });

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(list);
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

function showStrategyListModal() {
    if (!bridge) { showToast('Bridge 未连接', true); return; }

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';
    overlay.onclick = function() { overlay.remove(); popup.remove(); };

    var popup = document.createElement('div');
    popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;min-width:400px;max-height:60vh;overflow-y:auto;z-index:10000;color:#fff;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:16px;';
    title.textContent = '📂 我的策略';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function() { overlay.remove(); popup.remove(); };

    var listDiv = document.createElement('div');

    bridge.list_strategies().then(function(jsonStr) {
        var arr = JSON.parse(jsonStr);
        if (!Array.isArray(arr) || arr.length === 0) {
            listDiv.innerHTML = '<div style="color:#9aa9cc;padding:20px;text-align:center;">暂无保存的策略</div>';
            return;
        }
        var html = '';
        arr.forEach(function(item) {
            html += '<div class="strategy-list-item" data-id="' + item.id + '" ' +
                'style="padding:10px;margin-bottom:6px;background:#0e1220;border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">' +
                '<div><strong>' + escapeHtml(item.name) + '</strong> <span style="color:#9aa9cc;font-size:12px;">ID: ' + item.id + '</span></div>' +
                '<div><button class="load-strategy-btn" data-id="' + item.id + '" style="background:#2a3a5a;border:none;color:#fff;padding:4px 10px;border-radius:12px;cursor:pointer;font-size:11px;margin-right:4px;">加载</button>' +
                '<button class="del-strategy-btn" data-id="' + item.id + '" style="background:#4a2a2a;border:none;color:#ff6b6b;padding:4px 10px;border-radius:12px;cursor:pointer;font-size:11px;">删除</button></div>' +
                '</div>';
        });
        listDiv.innerHTML = html;

        listDiv.querySelectorAll('.load-strategy-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                loadStrategyById(parseInt(this.getAttribute('data-id')));
                overlay.remove();
                popup.remove();
            });
        });
        listDiv.querySelectorAll('.del-strategy-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = parseInt(this.getAttribute('data-id'));
                if (confirm('确认删除策略 ID=' + id + ' 吗？')) {
                    bridge.delete_strategy(id).then(function() {
                        showToast('已删除', false);
                        overlay.remove();
                        popup.remove();
                    });
                }
            });
        });
    }).catch(function() {
        listDiv.innerHTML = '<div style="color:#ff6b6b;padding:20px;text-align:center;">加载失败</div>';
    });

    popup.appendChild(closeBtn);
    popup.appendChild(title);
    popup.appendChild(listDiv);
    document.body.appendChild(overlay);
    document.body.appendChild(popup);
}

function saveCurrentBacktestResult(result, strategyName, stockCodes, start, end, cash) {
    if (!bridge || typeof bridge.save_backtest_result !== 'function') return;
    var saveData = {
        strategyName: strategyName,
        stockPool: stockCodes,
        startDate: start,
        endDate: end,
        initialCash: cash,
        metrics: result.metrics || {},
        signals: result.signals || [],
        equityCurve: result.equity_curve || [],
        stockPerformance: result.stock_performance || []
    };
    bridge.save_backtest_result(JSON.stringify(saveData)).catch(function(e) { console.warn('保存历史记录失败', e); });
}

function showBacktestModal() {
    if (!bridge) { showToast('Bridge 未连接', true); return; }

    var validation = validateCards(cards);
    if (!validation.valid) {
        showToast(validation.errors[0], true);
        return;
    }

    var code = generateCode(cards);
    window.currentStrategyCode = code;

    var defaultStock = (currentStockPool && currentStockPool.length > 0) ? currentStockPool.join(',') : ((window._defaultStockFromTemplate) || '000001');

    var pageStartInput = document.getElementById('strategyStartDate');
    var pageEndInput = document.getElementById('strategyEndDate');
    var startDt = pageStartInput ? pageStartInput.value : startDate;
    var endDt = pageEndInput ? pageEndInput.value : endDate;
    var capitalInput = document.getElementById('initialCapitalInput');
    var cash = capitalInput ? (Number(capitalInput.value) || 1000000) : initialCapital;

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;min-width:440px;max-width:540px;z-index:10000;color:#fff;';

    var title = document.createElement('div');
    title.style.cssText = 'color:#fff;font-weight:600;font-size:16px;margin-bottom:16px;padding-left:12px;border-left:4px solid #4f7eff;';
    title.textContent = '🎯 回测参数';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function() { overlay.remove(); modal.remove(); };

    var body = document.createElement('div');

    var dateInfo = document.createElement('div');
    dateInfo.style.cssText = 'color:#9aa9cc;font-size:13px;margin-bottom:12px;';
    dateInfo.textContent = '回测区间：' + startDt + ' ~ ' + endDt;

    // Index quick-select
    var indexRow = document.createElement('div');
    indexRow.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap;';
    var indexLabel = document.createElement('span');
    indexLabel.style.cssText = 'color:#9aa9cc;font-size:12px;';
    indexLabel.textContent = '常用指数：';
    indexRow.appendChild(indexLabel);

    var indexDefs = [
        { label: '沪深300', code: '000300.XSHG' },
        { label: '中证500', code: '000905.XSHG' },
        { label: '中证1000', code: '000852.XSHG' },
        { label: '创业板', code: '399006.XSHE' },
        { label: '科创50', code: '000688.XSHG' }
    ];

    var stockArea = document.createElement('textarea');
    stockArea.rows = 3;
    stockArea.setAttribute('id', 'modalStockInput');
    stockArea.style.cssText = 'width:100%;background:#0e1220;border:1px solid #323d5a;border-radius:12px;color:#fff;padding:8px;font-family:monospace;box-sizing:border-box;';
    stockArea.value = defaultStock;
    stockArea.placeholder = '输入股票代码，每行一个或用逗号分隔';

    indexDefs.forEach(function(idx) {
        var btn = document.createElement('button');
        btn.textContent = idx.label;
        btn.style.cssText = 'background:#2a3a5a;border:none;padding:3px 10px;border-radius:20px;color:#fff;font-size:12px;cursor:pointer;';
        btn.onclick = function(e) {
            e.preventDefault();
            if (bridge && typeof bridge.get_index_stocks === 'function') {
                bridge.get_index_stocks(idx.code).then(function(jsonStr) {
                    var codes = JSON.parse(jsonStr);
                    if (Array.isArray(codes) && codes.length > 0) {
                        stockArea.value = codes.join(',');
                    }
                });
            }
        };
        indexRow.appendChild(btn);
    });

    var stockLabel = document.createElement('div');
    stockLabel.style.cssText = 'color:#9aa9cc;margin-bottom:4px;font-size:13px;';
    stockLabel.textContent = '股票池（每行一个或用逗号分隔）：';

    var capitalRow = document.createElement('div');
    capitalRow.style.cssText = 'display:flex;gap:12px;align-items:center;margin-top:12px;';
    capitalRow.innerHTML = '<span style="color:#9aa9cc;font-size:13px;">初始资金：</span>' +
        '<span style="color:#4f7eff;font-weight:600;">¥' + Number(cash).toLocaleString() + '</span>';

    var statusDiv = document.createElement('div');
    statusDiv.style.cssText = 'color:#9aa9cc;font-size:12px;margin-top:12px;min-height:18px;';

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:16px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'background:transparent;border:1px solid #323d5a;color:#9aa9cc;padding:6px 18px;border-radius:30px;cursor:pointer;';
    cancelBtn.onclick = function() { overlay.remove(); modal.remove(); };

    var runBtn = document.createElement('button');
    runBtn.textContent = '开始回测';
    runBtn.style.cssText = 'background:#4f7eff;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;';
    runBtn.onclick = function() {
        if (runBtn.disabled) return;
        runBtn.disabled = true;
        runBtn.textContent = '⏳ 回测中...';
        statusDiv.textContent = '正在执行回测...';

        var raw = stockArea.value || '';
        var codes = [];
        raw.split(/[\n,]+/).forEach(function(part) {
            var c = part.trim();
            if (c) codes.push(c);
        });
        codes = codes.filter(function(v, i, a) { return a.indexOf(v) === i; });
        if (codes.length === 0) {
            statusDiv.textContent = '请输入至少一个股票代码';
            statusDiv.style.color = '#ff4c4c';
            runBtn.disabled = false;
            runBtn.textContent = '开始回测';
            return;
        }

        function executeBacktest(stockCodes) {
            if (stockCodes.length === 0) {
                addLog('warn', '筛选后股票池为空，无法执行回测');
                statusDiv.textContent = '筛选后股票池为空，请调整筛选条件';
                statusDiv.style.color = '#ff4c4c';
                runBtn.disabled = false;
                runBtn.textContent = '开始回测';
                return;
            }

            addLog('info', '开始回测 ' + stockCodes.length + ' 只股票：' + stockCodes.map(function(c) { return c.split('.')[0]; }).join(', '));

            var start = startDt;
            var end = endDt;
            var cashVal = cash;
            var sName = strategyName || '未命名策略';
            var userCode = generateCode(cards);

            window.currentStrategyCode = userCode;
            window.currentStrategyName = sName;

            var slippageInput2 = document.getElementById('slippageInput');
            var slippageType = slippageInput2 ? (slippageInput2.getAttribute('data-value') || 'close') : 'close';
            window._slippageMode = slippageType;

            var startTime = Date.now();

            function processSingleStockResults(results, elapsed) {
                var mergedSignals = [];
                var equityMap = {};
                var positionMap = {};

                results.forEach(function(r) {
                    if (!r) return;
                    if (r.signals) {
                        r.signals.forEach(function(s) {
                            var code = s.code || '';
                            mergedSignals.push({ date: s.date, code: code, type: s.type, price: s.price, shares: s.shares, reason: s.reason });
                            if (!positionMap[code]) positionMap[code] = 0;
                            if (s.type === 'buy') {
                                positionMap[code] += (s.price || 0) * (s.shares || 0);
                            } else {
                                positionMap[code] -= (s.price || 0) * (s.shares || 0);
                            }
                        });
                    }
                    if (r.equity_curve) {
                        r.equity_curve.forEach(function(ec) {
                            if (equityMap[ec.date] === undefined) equityMap[ec.date] = 0;
                            equityMap[ec.date] += ec.value;
                        });
                    }
                });

                var unknownCodes = [];
                var seenCodes = {};
                mergedSignals.forEach(function(s) {
                    var c = s.code || '';
                    if (c && !stockNameMap[c] && !seenCodes[c]) {
                        seenCodes[c] = true;
                        unknownCodes.push(c);
                    }
                });

                function buildFinalResult() {
                    var mergedEquityCurve = Object.keys(equityMap).sort().map(function(date) {
                        return { date: date, value: equityMap[date] };
                    });

                    var firstMetrics = (results.length > 0 && results[0] && results[0].metrics) ? results[0].metrics : {};
                    var firstBenchmarkCurve = (results.length > 0 && results[0] && results[0].benchmark_equity_curve) ? results[0].benchmark_equity_curve : null;
                    var firstBenchmarkCode = (results.length > 0 && results[0] && results[0].benchmark_code) ? results[0].benchmark_code : null;
                    var mergedResult = { success: true, signals: mergedSignals, equity_curve: mergedEquityCurve, metrics: firstMetrics, stock_performance: null,
                        benchmark_equity_curve: firstBenchmarkCurve, benchmark_code: firstBenchmarkCode };
                    for (var i = 0; i < results.length; i++) {
                        if (results[i] && results[i].stock_performance) { mergedResult.stock_performance = results[i].stock_performance; break; }
                    }

                    window._lastBacktestResult = mergedResult;
                    window.strategySignals = mergedSignals;
                    window._lastBacktestError = null;
                    window.strategyStartDate = start;
                    window.strategyEndDate = end;

                    saveCurrentBacktestResult(mergedResult, sName, stockCodes, start, end, cashVal);

                    var posEntries = Object.keys(positionMap).map(function(k) { return { code: k, value: positionMap[k] }; });
                    posEntries.sort(function(a, b) { return b.value - a.value; });
                    window.topPositionCodes = posEntries.slice(0, 6).map(function(e) { return e.code; });

                    addLog('success', '✅ 回测完成，总信号 ' + mergedSignals.length + ' 个，耗时 ' + elapsed + ' 秒');
                    if (mergedSignals.length === 0) {
                        addLog('warn', '回测区间内无信号产生，请检查条件参数或回测区间是否合理');
                    }
                    addLog('info', '💡 请前往【策略详情】查看详细结果，或切换至【买卖点成交图】查看K线信号');

                    overlay.remove();
                    modal.remove();
                    showToast('✅ 回测完成 | ' + stockCodes.length + '只股票 | 耗时' + elapsed + '秒 | 信号' + mergedSignals.length + '个', false);
                }

                if (unknownCodes.length > 0) {
                    addLog('info', '正在加载 ' + unknownCodes.length + ' 只股票的名称...');
                    var namePromises = unknownCodes.map(function(c) { return fetchStockName(c, bridge); });
                    Promise.all(namePromises).then(function() {
                        buildFinalResult();
                    });
                } else {
                    buildFinalResult();
                }
            }

            function finalizeError(err) {
                addLog('error', '回测整体失败: ' + err.message);
                window._lastBacktestError = err.message;
                statusDiv.textContent = '回测整体失败: ' + err.message;
                statusDiv.style.color = '#ff4c4c';
                runBtn.disabled = false;
                runBtn.textContent = '开始回测';
            }

            if (stockCodes.length > 1) {
                // ---- 多股组合回测：共享资金池 ----
                addLog('info', '🚀 启动多股组合回测（共享资金池），共 ' + stockCodes.length + ' 只股票');
                var commission = parseFloat(document.getElementById('commissionRate').value) || 0.0003;
                var stampTax = parseFloat(document.getElementById('stampTaxRate').value) || 0.001;
                var slippageCostTypeVal = document.getElementById('slippageCostType').getAttribute('data-value') || 'percent';
                var slippageCostValueVal = parseFloat(document.getElementById('slippageCostValue').value) || 0.1;
                var benchmarkEl2 = document.getElementById('benchmarkSelect');
                var benchmarkCode2 = benchmarkEl2 ? (benchmarkEl2.getAttribute('data-value') || '') : '';
                var multiParams = { code: userCode, stocks: stockCodes, start: start, end: end, cash: cashVal, slippage: slippageType,
                    commission_rate: commission, stamp_tax_rate: stampTax,
                    slippage_cost_type: slippageCostTypeVal, slippage_cost_value: slippageCostValueVal,
                    benchmark_code: benchmarkCode2 || null };
                bridge.run_multi_backtest(JSON.stringify(multiParams)).then(function(jsonStr) {
                    var startRes = JSON.parse(jsonStr);
                    if (!startRes.success) {
                        addLog('error', '多股回测失败: ' + (startRes.error || '未知错误'));
                        finalizeError(new Error(startRes.error || '未知错误'));
                        return;
                    }

                    var jobId = startRes.job_id;
                    var pollInterval = setInterval(function() {
                        bridge.get_backtest_progress(jobId).then(function(progStr) {
                            var prog = JSON.parse(progStr);
                            if (prog.status === 'cancelled' || prog.status === 'cancelling') {
                                clearInterval(pollInterval);
                                finalizeError(new Error('回测已被取消'));
                                return;
                            }
                            if (prog.status === 'finished') {
                                clearInterval(pollInterval);
                                bridge.get_backtest_result(jobId).then(function(resStr) {
                                    var resObj = JSON.parse(resStr);
                                    if (!resObj.ready) {
                                        finalizeError(new Error('获取多股回测结果失败'));
                                        return;
                                    }
                                    var res = resObj.result;
                                    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                                    if (!res.success) {
                                        addLog('error', '多股回测失败: ' + (res.error || '未知错误'));
                                        finalizeError(new Error(res.error || '未知错误'));
                                        return;
                                    }
                                    if (res.logs && res.logs.length > 0) {
                                        res.logs.slice(-30).forEach(function(l) {
                                            if (l.indexOf('[WARN]') !== -1) {
                                                addLog('warn', '[后端] ' + l.replace('[WARN] ', ''));
                                            } else if (l.indexOf('[ERROR]') !== -1) {
                                                addLog('error', '[后端] ' + l.replace('[ERROR] ', ''));
                                            } else {
                                                addLog('info', '[后端] ' + l.replace('[INFO] ', ''));
                                            }
                                        });
                                    }

                                    var signals = res.signals || [];
                                    var equityCurve = res.equity_curve || [];
                                    var metrics = res.metrics || {};
                                    var stockPerformance = res.stock_performance || [];

                                    var finalResult = {
                                        success: true,
                                        signals: signals,
                                        equity_curve: equityCurve,
                                        metrics: metrics,
                                        stock_performance: stockPerformance,
                                        benchmark_equity_curve: res.benchmark_equity_curve || null,
                                        benchmark_code: res.benchmark_code || null
                                    };
                                    window._lastBacktestResult = finalResult;
                                    window.strategySignals = signals;
                                    window._lastBacktestError = null;
                                    window.strategyStartDate = start;
                                    window.strategyEndDate = end;

                                    saveCurrentBacktestResult(finalResult, sName, stockCodes, start, end, cashVal);

                                    var posMap = {};
                                    signals.forEach(function(s) {
                                        var c = s.code || '';
                                        if (!posMap[c]) posMap[c] = 0;
                                        if (s.type === 'buy') posMap[c] += (s.price || 0) * (s.shares || 0);
                                        else posMap[c] -= (s.price || 0) * (s.shares || 0);
                                    });
                                    var posEntries2 = Object.keys(posMap).map(function(k) { return { code: k, value: posMap[k] }; });
                                    posEntries2.sort(function(a, b) { return b.value - a.value; });
                                    window.topPositionCodes = posEntries2.slice(0, 6).map(function(e) { return e.code; });

                                    var unknownCodes2 = [];
                                    var seenCodes2 = {};
                                    signals.forEach(function(s) {
                                        var c = s.code || '';
                                        if (c && !stockNameMap[c] && !seenCodes2[c]) {
                                            seenCodes2[c] = true;
                                            unknownCodes2.push(c);
                                        }
                                    });
                                    if (unknownCodes2.length > 0) {
                                        addLog('info', '正在加载 ' + unknownCodes2.length + ' 只股票的名称...');
                                        var namePromises2 = unknownCodes2.map(function(c) { return fetchStockName(c, bridge); });
                                        Promise.all(namePromises2).then(function() {
                                            addLog('success', '✅ 回测完成，总信号 ' + signals.length + ' 个，耗时 ' + elapsed + ' 秒');
                                            if (signals.length === 0) addLog('warn', '回测区间内无信号产生，请检查条件参数或回测区间是否合理');
                                            addLog('info', '💡 请前往【策略详情】查看详细结果，或切换至【买卖点成交图】查看K线信号');
                                            overlay.remove();
                                            modal.remove();
                                            showToast('✅ 回测完成 | ' + stockCodes.length + '只股票 | 耗时' + elapsed + '秒 | 信号' + signals.length + '个', false);
                                        });
                                    } else {
                                        addLog('success', '✅ 回测完成，总信号 ' + signals.length + ' 个，耗时 ' + elapsed + ' 秒');
                                        if (signals.length === 0) addLog('warn', '回测区间内无信号产生，请检查条件参数或回测区间是否合理');
                                        addLog('info', '💡 请前往【策略详情】查看详细结果，或切换至【买卖点成交图】查看K线信号');
                                        overlay.remove();
                                        modal.remove();
                                        showToast('✅ 回测完成 | ' + stockCodes.length + '只股票 | 耗时' + elapsed + '秒 | 信号' + signals.length + '个', false);
                                    }
                                }).catch(function(err) {
                                    clearInterval(pollInterval);
                                    finalizeError(err);
                                });
                            }
                        }).catch(function(err) {
                            clearInterval(pollInterval);
                            finalizeError(err);
                        });
                    }, 500);
                }).catch(function(err) {
                    finalizeError(err);
                });
            } else {
                // ---- 单股回测：使用原有接口 ----
                var stock = stockCodes[0];
                var cleanCode = userCode.replace(/"STOCK_CODE_PLACEHOLDER"/g, '"' + stock + '"');
                var commission2 = parseFloat(document.getElementById('commissionRate').value) || 0.0003;
                var stampTax2 = parseFloat(document.getElementById('stampTaxRate').value) || 0.001;
                var slippageCostTypeVal2 = document.getElementById('slippageCostType').getAttribute('data-value') || 'percent';
                var slippageCostValueVal2 = parseFloat(document.getElementById('slippageCostValue').value) || 0.1;
                var benchmarkEl = document.getElementById('benchmarkSelect');
                var benchmarkCode = benchmarkEl ? (benchmarkEl.getAttribute('data-value') || '') : '';
                var params = { code: cleanCode, stock: stock, start: start, end: end, cash: cashVal, slippage: slippageType,
                    commission_rate: commission2, stamp_tax_rate: stampTax2,
                    slippage_cost_type: slippageCostTypeVal2, slippage_cost_value: slippageCostValueVal2,
                    benchmark_code: benchmarkCode || null };
                bridge.run_custom_backtest(JSON.stringify(params)).then(function(jsonStr) {
                    var startRes = JSON.parse(jsonStr);
                    if (!startRes.success) {
                        addLog('error', stock + ' 回测失败: ' + (startRes.error || '未知'));
                        finalizeError(new Error(startRes.error || '未知错误'));
                        return;
                    }

                    var jobId = startRes.job_id;
                    var pollInterval = setInterval(function() {
                        bridge.get_backtest_progress(jobId).then(function(progStr) {
                            var prog = JSON.parse(progStr);
                            if (prog.status === 'cancelled' || prog.status === 'cancelling') {
                                clearInterval(pollInterval);
                                finalizeError(new Error('回测已被取消'));
                                return;
                            }
                            if (prog.status === 'finished') {
                                clearInterval(pollInterval);
                                bridge.get_backtest_result(jobId).then(function(resStr) {
                                    var resObj = JSON.parse(resStr);
                                    if (!resObj.ready) {
                                        finalizeError(new Error('获取回测结果失败'));
                                        return;
                                    }
                                    var res = resObj.result;
                                    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                                    if (!res.success) {
                                        addLog('error', stock + ' 回测失败: ' + (res.error || '未知'));
                                        finalizeError(new Error(res.error || '未知错误'));
                                        return;
                                    }
                                    var sigCount = (res.signals && res.signals.length) || 0;
                                    addLog('success', stock + ' 回测完成，信号 ' + sigCount + ' 个');
                                    if (res.logs && res.logs.length > 0) {
                                        res.logs.slice(-10).forEach(function(l) {
                                            if (l.indexOf('[WARN]') !== -1) {
                                                addLog('warn', '[后端] ' + l.replace('[WARN] ', ''));
                                            } else if (l.indexOf('[ERROR]') !== -1) {
                                                addLog('error', '[后端] ' + l.replace('[ERROR] ', ''));
                                            } else {
                                                addLog('info', '[后端] ' + l.replace('[INFO] ', ''));
                                            }
                                        });
                                    }
                                    processSingleStockResults([res], elapsed);
                                }).catch(function(err) {
                                    clearInterval(pollInterval);
                                    finalizeError(err);
                                });
                            }
                        }).catch(function(err) {
                            clearInterval(pollInterval);
                            finalizeError(err);
                        });
                    }, 500);
                }).catch(function(err) {
                    finalizeError(err);
                });
            }
        }

        clearLog();
        addLog('info', '回测参数 | 初始资金: ¥' + Number(cash).toLocaleString() + ' | 区间: ' + startDt + ' ~ ' + endDt);
        addLog('info', '股票池: ' + codes.length + ' 只');
        executeBacktest(codes);
    };

    body.appendChild(dateInfo);
    body.appendChild(indexRow);
    body.appendChild(stockLabel);
    body.appendChild(stockArea);
    body.appendChild(capitalRow);
    body.appendChild(statusDiv);
    body.appendChild(btnRow);
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(runBtn);

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(body);
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

// ---- Persistence ----

function saveCurrentStrategy() {
    if (!bridge) { showToast('Bridge 未连接', true); return; }
    var nameInput = document.getElementById('strategyNameInput');
    var name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
        showToast('请输入策略名称', true);
        if (nameInput) { nameInput.classList.add('error'); setTimeout(function() { nameInput.classList.remove('error'); }, 2000); }
        return;
    }
    var capitalInput = document.getElementById('initialCapitalInput');
    var cap = capitalInput ? (Number(capitalInput.value) || 1000000) : initialCapital;
    var startInput = document.getElementById('strategyStartDate');
    var endInput = document.getElementById('strategyEndDate');
    var sDate = startInput ? startInput.value : startDate;
    var eDate = endInput ? endInput.value : endDate;
    var stockPoolInput = document.getElementById('poolCustomCodes');
    var sp = stockPoolInput ? stockPoolInput.value.trim() : (customStockCodes || '');
    var spInput = document.getElementById('slippageInput');
    var sl = spInput ? (spInput.getAttribute('data-value') || 'close') : (slippage || 'close');
    var commission = parseFloat(document.getElementById('commissionRate').value) || 0.0003;
    var stampTax = parseFloat(document.getElementById('stampTaxRate').value) || 0.001;
    var slippageCostType = document.getElementById('slippageCostType').getAttribute('data-value') || 'percent';
    var slippageCostValue = parseFloat(document.getElementById('slippageCostValue').value) || 0.1;
    var entryLogicEl = document.getElementById('entryLogicSelect');
    var exitLogicEl = document.getElementById('exitLogicSelect');
    var entryLogic = entryLogicEl ? (entryLogicEl.getAttribute('data-value') || 'all') : 'all';
    var exitLogic = exitLogicEl ? (exitLogicEl.getAttribute('data-value') || 'any') : 'any';
    var jsonConfig = serializeConfig(cards, cap, sDate, eDate, sp, sl, commission, stampTax, slippageCostType, slippageCostValue, entryLogic, exitLogic);
    // Attach pool config
    var poolConfig = {
        poolSource: poolSource,
        customStockCodes: customStockCodes,
        poolIndustryFilter: poolIndustryFilter,
        poolConceptFilter: poolConceptFilter,
        poolConceptMatchMode: poolConceptMatchMode,
        poolMarketCapMin: poolMarketCapMin,
        poolMarketCapMax: poolMarketCapMax,
        poolFloatSharesMin: poolFloatSharesMin,
        poolFloatSharesMax: poolFloatSharesMax
    };
    var configObj = JSON.parse(jsonConfig);
    configObj.poolConfig = poolConfig;
    jsonConfig = JSON.stringify(configObj);

    var saveBtn = document.getElementById('saveStrategyBtn');
    var currentId = saveBtn && saveBtn.dataset.currentId ? parseInt(saveBtn.dataset.currentId) : null;

    bridge.save_strategy(name, jsonConfig, currentId || 0).then(function(jsonStr) {
        var result = JSON.parse(jsonStr);
        if (result.success) {
            strategyId = result.id;
            strategyName = name;
            if (saveBtn) saveBtn.dataset.currentId = result.id;
            window.currentStrategyName = name;
            showToast('✅ 已保存 ID=' + result.id, false);
        } else {
            showToast('保存失败: ' + (result.message || ''), true);
        }
    }).catch(function(err) {
        showToast('保存失败: ' + err.message, true);
    });
}

function loadStrategyById(id) {
    if (!bridge) { showToast('Bridge 未连接', true); return; }
    bridge.load_strategy(id).then(function(jsonStr) {
        var obj = JSON.parse(jsonStr);
        if (obj.error) { showToast('加载失败: ' + obj.error, true); return; }
        var config = deserializeConfig(obj.code);
        if (!config) {
            showToast('此策略为旧版代码格式，无法在策略工厂中加载', true);
            return;
        }
        cards = config.cards;
        // 向后兼容：将旧格式仓位卡片转为新格式
        cards.forEach(function(c) {
            if (c.type === 'position' && !c.params.position_mode) {
                var oldPct = c.params.fixedPercent;
                c.params.position_mode = 'percentage';
                c.params.position_value = (oldPct !== undefined) ? oldPct * 100 : 100;
                c.params.quantity_unit = 'shares';
            }
        });
        strategyName = obj.name;
        strategyId = obj.id;
        initialCapital = config.capital || 1000000;
        startDate = config.startDate || '2010-01-01';
        endDate = config.endDate || new Date().toISOString().slice(0, 10);
        stockPool = config.stockPool || '';
        slippage = config.slippage || 'close';
        entryLogic = config.entry_logic || 'all';
        exitLogic = config.exit_logic || 'any';
        window.currentStrategyName = obj.name;

        // Restore pool config
        var pc = config.poolConfig || {};
        poolSource = pc.poolSource || 'all';
        customStockCodes = pc.customStockCodes || '';
        poolIndustryFilter = pc.poolIndustryFilter || '';
        poolConceptFilter = pc.poolConceptFilter || [];
        poolConceptMatchMode = pc.poolConceptMatchMode || 'any';
        poolMarketCapMin = pc.poolMarketCapMin || '';
        poolMarketCapMax = pc.poolMarketCapMax || '';
        poolFloatSharesMin = pc.poolFloatSharesMin || '';
        poolFloatSharesMax = pc.poolFloatSharesMax || '';

        var nameInput = document.getElementById('strategyNameInput');
        if (nameInput) nameInput.value = obj.name;
        var capitalInput = document.getElementById('initialCapitalInput');
        if (capitalInput) capitalInput.value = initialCapital;
        var startInput = document.getElementById('strategyStartDate');
        if (startInput) startInput.value = startDate;
        var endInput = document.getElementById('strategyEndDate');
        if (endInput) endInput.value = endDate;
        // Update pool UI
        var poolRadio = document.querySelector('input[name="poolSource"][value="' + poolSource + '"]');
        if (poolRadio) poolRadio.checked = true;
        var customArea = document.getElementById('poolCustomCodes');
        if (customArea) {
            customArea.value = customStockCodes;
            customArea.style.display = (poolSource === 'custom') ? 'block' : 'none';
        }
        var indSel = document.getElementById('poolIndustryFilter');
        if (indSel) indSel.value = poolIndustryFilter;
        var indInp = document.getElementById('poolIndustryFilterInput');
        if (indInp && poolIndustryFilter) {
            var found = (industryListCache || []).find(function(o) { return o.value === poolIndustryFilter; });
            indInp.value = found ? found.label : poolIndustryFilter;
        }
        var mmSel = document.getElementById('poolConceptMatchMode');
        if (mmSel) mmSel.value = poolConceptMatchMode;
        var mmInp = document.getElementById('poolConceptMatchModeInput');
        if (mmInp) mmInp.value = poolConceptMatchMode === 'all' ? '全部' : '任一';
        var mcMinEl = document.getElementById('poolMarketCapMin');
        if (mcMinEl) mcMinEl.value = poolMarketCapMin;
        var mcMaxEl = document.getElementById('poolMarketCapMax');
        if (mcMaxEl) mcMaxEl.value = poolMarketCapMax;
        var fsMinEl = document.getElementById('poolFloatSharesMin');
        if (fsMinEl) fsMinEl.value = poolFloatSharesMin;
        var fsMaxEl = document.getElementById('poolFloatSharesMax');
        if (fsMaxEl) fsMaxEl.value = poolFloatSharesMax;
        // Re-render concept select with selections restored
        populatePoolConceptSelect('');
        // Trigger pool update
        updateStockPool();
        var slInput = document.getElementById('slippageInput');
        if (slInput) {
            var slOpts = { close: '收盘价成交（回测默认）', next_open: '次日开盘价成交', half_spread: '半价差偏移（仅K线图标记）' };
            slInput.value = slOpts[slippage] || '收盘价成交（回测默认）';
            slInput.setAttribute('data-value', slippage || 'close');
        }
        var entryLogicEl = document.getElementById('entryLogicSelect');
        if (entryLogicEl) {
            var ev = config.entry_logic || 'all';
            entryLogicEl.value = ev === 'all' ? '全部满足（AND）' : '任一满足（OR）';
            entryLogicEl.setAttribute('data-value', ev);
        }
        var exitLogicEl = document.getElementById('exitLogicSelect');
        if (exitLogicEl) {
            var xv = config.exit_logic || 'any';
            exitLogicEl.value = xv === 'all' ? '全部满足（AND）' : '任一满足（OR）';
            exitLogicEl.setAttribute('data-value', xv);
        }

        if (config.commission_rate !== undefined) {
            var commEl = document.getElementById('commissionRate');
            if (commEl) commEl.value = config.commission_rate;
            var stEl = document.getElementById('stampTaxRate');
            if (stEl) stEl.value = config.stamp_tax_rate;
            var sctEl = document.getElementById('slippageCostType');
            if (sctEl) {
                var sctVal = config.slippage_cost_type || 'percent';
                sctEl.value = sctVal === 'fixed' ? '固定点数(元)' : '百分比';
                sctEl.setAttribute('data-value', sctVal);
            }
            var scvEl = document.getElementById('slippageCostValue');
            if (scvEl) scvEl.value = config.slippage_cost_value;
        }
        var saveBtn = document.getElementById('saveStrategyBtn');
        if (saveBtn) saveBtn.dataset.currentId = obj.id;

        renderCards();
        showToast('已加载策略: ' + obj.name, false);
    }).catch(function(err) {
        showToast('加载失败: ' + err.message, true);
    });
}

function newStrategy() {
    cards = [];
    strategyName = '';
    strategyId = null;
    poolSource = 'all';
    customStockCodes = '';
    poolIndustryFilter = '';
    poolConceptFilter = [];
    poolConceptMatchMode = 'any';
    poolMarketCapMin = '';
    poolMarketCapMax = '';
    poolFloatSharesMin = '';
    poolFloatSharesMax = '';
    currentStockPool = [];
    slippage = 'close';
    entryLogic = 'all';
    exitLogic = 'any';
    window.currentStrategyName = undefined;
    window.currentStrategyCode = undefined;
    window._defaultStockFromTemplate = undefined;
    var nameInput = document.getElementById('strategyNameInput');
    if (nameInput) nameInput.value = '';
    // Reset pool UI
    var poolRadio = document.querySelector('input[name="poolSource"][value="all"]');
    if (poolRadio) poolRadio.checked = true;
    var customArea = document.getElementById('poolCustomCodes');
    if (customArea) { customArea.value = ''; customArea.style.display = 'none'; }
    var indSel = document.getElementById('poolIndustryFilter');
    if (indSel) indSel.value = '';
    var mmSel = document.getElementById('poolConceptMatchMode');
    if (mmSel) mmSel.value = 'any';
    var conSel = document.getElementById('poolConceptFilter');
    if (conSel) { conSel.querySelectorAll('option').forEach(function(o) { o.selected = false; }); }
    var mcMinEl = document.getElementById('poolMarketCapMin');
    if (mcMinEl) mcMinEl.value = '';
    var mcMaxEl = document.getElementById('poolMarketCapMax');
    if (mcMaxEl) mcMaxEl.value = '';
    var fsMinEl = document.getElementById('poolFloatSharesMin');
    if (fsMinEl) fsMinEl.value = '';
    var fsMaxEl = document.getElementById('poolFloatSharesMax');
    if (fsMaxEl) fsMaxEl.value = '';
    updatePoolConceptCount();
    updateStockPool();
    var slInput = document.getElementById('slippageInput');
    if (slInput) {
        slInput.value = '收盘价成交（回测默认）';
        slInput.setAttribute('data-value', 'close');
    }
    var el = document.getElementById('entryLogicSelect');
    if (el) { el.value = '全部满足（AND）'; el.setAttribute('data-value', 'all'); }
    el = document.getElementById('exitLogicSelect');
    if (el) { el.value = '任一满足（OR）'; el.setAttribute('data-value', 'any'); }
    var commEl = document.getElementById('commissionRate');
    if (commEl) commEl.value = '0.0003';
    var stEl = document.getElementById('stampTaxRate');
    if (stEl) stEl.value = '0.001';
    var sctEl = document.getElementById('slippageCostType');
    if (sctEl) { sctEl.value = '百分比'; sctEl.setAttribute('data-value', 'percent'); }
    var scvEl = document.getElementById('slippageCostValue');
    if (scvEl) scvEl.value = '0.1';
    var saveBtn = document.getElementById('saveStrategyBtn');
    if (saveBtn) saveBtn.dataset.currentId = '';
    renderCards();
    showToast('已新建空白策略', false);
}

// ---- Code Preview ----

function toggleCodePreview() {
    codeExpanded = !codeExpanded;
    var preview = document.getElementById('codePreviewArea');
    var toggleBtn = document.getElementById('toggleCodePreviewBtn');
    if (preview) preview.style.display = codeExpanded ? 'block' : 'none';
    if (toggleBtn) toggleBtn.textContent = codeExpanded ? '🔼 隐藏代码' : '📝 预览代码';
}

function updateCodePreview() {
    var preview = document.getElementById('codePreviewArea');
    if (!preview) return;
    var code = generateCode(cards);
    preview.textContent = code;
}

// ---- Main Render ----

export function renderStrategyPage(container) {
    container.innerHTML = '';

    if (window.currentStrategyCode && cards.length === 0) {
        // Try to load from window.currentStrategyCode if it's a JSON config
        var config = deserializeConfig(window.currentStrategyCode);
        if (config) {
            cards = config.cards;
            initialCapital = config.capital || 1000000;
            startDate = config.startDate || '2010-01-01';
            endDate = config.endDate || new Date().toISOString().slice(0, 10);
            stockPool = config.stockPool || '';
            slippage = config.slippage || 'close';
            entryLogic = config.entry_logic || 'all';
            exitLogic = config.exit_logic || 'any';
            // Restore pool config from saved strategy
            if (config.poolConfig) {
                var pc = config.poolConfig;
                poolSource = pc.poolSource || 'all';
                customStockCodes = pc.customStockCodes || '';
                poolIndustryFilter = pc.poolIndustryFilter || '';
                poolConceptFilter = pc.poolConceptFilter || [];
                poolConceptMatchMode = pc.poolConceptMatchMode || 'any';
                poolMarketCapMin = pc.poolMarketCapMin || '';
                poolMarketCapMax = pc.poolMarketCapMax || '';
                poolFloatSharesMin = pc.poolFloatSharesMin || '';
                poolFloatSharesMax = pc.poolFloatSharesMax || '';
            }
        }
    }

    var capital = initialCapital;
    var today = new Date().toISOString().slice(0, 10);

    var html = '<div class="card">' +
        '<div class="card-title">🏭 策略工厂</div>' +
        '<div class="metric-row" style="margin-top:4px;">' +
        '<span>策略名称:</span>' +
        '<input type="text" id="strategyNameInput" placeholder="输入策略名称" value="' + escapeHtml(strategyName) + '" ' +
        'style="width:180px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<button id="loadStrategyListBtn" style="background:#2a3a5a;">📂 我的策略</button>' +
        '<button id="loadTemplateBtn" style="background:#2a3a5a;">📋 模板</button>' +
        '<button id="saveStrategyBtn" style="background:#2a3a5a;">💾 保存</button>' +
        '<button id="newStrategyBtn">📄 新建</button>' +
        '<button id="deleteStrategyBtn">🗑 删除</button>' +
        '</div>' +
        // ---- Layered Stock Pool Selector ----
        '<div class="metric-row" style="margin-top:8px;align-items:flex-start;">' +
        '<span style="color:#9aa9cc;padding-top:4px;">股票池:</span>' +
        '<div style="flex:1;min-width:0;">' +
        // Radio buttons for pool source
        '<div id="poolSourceRow" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">' +
        '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="poolSource" value="all"' + (poolSource === 'all' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 全市场</label>' +
        '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="poolSource" value="hs300"' + (poolSource === 'hs300' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 沪深300</label>' +
        '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="poolSource" value="zz500"' + (poolSource === 'zz500' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 中证500</label>' +
        '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="poolSource" value="zz1000"' + (poolSource === 'zz1000' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 中证1000</label>' +
        '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="poolSource" value="cyb"' + (poolSource === 'cyb' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 创业板</label>' +
        '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="poolSource" value="kc50"' + (poolSource === 'kc50' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 科创50</label>' +
        '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="poolSource" value="custom"' + (poolSource === 'custom' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 自定义</label>' +
        '</div>' +
        // Custom codes textarea (hidden unless custom source)
        '<textarea id="poolCustomCodes" rows="2" placeholder="输入股票代码，每行一个或用逗号分隔" ' +
        'style="display:' + (poolSource === 'custom' ? 'block' : 'none') + ';width:100%;background:#1e253b;border:1px solid #323d5a;border-radius:12px;color:#fff;padding:6px 10px;font-size:12px;font-family:monospace;resize:vertical;box-sizing:border-box;">' + escapeHtml(customStockCodes) + '</textarea>' +
        // Optional filters
        '<div id="poolOptionalFilters" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px;">' +
        '<span style="color:#9aa9cc;font-size:11px;">筛选:</span>' +
        // Market cap range
        '<span style="color:#7a8ba8;font-size:10px;">总市值(亿)</span>' +
        '<input id="poolMarketCapMin" type="number" min="0" step="1" placeholder="最小" value="' + escapeHtml(poolMarketCapMin) + '" ' +
        'style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;">' +
        '<span style="color:#7a8ba8;font-size:10px;">-</span>' +
        '<input id="poolMarketCapMax" type="number" min="0" step="1" placeholder="最大" value="' + escapeHtml(poolMarketCapMax) + '" ' +
        'style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;">' +
        // Float shares range
        '<span style="color:#7a8ba8;font-size:10px;">股本(亿股)</span>' +
        '<input id="poolFloatSharesMin" type="number" min="0" step="0.1" placeholder="最小" value="' + escapeHtml(poolFloatSharesMin) + '" ' +
        'style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;">' +
        '<span style="color:#7a8ba8;font-size:10px;">-</span>' +
        '<input id="poolFloatSharesMax" type="number" min="0" step="0.1" placeholder="最大" value="' + escapeHtml(poolFloatSharesMax) + '" ' +
        'style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;">' +
        // Industry filter (custom select)
        '<select id="poolIndustryFilter" style="display:none;">' +
        '<option value="">-- 行业(可选) --</option>' +
        '</select>' +
        '<input id="poolIndustryFilterInput" type="text" readonly placeholder="-- 行业(可选) --" ' +
        'style="background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 10px;font-size:11px;max-width:160px;cursor:pointer;">' +
        '<input id="poolConceptSearch" type="text" placeholder="搜索概念..." ' +
        'style="width:110px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 10px;font-size:11px;">' +
        '<select id="poolConceptFilter" multiple size="3" ' +
        'style="min-width:160px;max-width:240px;background:#1e253b;border:1px solid #323d5a;border-radius:8px;color:#fff;font-size:11px;padding:2px;"></select>' +
        '<select id="poolConceptMatchMode" style="display:none;">' +
        '<option value="any"' + (poolConceptMatchMode === 'any' ? ' selected' : '') + '>任一</option>' +
        '<option value="all"' + (poolConceptMatchMode === 'all' ? ' selected' : '') + '>全部</option>' +
        '</select>' +
        '<input id="poolConceptMatchModeInput" type="text" readonly ' +
        'value="' + (poolConceptMatchMode === 'all' ? '全部' : '任一') + '" ' +
        'style="background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;cursor:pointer;">' +
        '<span id="poolConceptCount" style="color:#9aa9cc;font-size:11px;"></span>' +
        '<button id="poolResetFiltersBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;padding:3px 10px;border-radius:20px;font-size:11px;cursor:pointer;">重置</button>' +
        '</div>' +
        // Preview area
        '<div id="poolPreview" style="margin-top:4px;color:#9aa9cc;font-size:11px;line-height:1.5;">' +
        '<span id="poolPreviewText" style="color:#7a8ba8;">加载中...</span>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="metric-row" style="margin-top:8px;">' +
        '<span>初始资金:</span>' +
        '<input type="number" id="initialCapitalInput" min="0" max="2000000" step="10000" value="' + capital + '" ' +
        'style="width:150px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<span>起始日期:</span>' +
        '<input type="text" class="datepicker-input" id="strategyStartDate" value="' + startDate + '" readonly ' +
        'style="width:120px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<span>结束日期:</span>' +
        '<input type="text" class="datepicker-input" id="strategyEndDate" value="' + (endDate || today) + '" readonly ' +
        'style="width:120px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '</div>' +
        '<div class="metric-row" style="margin-top:8px;">' +
        '<span>入场条件逻辑:</span>' +
        '<input type="text" id="entryLogicSelect" readonly data-value="' + entryLogic + '" ' +
        'value="' + (entryLogic === 'all' ? '全部满足（AND）' : '任一满足（OR）') + '" ' +
        'style="width:180px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 28px 6px 10px; font-size:13px; cursor:pointer; ' +
        'background-image:url(data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2010%2010%22%3E%3Cpath%20d%3D%22M0%203l5%205%205-5z%22%20fill%3D%22%239aa9cc%22%2F%3E%3C%2Fsvg%3E); background-repeat:no-repeat; background-position:right 10px center;">' +
        '<span style="margin-left:16px;">离场条件逻辑:</span>' +
        '<input type="text" id="exitLogicSelect" readonly data-value="' + exitLogic + '" ' +
        'value="' + (exitLogic === 'all' ? '全部满足（AND）' : '任一满足（OR）') + '" ' +
        'style="width:180px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 28px 6px 10px; font-size:13px; cursor:pointer; ' +
        'background-image:url(data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2010%2010%22%3E%3Cpath%20d%3D%22M0%203l5%205%205-5z%22%20fill%3D%22%239aa9cc%22%2F%3E%3C%2Fsvg%3E); background-repeat:no-repeat; background-position:right 10px center;">' +
        '<span>成交价:</span>' +
        '<input type="text" id="slippageInput" value="收盘价成交（回测默认）" readonly data-value="close" ' +
        'style="width:180px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 30px 6px 10px; font-size:13px; cursor:pointer; ' +
        'background-image:url(data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2010%2010%22%3E%3Cpath%20d%3D%22M0%203l5%205%205-5z%22%20fill%3D%22%239aa9cc%22%2F%3E%3C%2Fsvg%3E); background-repeat:no-repeat; background-position:right 10px center;">' +
        '</div>' +
        '<div class="metric-row" style="margin-top:8px;">' +
        '<span>佣金率:</span>' +
        '<input type="number" id="commissionRate" value="0.0003" step="0.0001" min="0" max="0.003" style="width:100px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<span>印花税率:</span>' +
        '<input type="number" id="stampTaxRate" value="0.001" step="0.0001" min="0" max="0.003" style="width:100px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<span>滑点类型:</span>' +
        '<input type="text" id="slippageCostType" value="百分比" readonly data-value="percent" ' +
        'style="width:120px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 30px 6px 10px; font-size:13px; cursor:pointer; ' +
        'background-image:url(data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2010%2010%22%3E%3Cpath%20d%3D%22M0%203l5%205%205-5z%22%20fill%3D%22%239aa9cc%22%2F%3E%3C%2Fsvg%3E); background-repeat:no-repeat; background-position:right 10px center;">' +
        '<span>滑点值:</span>' +
        '<input type="number" id="slippageCostValue" value="0.1" step="0.01" min="0" style="width:80px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<span style="margin-left:12px;">对比基准:</span>' +
        '<div style="position:relative;display:inline-block;">' +
        '<input type="text" id="benchmarkSelect" value="沪深300" readonly data-value="000300.SH" ' +
        'style="width:140px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 28px 6px 10px; font-size:13px; cursor:pointer; ' +
        'background-image:url(data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2010%2010%22%3E%3Cpath%20d%3D%22M0%203l5%205%205-5z%22%20fill%3D%22%239aa9cc%22%2F%3E%3C%2Fsvg%3E); background-repeat:no-repeat; background-position:right 10px center; box-sizing:border-box;">' +
        '<span id="benchmarkArrow" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#9aa9cc;pointer-events:none;font-size:10px;">▼</span>' +
        '</div>' +
        '<span style="font-size:12px; color:#9aa9cc;">(买入增加成本，卖出减少收入，卖出额外加印花税)</span>' +
        '</div></div>' +

        '<div class="card" style="margin-top:12px;">' +
        '<div class="card-title">📋 策略卡片</div>' +
        '<div id="cardList"></div>' +
        '<div style="margin-top:8px;text-align:center;">' +
        '<button id="addCardBtn" style="background:#4f7eff;border:none;padding:8px 24px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;">+ 添加条件</button>' +
        '</div></div>' +

        '<div class="card" style="margin-top:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<button id="toggleCodePreviewBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;padding:6px 14px;border-radius:20px;cursor:pointer;">📝 预览代码</button>' +
        '<button id="runBacktestBtn" style="background:#4f7eff;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;">▶ 运行回测</button>' +
        '<button id="compareBacktestBtn" style="background:transparent;border:1px solid #f2c94c;padding:6px 16px;border-radius:30px;color:#f2c94c;font-weight:600;cursor:pointer;">🔬 对比回测</button>' +
        "<button id=\"openOptPanelBtn\" style=\"background:#2d3a5e;border:none;padding:6px 16px;border-radius:30px;color:#fff;cursor:pointer;font-size:13px;\">🔍 参数优化</button>" +
        '<button id="startRealtimeBtn" style="background:#22c55e;border:none;padding:6px 16px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;margin-left:6px;">▶ 实时模拟</button>' +
        '<button id="stopRealtimeBtn" style="background:transparent;border:1px solid #ef4444;padding:6px 16px;border-radius:30px;color:#ef4444;font-weight:600;cursor:pointer;margin-left:6px;">⏹ 停止实时</button>' +
        '</div>' +
        '<pre id="codePreviewArea" style="display:none;max-height:300px;overflow-y:auto;background:#0e1220;border:1px solid #323d5a;border-radius:12px;padding:12px;color:#9aa9cc;font-size:11px;font-family:monospace;white-space:pre-wrap;word-break:break-all;"></pre>' +
        '</div>' +

        '<div class="card" style="margin-top:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<h4 style="color:#ffffff;margin:0;">📋 回测日志</h4>' +
        '<div style="display:flex;gap:8px;">' +
        '<button id="toggleLogBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;">🔼 折叠</button>' +
        '<button id="exportLogBtn" style="background:transparent;border:1px solid #4f7eff;color:#4f7eff;">📄 导出</button>' +
        '<button id="clearLogBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;">清除</button>' +
        '</div></div>' +
        '<div id="strategyLogWrapper">' +
        '<div id="strategyLogToolbar"></div>' +
        '<div id="strategyLogBox" style="height:200px;overflow-y:auto;background:#0e1220;border:1px solid #323d5a;border-radius:12px;padding:8px;color:#9aa9cc;font-size:12px;font-family:monospace;"></div>' +
        '</div>' +
        '</div>';

    container.innerHTML = html;

    // Reference DOM elements
    logContainer = document.getElementById('strategyLogBox');
    strategyLogger = new Logger('strategyLogBox', 'strategyLogToolbar', { maxEntries: 500 });
    strategyLogger.init();

    // Bind date pickers
    var startDateInput = document.getElementById('strategyStartDate');
    var endDateInput = document.getElementById('strategyEndDate');
    if (startDateInput) bindDatePicker(startDateInput);
    if (endDateInput) {
        if (!endDateInput.value) endDateInput.value = today;
        bindDatePicker(endDateInput);
    }

    // Capital change handler
    var capitalInput = document.getElementById('initialCapitalInput');
    if (capitalInput) {
        capitalInput.addEventListener('change', function() {
            initialCapital = Number(this.value) || 1000000;
            window._initialCapital = initialCapital;
        });
    }

    // Slippage dropdown — custom select panel (QtWebEngine does not support datalist)
    var slippageInput = document.getElementById('slippageInput');
    if (slippageInput) {
        slippageInput.addEventListener('click', function() {
            showCustomSelect(slippageInput, [
                { value: 'close', label: '收盘价成交（回测默认）' },
                { value: 'next_open', label: '次日开盘价成交' },
                { value: 'half_spread', label: '半价差偏移（仅K线图标记）' }
            ], function(selectedValue) {
                // value and data-value are already set by showCustomSelect
            });
        });
    }

    // Slippage cost type dropdown — custom select panel
    var slippageCostTypeInput = document.getElementById('slippageCostType');
    if (slippageCostTypeInput) {
        slippageCostTypeInput.addEventListener('click', function() {
            showCustomSelect(slippageCostTypeInput, [
                { value: 'percent', label: '百分比' },
                { value: 'fixed', label: '固定点数(元)' }
            ], function(selectedValue) {});
        });
    }

    // Entry logic dropdown — custom select panel
    var entryLogicInput = document.getElementById('entryLogicSelect');
    if (entryLogicInput) {
        entryLogicInput.addEventListener('click', function() {
            showCustomSelect(entryLogicInput, [
                { value: 'all', label: '全部满足（AND）' },
                { value: 'any', label: '任一满足（OR）' }
            ], function(selectedValue) {});
        });
    }

    // Exit logic dropdown — custom select panel
    var exitLogicInput = document.getElementById('exitLogicSelect');
    if (exitLogicInput) {
        exitLogicInput.addEventListener('click', function() {
            showCustomSelect(exitLogicInput, [
                { value: 'all', label: '全部满足（AND）' },
                { value: 'any', label: '任一满足（OR）' }
            ], function(selectedValue) {});
        });
    }

    // Benchmark dropdown — custom select panel
    var staticBenchmarkOptions = [
        { value: '000300.SH', label: '沪深300' },
        { value: '000001.SH', label: '上证指数' },
        { value: '399001.SZ', label: '深证成指' },
        { value: '000905.SH', label: '中证500' },
        { value: '399006.SZ', label: '创业板指' },
        { value: '', label: '无（不对比）' }
    ];
    var benchmarkSelect = document.getElementById('benchmarkSelect');
    if (benchmarkSelect) {
        benchmarkSelect.addEventListener('click', function() {
            showCustomSelect(benchmarkSelect, staticBenchmarkOptions, function(val) {
                var opt = staticBenchmarkOptions.find(function(o) { return o.value === val; });
                if (opt) {
                    benchmarkSelect.value = opt.label;
                    benchmarkSelect.setAttribute('data-value', opt.value);
                }
            });
        });
    }

    // Save button
    var saveBtn = document.getElementById('saveStrategyBtn');
    if (saveBtn && strategyId) saveBtn.dataset.currentId = strategyId;

    // Button events
    var addBtn = document.getElementById('addCardBtn');
    if (addBtn) addBtn.addEventListener('click', showAddCardModal);

    var templateBtn = document.getElementById('loadTemplateBtn');
    if (templateBtn) templateBtn.addEventListener('click', showTemplateModal);

    var listBtn = document.getElementById('loadStrategyListBtn');
    if (listBtn) listBtn.addEventListener('click', showStrategyListModal);

    var saveBtnEl = document.getElementById('saveStrategyBtn');
    if (saveBtnEl) saveBtnEl.addEventListener('click', saveCurrentStrategy);

    var newBtn = document.getElementById('newStrategyBtn');
    if (newBtn) newBtn.addEventListener('click', newStrategy);

    var deleteBtn = document.getElementById('deleteStrategyBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
            var id = saveBtn && saveBtn.dataset.currentId;
            if (!id) { showToast('请先保存策略再删除', true); return; }
            if (!confirm('确认删除策略 ID=' + id + ' 吗？')) return;
            bridge.delete_strategy(parseInt(id)).then(function() {
                newStrategy();
                showToast('删除成功', false);
            }).catch(function(err) {
                showToast('删除失败: ' + err.message, true);
            });
        });
    }

    var toggleCodeBtn = document.getElementById('toggleCodePreviewBtn');
    if (toggleCodeBtn) toggleCodeBtn.addEventListener('click', toggleCodePreview);

    var runBtn = document.getElementById('runBacktestBtn');
    if (runBtn) runBtn.addEventListener('click', showBacktestModal);

    var optBtn = document.getElementById('openOptPanelBtn');
    if (optBtn) {
        optBtn.addEventListener('click', function() {
            validateAndOpenOptPanel();
        });
    }

    var compareBtn = document.getElementById('compareBacktestBtn');
    if (compareBtn) {
        compareBtn.addEventListener('click', function() {
            var validation = validateCards(cards);
            if (!validation.valid) {
                showToast(validation.errors[0], true);
                return;
            }
            if (cards.length === 0) {
                showToast('请先添加策略卡片', true);
                return;
            }

            // Read page params — 对比回测自动截断过大的股票池
            var MAX_STOCKS_FOR_COMPARE = 268;
            var finalStockPool = currentStockPool;
            if (finalStockPool && finalStockPool.length > MAX_STOCKS_FOR_COMPARE) {
                finalStockPool = finalStockPool.slice(0, MAX_STOCKS_FOR_COMPARE);
                showToast('当前股票池数量较多（' + currentStockPool.length + ' 只），对比回测将自动截断至前 ' + MAX_STOCKS_FOR_COMPARE + ' 只。', false, 4000);
            }
            var defaultStock = (finalStockPool && finalStockPool.length > 0) ? finalStockPool.join(',') : ((window._defaultStockFromTemplate) || '000001');

            var pageStartInput = document.getElementById('strategyStartDate');
            var pageEndInput = document.getElementById('strategyEndDate');
            var startDt = pageStartInput ? pageStartInput.value : startDate;
            var endDt = pageEndInput ? pageEndInput.value : endDate;

            var capitalInput = document.getElementById('initialCapitalInput');
            var cashVal = capitalInput ? (Number(capitalInput.value) || 100000) : initialCapital;

            var slippageInput = document.getElementById('slippageInput');
            var slippageType = slippageInput ? (slippageInput.getAttribute('data-value') || 'close') : 'close';

            var commissionInput = document.getElementById('commissionRate');
            var commissionVal = commissionInput ? (Number(commissionInput.value) || 0.0003) : 0.0003;

            var stampTaxInput = document.getElementById('stampTaxRate');
            var stampTaxVal = stampTaxInput ? (Number(stampTaxInput.value) || 0.001) : 0.001;

            var slCostTypeInput = document.getElementById('slippageCostType');
            var slCostTypeVal = slCostTypeInput ? (slCostTypeInput.getAttribute('data-value') || 'percent') : 'percent';

            var slCostValueInput = document.getElementById('slippageCostValue');
            var slCostValueVal = slCostValueInput ? (Number(slCostValueInput.value) || 0.1) : 0.1;

            // Set strategy name
            window.currentStrategyName = strategyName || '未命名策略';

            showCompareBacktestModal(cards, defaultStock, startDt, endDt, cashVal, slippageType,
                commissionVal, stampTaxVal, slCostTypeVal, slCostValueVal);
        });
    }

    // ---- 实时策略按钮：一键跳转到实时模拟页面 ----
    var startRealtimeBtn = document.getElementById('startRealtimeBtn');
    if (startRealtimeBtn) {
        startRealtimeBtn.addEventListener('click', function() {
            if (!bridge) { showToast('Bridge 未连接', true); return; }
            var validation = validateCards(cards);
            if (!validation.valid) {
                showToast(validation.errors[0], true);
                return;
            }
            if (cards.length === 0) {
                showToast('请先添加策略卡片', true);
                return;
            }
            if (!currentStockPool || currentStockPool.length === 0) {
                showToast('请先在股票池中添加股票', true);
                return;
            }
            var code = generateCode(cards);
            var capitalInput = document.getElementById('initialCapitalInput');
            var cash = capitalInput ? (Number(capitalInput.value) || 100000) : 100000;
            window._realtimeSimParams = {
                strategyCode: code,
                stockPool: currentStockPool.slice(0, 50),
                cash: cash,
                interval: 3
            };
            var nav = document.querySelector('.nav-item[data-page="realtimeSim"]');
            if (nav) {
                nav.click();
                showToast('参数已传递到实时模拟页面，请确认后启动');
            } else {
                showToast('未找到实时模拟导航项', true);
            }
        });
    }

    var stopRealtimeBtn = document.getElementById('stopRealtimeBtn');
    if (stopRealtimeBtn) {
        stopRealtimeBtn.addEventListener('click', function() {
            if (!bridge) { showToast('Bridge 未连接', true); return; }
            bridge.stop_realtime_strategy().then(function(resp) {
                var r = JSON.parse(resp);
                showToast(r.message || '实时策略已停止', !r.success);
            }).catch(function(err) {
                showToast('停止失败: ' + err.message, true);
            });
        });
    }

    var clearLogBtn = document.getElementById('clearLogBtn');
    if (clearLogBtn) clearLogBtn.addEventListener('click', clearLog);

    var exportLogBtn = document.getElementById('exportLogBtn');
    if (exportLogBtn) exportLogBtn.addEventListener('click', function() {
        strategyLogger.exportLog();
    });

    var toggleLogBtn = document.getElementById('toggleLogBtn');
    if (toggleLogBtn) {
        toggleLogBtn.addEventListener('click', function() {
            logExpanded = !logExpanded;
            var wrapper = document.getElementById('strategyLogWrapper');
            if (wrapper) wrapper.style.display = logExpanded ? 'block' : 'none';
            toggleLogBtn.textContent = logExpanded ? '🔼 折叠' : '🔽 展开';
        });
    }

    // ---- Pool Selector Events ----
    var poolSourceRadios = document.querySelectorAll('input[name="poolSource"]');
    poolSourceRadios.forEach(function(radio) {
        radio.addEventListener('change', function() {
            if (this.checked) {
                poolSource = this.value;
                var customArea = document.getElementById('poolCustomCodes');
                if (customArea) customArea.style.display = (poolSource === 'custom') ? 'block' : 'none';
                updateStockPool();
            }
        });
    });

    var customCodesEl = document.getElementById('poolCustomCodes');
    if (customCodesEl) {
        customCodesEl.addEventListener('input', function() {
            customStockCodes = this.value;
            updateStockPool();
        });
    }

    var industryFilterEl = document.getElementById('poolIndustryFilter');
    if (industryFilterEl) {
        industryFilterEl.addEventListener('change', function() {
            poolIndustryFilter = this.value;
            updateStockPool();
            // 同步自定义输入框
            var inp = document.getElementById('poolIndustryFilterInput');
            if (inp) {
                var found = (industryListCache || []).find(function(o) { return o.value === poolIndustryFilter; });
                inp.value = found ? found.label : (poolIndustryFilter || '');
                if (!poolIndustryFilter) inp.placeholder = '-- 行业(可选) --';
            }
        });
    }
    // 行业自定义下拉输入框
    var indCustomInput = document.getElementById('poolIndustryFilterInput');
    if (indCustomInput) {
        indCustomInput.addEventListener('click', function(e) {
            e.stopPropagation();
            var sel = document.getElementById('poolIndustryFilter');
            if (!sel) return;
            var opts = [];
            for (var k = 0; k < sel.options.length; k++) {
                opts.push({ value: sel.options[k].value, label: sel.options[k].textContent });
            }
            showCustomSelect(this, opts, function(val) {
                sel.value = val;
                poolIndustryFilter = val;
                updateStockPool();
                var inp = document.getElementById('poolIndustryFilterInput');
                if (inp) {
                    var found = (industryListCache || []).find(function(o) { return o.value === val; });
                    inp.value = found ? found.label : (val || '');
                    if (!val) inp.placeholder = '-- 行业(可选) --';
                }
            });
        });
    }

    // Market cap inputs — debounced
    var mcMinEl = document.getElementById('poolMarketCapMin');
    if (mcMinEl) {
        mcMinEl.addEventListener('input', function() {
            poolMarketCapMin = this.value;
            debounceUpdatePool();
        });
    }
    var mcMaxEl = document.getElementById('poolMarketCapMax');
    if (mcMaxEl) {
        mcMaxEl.addEventListener('input', function() {
            poolMarketCapMax = this.value;
            debounceUpdatePool();
        });
    }

    // Float shares inputs — debounced
    var fsMinEl = document.getElementById('poolFloatSharesMin');
    if (fsMinEl) {
        fsMinEl.addEventListener('input', function() {
            poolFloatSharesMin = this.value;
            debounceUpdatePool();
        });
    }
    var fsMaxEl = document.getElementById('poolFloatSharesMax');
    if (fsMaxEl) {
        fsMaxEl.addEventListener('input', function() {
            poolFloatSharesMax = this.value;
            debounceUpdatePool();
        });
    }

    var conceptSearchEl = document.getElementById('poolConceptSearch');
    if (conceptSearchEl) {
        conceptSearchEl.addEventListener('input', function() {
            populatePoolConceptSelect(this.value);
        });
    }

    var conceptFilterEl = document.getElementById('poolConceptFilter');
    if (conceptFilterEl) {
        conceptFilterEl.addEventListener('change', function() {
            poolConceptFilter = Array.from(this.selectedOptions).map(function(o) { return o.value; });
            updatePoolConceptCount();
            updateStockPool();
        });
    }

    var matchModeEl = document.getElementById('poolConceptMatchMode');
    if (matchModeEl) {
        matchModeEl.addEventListener('change', function() {
            poolConceptMatchMode = this.value;
            updateStockPool();
            var inp = document.getElementById('poolConceptMatchModeInput');
            if (inp) inp.value = poolConceptMatchMode === 'all' ? '全部' : '任一';
        });
    }
    // 概念匹配模式自定义下拉
    var mmCustomInput = document.getElementById('poolConceptMatchModeInput');
    if (mmCustomInput) {
        mmCustomInput.addEventListener('click', function(e) {
            e.stopPropagation();
            showCustomSelect(this, [
                { value: 'any', label: '任一' },
                { value: 'all', label: '全部' }
            ], function(val) {
                var sel = document.getElementById('poolConceptMatchMode');
                if (sel) { sel.value = val; sel.dispatchEvent(new Event('change')); }
            });
        });
    }

    var resetFiltersBtn = document.getElementById('poolResetFiltersBtn');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', function() {
            poolMarketCapMin = '';
            poolMarketCapMax = '';
            poolFloatSharesMin = '';
            poolFloatSharesMax = '';
            poolIndustryFilter = '';
            poolConceptFilter = [];
            poolConceptMatchMode = 'any';
            document.getElementById('poolMarketCapMin').value = '';
            document.getElementById('poolMarketCapMax').value = '';
            document.getElementById('poolFloatSharesMin').value = '';
            document.getElementById('poolFloatSharesMax').value = '';
            var indSel = document.getElementById('poolIndustryFilter');
            if (indSel) indSel.value = '';
            var indInp = document.getElementById('poolIndustryFilterInput');
            if (indInp) { indInp.value = ''; indInp.placeholder = '-- 行业(可选) --'; }
            var conSel = document.getElementById('poolConceptFilter');
            if (conSel) { conSel.querySelectorAll('option').forEach(function(o) { o.selected = false; }); }
            var mmSel = document.getElementById('poolConceptMatchMode');
            if (mmSel) mmSel.value = 'any';
            var mmInp = document.getElementById('poolConceptMatchModeInput');
            if (mmInp) mmInp.value = '任一';
            updatePoolConceptCount();
            updateStockPool();
        });
    }

    // Populate concept/industry selects initially
    populatePoolConceptSelect('');
    populatePoolIndustrySelect();

    // Initialize pool
    initPoolSelector();

    // Debounce helper — delays updateStockPool by 400ms to avoid rapid backend calls
    function debounceUpdatePool() {
        if (poolDebounceTimer) clearTimeout(poolDebounceTimer);
        poolDebounceTimer = setTimeout(function() {
            updateStockPool();
        }, 400);
    }

    // Render cards
    loadDynamicOptions();
    renderCards();
    updateCodePreview();
}

// ---- Pool Selector Functions ----

var INDEX_CODE_MAP = {
    'hs300': '000300.XSHG',
    'zz500': '000905.XSHG',
    'zz1000': '000852.XSHG',
    'cyb': '399006.XSHE',
    'kc50': '000688.XSHG'
};

function initPoolSelector() {
    if (poolInitialized) return;
    poolInitialized = true;

    // Load all stocks cache
    if (bridge && typeof bridge.get_all_stocks === 'function') {
        bridge.get_all_stocks().then(function(jsonStr) {
            try {
                var list = JSON.parse(jsonStr);
                if (Array.isArray(list)) {
                    allStocksCache = list;
                }
            } catch(e) {}
            updateStockPool();
        }).catch(function() {
            updateStockPool();
        });
    } else {
        updateStockPool();
    }
}

function updateStockPool() {
    var previewEl = document.getElementById('poolPreviewText');
    if (!previewEl) return;

    previewEl.textContent = '计算中...';
    previewEl.style.color = '#7a8ba8';

    var promise;
    if (poolSource === 'custom') {
        // Parse custom codes
        var codes = [];
        (customStockCodes || '').split(/[\n,]+/).forEach(function(part) {
            var c = part.trim();
            if (c) codes.push(c);
        });
        codes = codes.filter(function(v, i, a) { return a.indexOf(v) === i; });
        promise = Promise.resolve(codes);
    } else if (poolSource === 'all') {
        promise = Promise.resolve(allStocksCache.slice());
    } else {
        var indexCode = INDEX_CODE_MAP[poolSource];
        if (indexCode && bridge && typeof bridge.get_index_stocks === 'function') {
            promise = bridge.get_index_stocks(indexCode).then(function(jsonStr) {
                try {
                    var list = JSON.parse(jsonStr);
                    return Array.isArray(list) ? list : [];
                } catch(e) { return []; }
            }).then(function(codes) {
                // Fallback: if index components are empty, use prefix-based lookup
                if (codes.length === 0 && poolSource === 'cyb' && bridge && typeof bridge.get_stocks_by_prefix === 'function') {
                    return bridge.get_stocks_by_prefix('30').then(function(jsonStr) {
                        try {
                            var list = JSON.parse(jsonStr);
                            return Array.isArray(list) ? list : [];
                        } catch(e) { return []; }
                    });
                }
                return codes;
            });
        } else {
            promise = Promise.resolve([]);
        }
    }

    promise.then(function(baseCodes) {
        if (!baseCodes || baseCodes.length === 0) {
            currentStockPool = [];
            previewEl.textContent = '股票池: 0 只';
            previewEl.style.color = '#ff4c4c';
            return;
        }

        // Apply optional industry filter
        var nextPromise;
        if (poolIndustryFilter && bridge && typeof bridge.filter_stocks_by_industry === 'function') {
            nextPromise = bridge.filter_stocks_by_industry(JSON.stringify(baseCodes), poolIndustryFilter).then(function(jsonStr) {
                try {
                    var filtered = JSON.parse(jsonStr);
                    return Array.isArray(filtered) ? filtered : baseCodes;
                } catch(e) { return baseCodes; }
            });
        } else {
            nextPromise = Promise.resolve(baseCodes);
        }

        nextPromise.then(function(codesAfterIndustry) {
            // Apply optional market cap filter
            var mcPromise;
            var mcMin = (poolMarketCapMin || '').toString().trim();
            var mcMax = (poolMarketCapMax || '').toString().trim();
            if ((mcMin || mcMax) && bridge && typeof bridge.filter_stocks_by_market_cap === 'function') {
                mcPromise = bridge.filter_stocks_by_market_cap(
                    JSON.stringify(codesAfterIndustry), mcMin, mcMax
                ).then(function(jsonStr) {
                    try {
                        var filtered = JSON.parse(jsonStr);
                        return Array.isArray(filtered) ? filtered : codesAfterIndustry;
                    } catch(e) { return codesAfterIndustry; }
                });
            } else {
                mcPromise = Promise.resolve(codesAfterIndustry);
            }

            mcPromise.then(function(codesAfterMC) {
                // Apply optional float shares filter
                var fsPromise;
                var fsMin = (poolFloatSharesMin || '').toString().trim();
                var fsMax = (poolFloatSharesMax || '').toString().trim();
                if ((fsMin || fsMax) && bridge && typeof bridge.filter_stocks_by_float_shares === 'function') {
                    fsPromise = bridge.filter_stocks_by_float_shares(
                        JSON.stringify(codesAfterMC), fsMin, fsMax
                    ).then(function(jsonStr) {
                        try {
                            var filtered = JSON.parse(jsonStr);
                            return Array.isArray(filtered) ? filtered : codesAfterMC;
                        } catch(e) { return codesAfterMC; }
                    });
                } else {
                    fsPromise = Promise.resolve(codesAfterMC);
                }

                fsPromise.then(function(codesAfterFS) {
                    // Apply optional concept filter
                    var finalPromise;
                    if (poolConceptFilter.length > 0 && bridge && typeof bridge.filter_stocks_by_concepts === 'function') {
                        finalPromise = bridge.filter_stocks_by_concepts(
                            JSON.stringify(codesAfterFS),
                            JSON.stringify(poolConceptFilter),
                            poolConceptMatchMode
                        ).then(function(jsonStr) {
                            try {
                                var filtered = JSON.parse(jsonStr);
                                return Array.isArray(filtered) ? filtered : codesAfterFS;
                            } catch(e) { return codesAfterFS; }
                        });
                    } else {
                        finalPromise = Promise.resolve(codesAfterFS);
                    }
                    finalPromise.then(function(finalCodes) {
                currentStockPool = finalCodes;
                var count = finalCodes.length;
                var preview10 = finalCodes.slice(0, 10).join(", ");
                var suffix = count > 10 ? " ..." : "";
                previewEl.textContent = "股票池: " + count + " 只 | 前10: " + preview10 + suffix;
                previewEl.style.color = count > 0 ? "#4f7eff" : "#ff4c4c";
                    });

                });
            });
        });
    }).catch(function(err) {
        currentStockPool = [];
        previewEl.textContent = '加载失败: ' + (err.message || err);
        previewEl.style.color = '#ff4c4c';
    });
}
function populatePoolConceptSelect(filterText) {
    var select = document.getElementById('poolConceptFilter');
    if (!select) return;
    var lowerFilter = (filterText || '').toLowerCase();
    select.innerHTML = '';
    (conceptListCache || []).forEach(function(opt) {
        if (!filterText || opt.label.toLowerCase().indexOf(lowerFilter) !== -1) {
            var option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (poolConceptFilter.indexOf(opt.value) !== -1) {
                option.selected = true;
            }
            select.appendChild(option);
        }
    });
    updatePoolConceptCount();
}

function populatePoolIndustrySelect() {
    var select = document.getElementById('poolIndustryFilter');
    if (!select) return;
    var currentVal = select.value || poolIndustryFilter;
    select.innerHTML = '<option value="">-- 行业(可选) --</option>';
    (industryListCache || []).forEach(function(opt) {
        var option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === currentVal) option.selected = true;
        select.appendChild(option);
    });
    if (currentVal) select.value = currentVal;

    // 同步自定义输入框显示
    var customInput = document.getElementById('poolIndustryFilterInput');
    if (customInput) {
        if (currentVal) {
            var found = (industryListCache || []).find(function(o) { return o.value === currentVal; });
            customInput.value = found ? found.label : currentVal;
        } else {
            customInput.value = '';
            customInput.placeholder = '-- 行业(可选) --';
        }
    }
}

function updatePoolConceptCount() {
    var countEl = document.getElementById('poolConceptCount');
    if (!countEl) return;
    var selected = poolConceptFilter.length;
    if (selected > 0) {
        countEl.textContent = '已选 ' + selected + ' 个';
        countEl.style.color = '#4f7eff';
    } else {
        countEl.textContent = '';
    }
}

// ========== 参数优化面板 ==========

var _optJobId = null;
var _optPollTimer = null;
var _optChartInstance = null;
var _optParams = [];

function validateAndOpenOptPanel() {
    if (!window.__currentCards || window.__currentCards.length === 0) {
        if (typeof cards !== 'undefined' && cards.length === 0) {
            showToast('请先添加策略卡片', true);
            return;
        }
    }
    var activeCards = window.__currentCards || cards;
    _optParams = extractParamsFromCards(activeCards);
    if (_optParams.length === 0) {
        showToast('当前策略没有可优化的数值参数', true);
        return;
    }
    renderOptimizationPanel();
}

function renderOptimizationPanel() {
    if (window._optPanelCleanup) {
        window._optPanelCleanup();
        window._optPanelCleanup = null;
    }
    _optHistoryData = [];
    if (_optChartInstance) {
        _optChartInstance.dispose();
        _optChartInstance = null;
    }

    var container = document.getElementById('dynamicContent');
    if (!container) return;

    var defaultStock = (window.currentStockPool && window.currentStockPool.length > 0)
        ? window.currentStockPool[0] : '000001';

    var poolStockCount = (window.currentStockPool && window.currentStockPool.length) || 0;
    var canMulti = poolStockCount > 1;
    var poolDisplayName = '';
    if (canMulti) {
        var poolLabelMap = { all: '全部A股', hs300: '沪深300', zz500: '中证500', zz1000: '中证1000', cyb: '创业板', kc50: '科创50', custom: '自选股' };
        poolDisplayName = poolLabelMap[poolSource] || '当前股票池';
    }

    // Build parameter rows
    var paramsHtml = _optParams.map(function(p, i) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;padding:6px 8px;background:#151c2c;border-radius:6px;">' +
            '<span style="color:#fff;font-size:12px;min-width:100px;">' + escapeHtml(p.label) + '</span>' +
            '<span style="color:#6a7a9a;font-size:10px;min-width:30px;">' + p.type + '</span>' +
            '<span style="display:flex;align-items:center;gap:4px;">' +
            '<input type="number" id="optLow_' + i + '" value="' + p.low + '" step="' + (p.step || 1) + '" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:4px;color:#fff;padding:3px 6px;font-size:12px;text-align:center;">' +
            '<span style="color:#9aa9cc;">~</span>' +
            '<input type="number" id="optHigh_' + i + '" value="' + p.high + '" step="' + (p.step || 1) + '" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:4px;color:#fff;padding:3px 6px;font-size:12px;text-align:center;">' +
            '</span>' +
            '<label style="font-size:11px;color:#9aa9cc;display:flex;align-items:center;gap:4px;margin-left:8px;">' +
            '<input type="checkbox" id="optEnable_' + i + '" checked style="accent-color:#4f7eff;"> 搜索' +
            '</label>' +
            '</div>';
    }).join('');

    var singleBtnStyle = _optMode === 'single'
        ? 'background:#4f7eff;color:#fff;border:none;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;'
        : 'background:#1e253b;color:#9aa9cc;border:1px solid #323d5a;padding:4px 14px;border-radius:20px;font-size:12px;cursor:pointer;';
    var multiBtnStyle = _optMode === 'multi'
        ? 'background:#4f7eff;color:#fff;border:none;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;' + (!canMulti ? 'opacity:0.4;' : '')
        : 'background:#1e253b;color:#9aa9cc;border:1px solid #323d5a;padding:4px 14px;border-radius:20px;font-size:12px;cursor:pointer;' + (!canMulti ? 'opacity:0.4;' : '');

    var stockInputDisplay = _optMode === 'multi' ? 'display:none;' : '';
    var poolInfoDisplay = _optMode === 'multi' ? '' : 'display:none;';

    var baseTrials = (document.getElementById('optNTrials') && _optMode === 'multi')
        ? (parseInt(document.getElementById('optNTrials').value) || 100)
        : 100;
    var adjustedTrials = canMulti ? Math.max(30, Math.floor(baseTrials / Math.sqrt(poolStockCount))) : baseTrials;

    container.innerHTML = '<div class="card" id="optimizationCard">' +
        '<div class="card-title">🔍 参数优化 <span style="font-size:12px;color:#9aa9cc;">— Optuna TPE 智能搜索</span></div>' +
        '<div class="opt-panel-layout">' +
        // Left: settings
        '<div class="opt-settings">' +
        // Mode toggle
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
        '<span style="color:#9aa9cc;font-size:12px;">📈 模式</span>' +
        '<button id="optModeSingle" style="' + singleBtnStyle + '">单股</button>' +
        '<button id="optModeMulti" style="' + multiBtnStyle + '"' + (!canMulti ? ' disabled title="股票池不足（需≥2只）"' : '') + '>多股</button>' +
        '</div>' +
        // Single stock input
        '<div id="optSingleStockRow" style="margin-bottom:10px;' + stockInputDisplay + '">' +
        '<span style="color:#9aa9cc;font-size:12px;">📈 股票</span><br>' +
        '<input type="text" id="optStockCode" value="' + defaultStock + '" style="width:100px;background:#1e253b;border:1px solid #323d5a;border-radius:4px;color:#fff;padding:4px 8px;font-size:12px;">' +
        '</div>' +
        // Multi stock info
        '<div id="optMultiStockInfo" style="margin-bottom:10px;' + poolInfoDisplay + '">' +
        '<div style="background:#0e1220;border:1px solid #2a3145;border-radius:8px;padding:10px;">' +
        '<span style="color:#4f7eff;font-weight:600;font-size:12px;">📊 ' + escapeHtml(poolDisplayName) + ' (' + poolStockCount + '只)</span><br>' +
        '<span style="color:#f2c94c;font-size:11px;" id="optTrialsHint">⚠ trial数已调整为 ' + adjustedTrials + ' (基础' + baseTrials + ')</span>' +
        '</div>' +
        '</div>' +
        '<div style="display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap;">' +
        '<div><span style="color:#9aa9cc;font-size:12px;">🎯 目标</span><br><select id="optObjective" style="background:#1e253b;border:1px solid #323d5a;color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;"><option value="sharpe_drawdown">稳健（回撤≤15%）</option><option value="sharpe">夏普优先</option><option value="return">纯收益率</option></select></div>' +
        '<div><span style="color:#9aa9cc;font-size:12px;">🔢 试验次数</span><br><input type="number" id="optNTrials" value="' + baseTrials + '" min="20" max="500" style="width:70px;background:#1e253b;border:1px solid #323d5a;border-radius:4px;color:#fff;padding:4px 8px;font-size:12px;"></div>' +
        '</div>' +
        '<div style="background:#0e1220;border:1px solid #2a3145;border-radius:8px;padding:10px;margin-bottom:10px;">' +
        '<div style="color:#4f7eff;font-weight:600;margin-bottom:8px;font-size:13px;">🔧 搜索参数（可修改范围、取消勾选）</div>' +
        paramsHtml +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
        '<button id="startOptBtn" style="background:#4f7eff;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;">🚀 开始优化搜索</button>' +
        '<button id="stopOptBtn" style="background:#e74c3c;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;display:none;">⏹ 停止</button>' +
        '</div>' +
        '</div>' +
        // Right: results
        '<div class="opt-results">' +
        '<div class="opt-status-row" style="display:flex;gap:8px;margin-bottom:10px;">' +
        '<div class="opt-status-card"><div class="opt-stat-label">状态</div><div class="opt-stat-value" id="optStatus" style="color:#9aa9cc;">等待开始</div></div>' +
        '<div class="opt-status-card"><div class="opt-stat-label">已完成</div><div class="opt-stat-value" id="optProgress" style="color:#fff;">0 / ' + baseTrials + '</div></div>' +
        '<div class="opt-status-card"><div class="opt-stat-label">当前最优</div><div class="opt-stat-value" id="optBestValue" style="color:#27ae60;">--</div></div>' +
        '</div>' +
        '<div id="optHistoryChart" style="height:180px;background:#0e1220;border-radius:8px;margin-bottom:8px;"></div>' +
        '<div id="optImportanceChart" style="height:120px;background:#0e1220;border-radius:8px;margin-bottom:8px;"></div>' +
        '<div id="optBestParamsTable" style="background:#0e1220;border-radius:8px;padding:10px;font-size:12px;"></div>' +
        '</div>' +
        '</div></div>';

    bindOptimizationEvents();
    window._optPanelActive = true;
}

function bindOptimizationEvents() {
    var startBtn = document.getElementById('startOptBtn');
    var stopBtn = document.getElementById('stopOptBtn');
    if (startBtn) startBtn.addEventListener('click', startOptimization);
    if (stopBtn) stopBtn.addEventListener('click', stopOptimization);

    var singleBtn = document.getElementById('optModeSingle');
    var multiBtn = document.getElementById('optModeMulti');
    if (singleBtn) singleBtn.addEventListener('click', function() {
        if (_optMode === 'single') return;
        _optMode = 'single';
        renderOptimizationPanel();
    });
    if (multiBtn) multiBtn.addEventListener('click', function() {
        if (_optMode === 'multi') return;
        var poolCount = (window.currentStockPool && window.currentStockPool.length) || 0;
        if (poolCount <= 1) return;
        _optMode = 'multi';
        renderOptimizationPanel();
    });

    var trialsEl = document.getElementById('optNTrials');
    if (trialsEl) trialsEl.addEventListener('input', function() {
        if (_optMode === 'multi') {
            var base = parseInt(this.value) || 100;
            var poolCount = (window.currentStockPool && window.currentStockPool.length) || 1;
            var adjusted = Math.max(30, Math.floor(base / Math.sqrt(poolCount)));
            var hint = document.getElementById('optTrialsHint');
            if (hint) hint.textContent = '⚠ trial数已调整为 ' + adjusted + ' (基础' + base + ')';
        }
    });
}

function stopOptimization() {
    if (_optJobId && bridge && typeof bridge.cancel_optimization === 'function') {
        bridge.cancel_optimization(_optJobId);
    }
    stopOptimizationPolling();
    var statusEl = document.getElementById('optStatus');
    if (statusEl) { statusEl.textContent = '已停止'; statusEl.style.color = '#f2c94c'; }
    var sb = document.getElementById('startOptBtn');
    var stb = document.getElementById('stopOptBtn');
    if (sb) sb.style.display = '';
    if (stb) stb.style.display = 'none';
}

function startOptimization() {
    if (!bridge || typeof bridge.start_optimization !== 'function') {
        showToast('Bridge 未连接或接口不可用', true);
        return;
    }

    // Collect enabled params
    var paramsToSearch = [];
    var fixedParams = {};
    _optParams.forEach(function(p, i) {
        var cb = document.getElementById('optEnable_' + i);
        if (cb && cb.checked) {
            var lowEl = document.getElementById('optLow_' + i);
            var highEl = document.getElementById('optHigh_' + i);
            paramsToSearch.push({
                name: p.name,
                type: p.type,
                low: lowEl ? (parseFloat(lowEl.value) || p.low) : p.low,
                high: highEl ? (parseFloat(highEl.value) || p.high) : p.high,
                step: p.step || undefined,
            });
        } else {
            fixedParams[p.name] = p.default;
        }
    });

    if (paramsToSearch.length === 0) {
        showToast('请至少勾选一个参数进行搜索', true);
        return;
    }

    var stockEl = document.getElementById('optStockCode');
    var objEl = document.getElementById('optObjective');
    var trialsEl = document.getElementById('optNTrials');

    var code = window.currentStrategyCode || (typeof generateCode === 'function' ? generateCode(window.__currentCards || cards) : '');
    var stock = stockEl ? stockEl.value.trim() : '000001';

    var params = {
        strategy_code: code,
        start: window.strategyStartDate || '2010-01-01',
        end: window.strategyEndDate || new Date().toISOString().slice(0, 10),
        cash: window.initialCapital || 1000000,
        objective: objEl ? objEl.value : 'sharpe_drawdown',
        n_trials: trialsEl ? (parseInt(trialsEl.value) || 100) : 100,
        params_to_search: paramsToSearch,
        fixed_params: fixedParams,
        slippage: window._slippageMode || 'close',
        commission_rate: window._commissionRate || 0.0003,
        stamp_tax_rate: window._stampTaxRate || 0.001,
        slippage_cost_type: window._slippageCostType || 'percent',
        slippage_cost_value: window._slippageCostValue || 0.1,
    };

    if (_optMode === 'multi' && window.currentStockPool && window.currentStockPool.length > 1) {
        var pool = window.currentStockPool.map(function(c) { return c.split('.')[0]; });
        params.stock_codes = pool;
        params.stock = pool[0];
    } else {
        params.stock = stock;
        if (code && stock) {
            code = code.replace(/"STOCK_CODE_PLACEHOLDER"/g, '"' + stock + '"');
        }
    }
    params.strategy_code = code;

    bridge.start_optimization(JSON.stringify(params)).then(function(jsonStr) {
        var res = JSON.parse(jsonStr);
        if (res.success) {
            _optJobId = res.job_id;
            var statusEl = document.getElementById('optStatus');
            if (statusEl) { statusEl.textContent = '⏳ 搜索中...'; statusEl.style.color = '#f2c94c'; }
            var sb = document.getElementById('startOptBtn');
            var stb = document.getElementById('stopOptBtn');
            if (sb) sb.style.display = 'none';
            if (stb) stb.style.display = '';
            startOptimizationPolling();
        } else {
            showToast('启动失败: ' + (res.error || '未知错误'), true);
        }
    }).catch(function(err) {
        showToast('启动失败: ' + err.message, true);
    });
}

function startOptimizationPolling() {
    window._optPanelCleanup = function() {
        stopOptimizationPolling();
        if (_optChartInstance) {
            _optChartInstance.dispose();
            _optChartInstance = null;
        }
        _optJobId = null;
    };
    if (_optPollTimer) clearInterval(_optPollTimer);
    _optPollTimer = setInterval(function() {
        if (!_optJobId || !bridge) return;
        bridge.get_optimization_progress(_optJobId).then(function(jsonStr) {
            var data = JSON.parse(jsonStr);
            if (data.status === 'finished' || data.status === 'cancelled') {
                stopOptimizationPolling();
                loadOptimizationResult();
                return;
            }
            if (data.status === 'not_found') {
                stopOptimizationPolling();
                return;
            }
            updateOptimizationProgress(data);
        }).catch(function() {});
    }, 800);
}

function stopOptimizationPolling() {
    if (_optPollTimer) {
        clearInterval(_optPollTimer);
        _optPollTimer = null;
    }
}

var _optHistoryData = [];

function updateOptimizationProgress(data) {
    var prog = data.progress;
    if (!prog) return;

    var progressEl = document.getElementById('optProgress');
    if (progressEl) progressEl.textContent = prog.current + ' / ' + prog.total;

    if (prog.best_value != null) {
        var bestEl = document.getElementById('optBestValue');
        if (bestEl) bestEl.textContent = (prog.best_value >= 0 ? '+' : '') + prog.best_value.toFixed(2);
    }

    if (prog.last_trial) {
        _optHistoryData.push({
            number: prog.last_trial.number,
            value: prog.last_trial.value,
            state: prog.last_trial.state,
        });
        drawOptHistoryChart();
    }
}

function drawOptHistoryChart() {
    var dom = document.getElementById('optHistoryChart');
    if (!dom || typeof echarts === 'undefined') return;
    if (!_optChartInstance) _optChartInstance = echarts.init(dom);

    var completedData = [];
    var prunedData = [];
    var bestLine = [];
    var bestSoFar = -Infinity;

    _optHistoryData.forEach(function(d) {
        if (d.state !== 'FAIL') {
            completedData.push([d.number, d.value]);
            if (d.value != null && d.value > bestSoFar) bestSoFar = d.value;
        }
        if (d.state === 'PRUNED') prunedData.push([d.number, d.value]);
        bestLine.push(bestSoFar > -Infinity ? bestSoFar : null);
    });

    _optChartInstance.setOption({
        grid: { top: 12, right: 16, bottom: 24, left: 50 },
        tooltip: { trigger: 'axis', appendToBody: true },
        xAxis: { type: 'value', name: '试验序号', nameTextStyle: { color: '#9aa9cc' }, axisLabel: { color: '#9aa9cc' } },
        yAxis: { type: 'value', axisLabel: { color: '#9aa9cc' }, splitLine: { lineStyle: { color: '#242a40' } } },
        series: [
            { name: '最优值', type: 'line', data: bestLine, lineStyle: { color: '#4f7eff', width: 2 }, showSymbol: false, smooth: true },
            { name: '已完成', type: 'scatter', data: completedData, symbolSize: 6, itemStyle: { color: '#27ae60' } },
            { name: '已剪枝', type: 'scatter', data: prunedData, symbolSize: 4, itemStyle: { color: '#6a7a9a' } },
        ],
        legend: { data: ['最优值', '已完成', '已剪枝'], textStyle: { color: '#ffffff' }, top: 0 },
    }, true);
}

function loadOptimizationResult() {
    if (!_optJobId || !bridge) return;
    bridge.get_optimization_result(_optJobId).then(function(jsonStr) {
        var data = JSON.parse(jsonStr);
        if (!data.ready) return;

        var statusEl = document.getElementById('optStatus');
        if (statusEl) { statusEl.textContent = '✅ 完成'; statusEl.style.color = '#27ae60'; }

        var sb = document.getElementById('startOptBtn');
        var stb = document.getElementById('stopOptBtn');
        if (sb) sb.style.display = '';
        if (stb) stb.style.display = 'none';

        var result = data.result;
        if (!result.success) {
            showToast('优化失败: ' + (result.error || '未知错误'), true);
            return;
        }

        drawOptImportanceChart(result.param_importance);
        renderBestParamsTable(result);
        _optJobId = null;
    }).catch(function() {});
}

function renderBestParamsTable(result) {
    var tableDiv = document.getElementById('optBestParamsTable');
    if (!tableDiv) return;

    var bestParams = result.best_params || {};
    var html = '<div style="color:#4f7eff;font-weight:600;margin-bottom:6px;font-size:13px;">📋 最优参数</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
        '<tr style="color:#9aa9cc;"><th style="text-align:left;padding:4px 8px;">参数</th><th style="text-align:left;padding:4px 8px;">最优值</th><th style="text-align:left;padding:4px 8px;">原值</th></tr>';

    _optParams.forEach(function(p) {
        var bestVal = bestParams[p.name];
        html += '<tr>' +
            '<td style="padding:4px 8px;color:#fff;">' + escapeHtml(p.label) + '</td>' +
            '<td style="padding:4px 8px;color:#27ae60;font-weight:600;">' + (bestVal != null ? bestVal : '--') + '</td>' +
            '<td style="padding:4px 8px;color:#9aa9cc;">' + p.default + '</td>' +
            '</tr>';
    });
    html += '</table>';
    html += '<button id="applyOptParamsBtn" style="margin-top:8px;background:#27ae60;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;font-size:13px;">✅ 应用最优参数</button>';
    html += '<span id="applyOptStatus" style="margin-left:10px;color:#27ae60;font-size:11px;"></span>';

    tableDiv.innerHTML = html;

    var applyBtn = document.getElementById('applyOptParamsBtn');
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            var best = result.best_params || {};
            var changed = 0;
            var activeCards = window.__currentCards || (typeof cards !== 'undefined' ? cards : []);
            activeCards.forEach(function(card) {
                if (!card.params) return;
                Object.keys(best).forEach(function(key) {
                    if (card.params.hasOwnProperty(key)) {
                        card.params[key] = best[key];
                        changed++;
                    }
                });
            });
            var statusSpan = document.getElementById('applyOptStatus');
            if (statusSpan) statusSpan.textContent = '已应用 ' + changed + ' 个参数';
            // Refresh the strategy page to show updated values
            if (typeof renderStrategyPage === 'function') {
                renderStrategyPage(document.getElementById('dynamicContent'));
            }
        });
    }
}

function drawOptImportanceChart(importance) {
    var dom = document.getElementById('optImportanceChart');
    if (!dom || typeof echarts === 'undefined') return;

    var chart = echarts.getInstanceByDom(dom) || echarts.init(dom);
    var keys = Object.keys(importance || {});
    var values = keys.map(function(k) { return importance[k]; });

    if (keys.length === 0) {
        dom.innerHTML = '<div style="color:#9aa9cc;text-align:center;padding-top:40px;">参数重要性分析需要 ≥10 次试验</div>';
        return;
    }

    chart.setOption({
        grid: { top: 8, right: 16, bottom: 24, left: 40 },
        tooltip: { trigger: 'axis', appendToBody: true },
        xAxis: { type: 'category', data: keys, axisLabel: { color: '#9aa9cc', fontSize: 11 } },
        yAxis: { type: 'value', name: '重要性', nameTextStyle: { color: '#9aa9cc' } },
        series: [{
            type: 'bar', data: values,
            itemStyle: { color: '#4f7eff', borderRadius: [4, 4, 0, 0] },
            label: { show: true, position: 'top', color: '#fff', fontSize: 11, formatter: function(p) { return (p.value || 0).toFixed(2); } },
        }],
    }, true);
}
