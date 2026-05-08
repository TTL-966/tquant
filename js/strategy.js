// js/strategy.js
import { bridge } from './bridge.js';
import { bindDatePicker } from './datepicker.js';
import { escapeHtml } from './main.js';

let logContainer = null;
let backtestStartTime = null;

function nowTimestamp() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' +
           ('0' + d.getMinutes()).slice(-2) + ':' +
           ('0' + d.getSeconds()).slice(-2);
}

function addLog(level, text) {
    if (!logContainer) return;
    var color = '#4f7eff';
    var prefix = '[INFO]';
    if (level === 'warn') {
        color = '#f2c94c';
        prefix = '[WARN]';
    } else if (level === 'error') {
        color = '#ff4c4c';
        prefix = '[ERROR]';
    } else if (level === 'success') {
        color = '#4cff4c';
        prefix = '[SUCCESS]';
    } else if (level === 'info') {
        color = '#4f7eff';
        prefix = '[INFO]';
    }
    var line = document.createElement('div');
    line.style.cssText = 'color:' + color + '; margin-bottom:2px;';
    line.textContent = '[' + nowTimestamp() + '] ' + prefix + ' ' + text;
    logContainer.appendChild(line);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function clearLog() {
    if (logContainer) logContainer.innerHTML = '';
}

function showStrategyListModal() {
    // 遮罩
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';
    overlay.onclick = function() { overlay.remove(); popup.remove(); };

    var popup = document.createElement('div');
    popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:20px;min-width:320px;max-width:500px;max-height:400px;overflow-y:auto;z-index:10000;';

    var title = document.createElement('div');
    title.style.cssText = 'color:#fff;font-weight:600;margin-bottom:12px;';
    title.textContent = '我的策略';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function() { overlay.remove(); popup.remove(); };
    popup.appendChild(closeBtn);

    popup.appendChild(title);

    var listDiv = document.createElement('div');
    listDiv.innerHTML = '<div style="color:#9aa9cc;padding:8px;">加载中...</div>';
    popup.appendChild(listDiv);
    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    // 加载列表
    bridge.list_strategies().then(function(jsonStr) {
        var arr = JSON.parse(jsonStr);
        if (!Array.isArray(arr) || arr.length === 0) {
            listDiv.innerHTML = '<div style="color:#9aa9cc;padding:8px;">暂无保存的策略</div>';
            return;
        }
        var html = '';
        arr.forEach(function(item) {
            html += '<div class="strategy-list-item" data-id="' + item.id + '" style="padding:8px 12px;margin:4px 0;background:#0e1220;border-radius:6px;cursor:pointer;color:#fff;">' +
                    '<strong>' + escapeHtml(item.name) + '</strong> <span style="color:#9aa9cc;font-size:12px;">ID: ' + item.id + '</span></div>';
        });
        listDiv.innerHTML = html;
        // 绑定点击事件
        listDiv.querySelectorAll('.strategy-list-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var id = this.getAttribute('data-id');
                loadStrategyById(id);
                overlay.remove();
                popup.remove();
            });
        });
    }).catch(function(err) {
        listDiv.innerHTML = '<div style="color:#ff4c4c;">加载失败: ' + err.message + '</div>';
    });
}

function loadStrategyById(id) {
    if (!bridge) return;
    bridge.load_strategy(id).then(function(jsonStr) {
        var obj = JSON.parse(jsonStr);
        if (obj.error) {
            addLog('error', '加载策略失败: ' + obj.error);
            return;
        }
        var nameInput = document.getElementById('strategyNameInput');
        var textarea = document.getElementById('strategyTextArea');
        if (nameInput) nameInput.value = obj.name;
        if (textarea) textarea.value = obj.code;
        window.currentStrategyName = obj.name;
        window.currentStrategyCode = obj.code;
        // 更新策略ID（用于保存）
        var saveBtn = document.getElementById('saveStrategyBtn');
        if (saveBtn) saveBtn.dataset.currentId = obj.id;
        addLog('info', '已加载策略: ' + obj.name);
    }).catch(function(err) {
        addLog('error', '加载策略请求失败: ' + err.message);
    });
}

