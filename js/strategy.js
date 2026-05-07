// js/strategy.js
import { bridge } from './bridge.js';
import { formatStockNameOnly, populateStockDatalist, profitClass, escapeHtml } from './main.js';
import { tradeStockLibrary } from './stockData.js';
import { buyPoints, sellPoints } from './kline.js';

export function renderStrategyPage(container) {
    // 清空容器
    container.innerHTML = '';
    var today = new Date().toISOString().slice(0, 10);

    // 构建 HTML 结构
    var html = `
        <div class="card">
            <div class="card-title">✍️ 策略编辑器</div>

            <!-- 股票代码输入 -->
            <div class="metric-row">
                <span>股票代码：</span>
                <input type="text" id="strategyStockInput" list="strategyStockList"
                       value="${window.currentStockCode || '000001'}"
                       style="width:130px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px;">
                <datalist id="strategyStockList"></datalist>
            </div>

            <!-- 选择策略 -->
            <div class="metric-row" style="margin-top:8px;">
                <span>选择策略：</span>
                <input type="text" id="strategySelectorInput" list="strategyListDatalist"
                       placeholder="选择策略"
                       style="width:200px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px;">
                <datalist id="strategyListDatalist"></datalist>
            </div>

            <!-- 策略名称 -->
            <div class="metric-row" style="margin-top:8px;">
                <span>策略名称：</span>
                <input type="text" id="strategyNameInput" value="新策略"
                       style="width:200px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px;">
            </div>

            <!-- 日期选择 -->
            <div class="metric-row" style="margin-top:8px;">
                <span>起始日期：</span>
                <input type="date" id="startDateInput" value="2010-01-01"
                       style="width:145px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px;">
                <span>结束日期：</span>
                <input type="date" id="endDateInput" value="${today}"
                       style="width:145px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px;">
            </div>

            <!-- 代码编辑器 -->
            <textarea id="strategyTextArea" rows="12" style="width:100%; margin-top:12px; background:#0e1220; border:1px solid #323d5a; border-radius:16px; color:#fff; padding:12px; box-sizing:border-box; font-family:monospace;">def initialize(context):
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
            <div style="margin:12px 0;">
                <button id="newStrategyBtn">📄 新建</button>
                <button id="saveStrategyBtn">💾 保存</button>
                <button id="deleteStrategyBtn">🗑 删除</button>
                <button id="runStrategyBtn">▶ 运行回测</button>
            </div>

            <!-- 日志区 -->
            <div id="strategyLogArea" class="log-box">
                [系统] 就绪，点击运行回测或从左侧历史回测加载策略代码。<br>
            </div>
        </div>
    `;
    container.innerHTML = html;

    // ---------- 获取 DOM 元素 ----------
    var stockInput = document.getElementById('strategyStockInput');
    var stockDatalist = document.getElementById('strategyStockList');
    var selectorInput = document.getElementById('strategySelectorInput');
    var selectorDatalist = document.getElementById('strategyListDatalist');
    var nameInput = document.getElementById('strategyNameInput');
    var textarea = document.getElementById('strategyTextArea');
    var startDateInput = document.getElementById('startDateInput');
    var endDateInput = document.getElementById('endDateInput');
    var newBtn = document.getElementById('newStrategyBtn');
    var saveBtn = document.getElementById('saveStrategyBtn');
    var deleteBtn = document.getElementById('deleteStrategyBtn');
    var runBtn = document.getElementById('runStrategyBtn');
    var logDiv = document.getElementById('strategyLogArea');

    // ---------- 变量 ----------
    var currentId = null;          // 当前加载的策略 ID
    var previousSelectorValue = ''; // 策略选择器上次的值（用于 blur 恢复）

    // ---------- 填充股票 datalist（前6只，提取 code 字符串） ----------
    var top6Codes = tradeStockLibrary.slice(0, 6).map(function(item) { return item.code; });
    populateStockDatalist('strategyStockList', top6Codes);

    // ---------- 刷新策略列表 ----------
    function refreshStrategyList() {
        bridge.list_strategies().then(function(jsonStr) {
            var strategies = JSON.parse(jsonStr);
            selectorDatalist.innerHTML = '';
            strategies.forEach(function(s) {
                var opt = document.createElement('option');
                opt.value = s.id;
                opt.label = s.name + ' (' + s.id + ')';
                selectorDatalist.appendChild(opt);
            });
        }).catch(function(err) {
            console.error('获取策略列表失败', err);
        });
    }

    // ---------- 加载策略到编辑器 ----------
    function loadStrategyIntoEditor(id) {
        bridge.load_strategy(id).then(function(jsonStr) {
            var obj = JSON.parse(jsonStr);
            if (obj && obj.id) {
                currentId = obj.id;
                nameInput.value = obj.name;
                textarea.value = obj.code;
                selectorInput.value = obj.name + ' (' + obj.id + ')';
                previousSelectorValue = selectorInput.value;
            }
        }).catch(function(err) {
            console.error('加载策略失败', err);
            logDiv.innerHTML += '<div>❌ 加载策略失败: ' + err.message + '</div>';
        });
    }

    // ---------- 事件绑定 ----------

    // 策略选择器 focus / blur
    selectorInput.addEventListener('focus', function() {
        previousSelectorValue = this.value;
        this.value = '';
    });
    selectorInput.addEventListener('blur', function() {
        if (this.value === '') {
            this.value = previousSelectorValue;
        } else {
            // 用户手动输入，尝试匹配
        }
    });

    // 策略选择器 change（选择 datalist 中的选项后触发）
    selectorInput.addEventListener('change', function() {
        var val = this.value;
        var options = selectorDatalist.options;
        var foundId = null;
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            if (opt.label === val || opt.value == val) {
                foundId = parseInt(opt.value);
                break;
            }
        }
        if (foundId) {
            loadStrategyIntoEditor(foundId);
        } else {
            // 未匹配到已知策略，清空编辑器
            currentId = null;
            nameInput.value = '新策略';
            textarea.value = '';
            previousSelectorValue = '';
        }
    });

    // 新建
    newBtn.addEventListener('click', function() {
        currentId = null;
        nameInput.value = '新策略';
        textarea.value = '';
        selectorInput.value = '';
        previousSelectorValue = '';
        logDiv.innerHTML += '<div>📄 已清空编辑器</div>';
    });

    // 保存
    saveBtn.addEventListener('click', function() {
        var name = nameInput.value.trim();
        var code = textarea.value;
        if (!name) {
            alert('请输入策略名称');
            return;
        }
        if (!code) {
            if (!confirm('策略代码为空，是否继续保存？')) return;
        }
        bridge.save_strategy(name, code, currentId).then(function(jsonStr) {
            var result = JSON.parse(jsonStr);
            if (result.success) {
                currentId = result.id;
                logDiv.innerHTML += '<div>✅ 保存成功 ID=' + result.id + '</div>';
                refreshStrategyList();
                // 更新选择器显示
                selectorInput.value = name + ' (' + result.id + ')';
                previousSelectorValue = selectorInput.value;
            } else {
                logDiv.innerHTML += '<div>❌ 保存失败: ' + (result.message || '') + '</div>';
            }
        }).catch(function(err) {
            console.error('保存策略失败', err);
            logDiv.innerHTML += '<div>❌ 保存失败: ' + err.message + '</div>';
        });
    });

    // 删除
    deleteBtn.addEventListener('click', function() {
        if (!currentId) {
            alert('请先选择要删除的策略');
            return;
        }
        if (!confirm('确认删除策略 ID=' + currentId + ' 吗？')) return;
        bridge.delete_strategy(currentId).then(function(jsonStr) {
            var result = JSON.parse(jsonStr);
            if (result.success) {
                logDiv.innerHTML += '<div>🗑 删除策略 ID=' + currentId + ' 成功</div>';
                currentId = null;
                nameInput.value = '新策略';
                textarea.value = '';
                selectorInput.value = '';
                previousSelectorValue = '';
                refreshStrategyList();
            } else {
                logDiv.innerHTML += '<div>❌ 删除失败: ' + (result.message || '') + '</div>';
            }
        }).catch(function(err) {
            console.error('删除失败', err);
        });
    });

    // 运行回测
    runBtn.addEventListener('click', function() {
        var stockCode = stockInput.value.trim();
        if (!stockCode) {
            alert('请输入股票代码');
            return;
        }
        var userCode = textarea.value;
        if (!userCode) {
            alert('请填写策略代码');
            return;
        }
        var startDate = startDateInput.value || '2010-01-01';
        var endDate   = endDateInput.value || today;
        var cash = 1000000;

        var paramsJson = JSON.stringify({
            code: userCode,
            stock: stockCode,
            start: startDate,
            end: endDate,
            cash: cash
        });

        logDiv.innerHTML += '<div>🚀 正在执行回测，请稍候...</div>';

        bridge.run_custom_backtest(paramsJson).then(function(resultJson) {
            var res = JSON.parse(resultJson);
            if (!res.success) {
                logDiv.innerHTML += '<div>❌ 回测失败: ' + (res.error || '未知错误') + '</div>';
                return;
            }
            // 成功
            window._lastBacktestResult = res;
            window.currentStockCode = stockCode;

            // 更新买卖点全局数组（导入的引用）
            buyPoints.length = 0;
            sellPoints.length = 0;
            (res.signals || []).forEach(function(s) {
                if (s.type === 'buy') {
                    buyPoints.push({
                        date: s.date,
                        code: s.code || stockCode,
                        price: s.price,
                        shares: s.shares
                    });
                } else {
                    sellPoints.push({
                        date: s.date,
                        code: s.code || stockCode,
                        price: s.price,
                        shares: s.shares
                    });
                }
            });

            logDiv.innerHTML += '<div>📊 回测完成，共产生买入 ' + buyPoints.length + ' 个，卖出 ' + sellPoints.length + ' 个信号</div>';
            logDiv.innerHTML += '<div>💡 请前往【策略详情】查看详细结果，或【买卖点成交图】查看K线标识。</div>';
        }).catch(function(err) {
            console.error('回测请求失败', err);
            logDiv.innerHTML += '<div>❌ 回测请求失败: ' + err.message + '</div>';
        });
    });

    // ---------- 初始化 ----------
    refreshStrategyList();
}