export function renderStrategyPage(container) {
    // 清空容器
    container.innerHTML = '';

    var html = `
        <div class="card">
            <div class="card-title">✍️ 策略编辑器</div>
            <!-- 顶部：我的策略按钮 -->
            <div style="margin-bottom:8px;">
                <button id="loadStrategyListBtn" style="background:#2a3a5a;">📂 我的策略</button>
            </div>

            <!-- 策略名称 -->
            <div class="metric-row" style="margin-top:4px;">
                <span>策略名称：</span>
                <input type="text" id="strategyNameInput" placeholder="请输入策略名称"
                       style="width:200px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px;">
            </div>

            <!-- 代码编辑器（Tab 转4空格） -->
            <textarea id="strategyTextArea" rows="10" style="width:100%; margin-top:8px; background:#0e1220; border:1px solid #323d5a; border-radius:16px; color:#fff; padding:12px; box-sizing:border-box; font-family:monospace;">def initialize(context):
    context.stock = "000001.SZ"
    context.short_win = 5
    context.long_win = 20

def handle_bar(context, bar_dict):
    short_ma = history_bars(context.stock, context.short_win, '1d', 'close').mean()
    long_ma = history_bars(context.stock, context.long_win, '1d', 'close').mean()
    if short_ma > long_ma:
        order_target_percent(context.stock, 1.0)
        log.info("买入信号")
    elif short_ma < long_ma:
        order_target_percent(context.stock, 0)
        log.info("卖出信号")</textarea>

            <!-- 按钮组 -->
            <div style="margin:8px 0;">
                <button id="newStrategyBtn">📄 新建</button>
                <button id="saveStrategyBtn">💾 保存</button>
                <button id="deleteStrategyBtn">🗑 删除</button>
            </div>
        </div>

        <!-- 股票池 & 日期 & 运行回测 -->
        <div class="card" style="margin-top:12px;">
            <div class="card-title">🎯 回测参数</div>
            <div class="metric-row">
                <span>股票池：</span>
                <textarea id="stockPoolInput" rows="3" placeholder="输入股票代码，每行一个或用逗号分隔&#10;例如：&#10;000001&#10;000858&#10;600519,000333" style="width:100%; background:#0e1220; border:1px solid #323d5a; border-radius:12px; color:#fff; padding:8px; font-family:monospace;">000001</textarea>
            </div>
            <div class="metric-row" style="margin-top:8px;">
                <span>起始日期：</span>
                <input type="text" class="datepicker-input" id="strategyStartDate" value="2010-01-01" readonly
                       style="width:120px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px;">
                <span>结束日期：</span>
                <input type="text" class="datepicker-input" id="strategyEndDate" value="" readonly
                       style="width:120px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px;">
                <button id="runMultiBacktestBtn" style="margin-left:12px;">▶ 运行回测</button>
            </div>

            <!-- 日志区域（含折叠/展开按钮） -->
            <div style="margin-top:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <h4 style="color:#ffffff;margin:0;">📋 回测日志</h4>
                    <div>
                        <button id="toggleLogBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;margin-right:8px;">🔼 折叠</button>
                        <button id="clearLogBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;">清除</button>
                    </div>
                </div>
                <div id="strategyLogArea" style="height:200px;overflow-y:auto;background:#0e1220;border:1px solid #323d5a;border-radius:12px;padding:8px;margin-top:4px;color:#ffffff;"></div>
            </div>
        </div>
    `;
    container.innerHTML = html;

    // 获取DOM元素
    var nameInput = document.getElementById('strategyNameInput');
    var textarea = document.getElementById('strategyTextArea');
    var newBtn = document.getElementById('newStrategyBtn');
    var saveBtn = document.getElementById('saveStrategyBtn');
    var deleteBtn = document.getElementById('deleteStrategyBtn');
    var loadListBtn = document.getElementById('loadStrategyListBtn');
    var runBtn = document.getElementById('runMultiBacktestBtn');
    var startDateInput = document.getElementById('strategyStartDate');
    var endDateInput = document.getElementById('strategyEndDate');
    var stockPoolInput = document.getElementById('stockPoolInput');
    var clearLogBtn = document.getElementById('clearLogBtn');
    var toggleLogBtn = document.getElementById('toggleLogBtn');

    logContainer = document.getElementById('strategyLogArea');

    // 绑定日期选择器
    if (startDateInput) bindDatePicker(startDateInput);
    if (endDateInput) {
        var today = new Date().toISOString().slice(0,10);
        endDateInput.value = today;
        bindDatePicker(endDateInput);
    }

    // Tab 键替换为4个空格
    textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            var start = this.selectionStart;
            var end = this.selectionEnd;
            this.value = this.value.substring(0, start) + '    ' + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start + 4;
        }
    });

    // ---------- 新建 ----------
    var currentId = null;
    newBtn.addEventListener('click', function() {
        currentId = null;
        nameInput.value = '';
        textarea.value = '';
        window.currentStrategyName = undefined;
        window.currentStrategyCode = undefined;
    });

    // ---------- 保存 ----------
    saveBtn.addEventListener('click', function() {
        var name = nameInput.value.trim();
        var code = textarea.value;
        if (!name) {
            // placeholder 已提示
            nameInput.classList.add('error');
            setTimeout(function() { nameInput.classList.remove('error'); }, 2000);
            return;
        }
        if (!code) {
            if (!confirm('策略代码为空，是否继续保存？')) return;
        }
        bridge.save_strategy(name, code, currentId).then(function(jsonStr) {
            var result = JSON.parse(jsonStr);
            if (result.success) {
                currentId = result.id;
                window.currentStrategyName = name;
                window.currentStrategyCode = code;
                addLog('success', '保存成功 ID=' + result.id);
                // 短暂提示
                var tip = document.createElement('div');
                tip.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:#4cff4c;color:#000;padding:10px 20px;border-radius:8px;z-index:99999;';
                tip.textContent = '✅ 已保存';
                document.body.appendChild(tip);
                setTimeout(function() { tip.remove(); }, 1500);
            } else {
                addLog('error', '保存失败: ' + (result.message || ''));
            }
        }).catch(function(err) {
            addLog('error', '保存失败: ' + err.message);
        });
    });

    // ---------- 删除 ----------
    deleteBtn.addEventListener('click', function() {
        if (!currentId) {
            alert('请先保存策略再删除');
            return;
        }
        if (!confirm('确认删除策略 ID=' + currentId + ' 吗？')) return;
        bridge.delete_strategy(currentId).then(function(jsonStr) {
            var result = JSON.parse(jsonStr);
            if (result.success) {
                addLog('success', '删除成功');
                currentId = null;
                nameInput.value = '';
                textarea.value = '';
                window.currentStrategyName = undefined;
                window.currentStrategyCode = undefined;
            } else {
                addLog('error', '删除失败: ' + (result.message || ''));
            }
        }).catch(function(err) {
            addLog('error', '删除失败: ' + err.message);
        });
    });

    // ---------- 加载策略列表 ----------
    if (loadListBtn) {
        loadListBtn.addEventListener('click', showStrategyListModal);
    }

    // ---------- 清除日志 ----------
    if (clearLogBtn) {
        clearLogBtn.addEventListener('click', clearLog);
    }

    // ---------- 折叠/展开日志 ----------
    var logExpanded = true;
    if (toggleLogBtn) {
        toggleLogBtn.addEventListener('click', function() {
            logExpanded = !logExpanded;
            logContainer.style.height = logExpanded ? '200px' : '0px';
            toggleLogBtn.textContent = logExpanded ? '🔼 折叠' : '🔽 展开';
        });
    }

    // ---------- 运行回测 ----------
    if (runBtn) {
        runBtn.addEventListener('click', function() {
            // 防止重复点击
            if (runBtn.disabled) return;
            runBtn.disabled = true;
            runBtn.textContent = '⏳ 运行中...';
            backtestStartTime = Date.now();

            // 读取股票池
            var raw = stockPoolInput.value || '';
            var codes = [];
            raw.split(/[\n,]+/).forEach(function(part) {
                var code = part.trim();
                if (code) codes.push(code);
            });
            if (codes.length === 0) {
                addLog('error', '请输入至少一个股票代码');
                runBtn.disabled = false;
                runBtn.textContent = '▶ 运行回测';
                return;
            }
            // 去重
            codes = codes.filter(function(v,i,a){ return a.indexOf(v) === i; });

            var start = startDateInput.value;
            var end = endDateInput.value;
            var strategyName = window.currentStrategyName || '未命名策略';
            var userCode = window.currentStrategyCode;
            if (!userCode) {
                addLog('error', '请先在策略页面保存代码');
                runBtn.disabled = false;
                runBtn.textContent = '▶ 运行回测';
                return;
            }

            // 检查 handle_bar 是否存在
            if (!/def\s+handle_bar\s*\(/.test(userCode)) {
                addLog('warn', '策略缺少 handle_bar 函数，不会产生交易信号');
                runBtn.disabled = false;
                runBtn.textContent = '▶ 运行回测';
                return;
            }

            addLog('info', '即将对 '+codes.length+' 只股票进行回测，策略：' + strategyName);
            addLog('info', '股票池：' + codes.join(', '));

            var promises = codes.map(function(stock) {
                var params = {
                    code: userCode,
                    stock: stock,
                    start: start,
                    end: end,
                    cash: 1000000
                };
                return bridge.run_custom_backtest(JSON.stringify(params)).then(function(jsonStr) {
                    var res = JSON.parse(jsonStr);
                    if (!res.success) {
                        addLog('warn', '股票 '+stock+' 回测失败: ' + (res.error || '未知'));
                        return null;
                    }
                    addLog('info', '股票 '+stock+' 完成，信号 '+(res.signals?res.signals.length:0)+' 个');
                    return res;
                }).catch(function(err) {
                    addLog('error', '股票 '+stock+' 请求失败: ' + err.message);
                    return null;
                });
            });

            // 使用Promise.all等待所有完成
            Promise.all(promises).then(function(results) {
                var elapsed = ((Date.now() - backtestStartTime) / 1000).toFixed(1);
                addLog('info', '⏱ 回测耗时：' + elapsed + ' 秒');

                var mergedSignals = [];
                var equityMap = {};  // {date: value}

                results.forEach(function(r) {
                    if (!r) return;
                    if (r.signals) {
                        r.signals.forEach(function(s) {
                            mergedSignals.push({
                                date: s.date,
                                code: s.code || '',
                                type: s.type,
                                price: s.price,
                                shares: s.shares
                            });
                        });
                    }
                    // 合并权益曲线（等权相加）
                    if (r.equity_curve) {
                        r.equity_curve.forEach(function(ec) {
                            if (equityMap[ec.date] === undefined) {
                                equityMap[ec.date] = 0;
                            }
                            equityMap[ec.date] += ec.value;
                        });
                    }
                });

                // 构建合并权益曲线，按日期排序
                var mergedEquityCurve = Object.keys(equityMap).sort().map(function(date) {
                    return { date: date, value: equityMap[date] };
                });

                // 合并后的结果
                var mergedResult = {
                    success: true,
                    signals: mergedSignals,
                    equity_curve: mergedEquityCurve,
                    metrics: {}  // 暂时不填充指标
                };

                // 尝试从第一个成功的result获取metrics
                for (var i=0; i<results.length; i++) {
                    if (results[i] && results[i].metrics) {
                        mergedResult.metrics = results[i].metrics;
                        break;
                    }
                }

                window._lastBacktestResult = mergedResult;
                // 存储全局信号供K线页加载
                window.strategySignals = mergedSignals;

                addLog('success', '✅ 全部回测完成，总信号数 '+mergedSignals.length);
                addLog('info', '💡 请前往【策略详情】查看详细结果。');

                // 恢复按钮
                runBtn.disabled = false;
                runBtn.textContent = '▶ 运行回测';
            }).catch(function(err) {
                addLog('error', '回测整体失败: ' + err.message);
                runBtn.disabled = false;
                runBtn.textContent = '▶ 运行回测';
            });
        });
    }
}
