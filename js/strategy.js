// js/strategy.js
import { bridge } from './bridge.js';
import { bindDatePicker } from './datepicker.js';
import { buyPoints, sellPoints } from './kline.js';

export function renderStrategyPage(container) {
    var today = new Date().toISOString().slice(0, 10);
    container.innerHTML = `
        <div class="card">
            <div class="card-title">✍️ 策略编辑器</div>
            <div class="metric-row">
                <span>策略名称:</span>
                <input type="text" id="strategyNameInput" value="新策略"
                       style="width:200px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 12px;">
                <span>选择策略:</span>
                <input type="text" id="strategySelectorInput" list="strategyList"
                       placeholder="选择策略"
                       style="width:160px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px; box-sizing:border-box;">
                <datalist id="strategyList"></datalist>
            </div>
            <div class="metric-row" style="margin-top:8px;">
                <span>股票代码:</span>
                <input type="text" id="strategyStockInput" list="stockList"
                       value="000001"
                       style="width:130px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px; box-sizing:border-box;">
                <datalist id="stockList">
                    <option value="000001" label="平安银行">
                    <option value="000858" label="五粮液">
                    <option value="300750" label="宁德时代">
                    <option value="600519" label="贵州茅台">
                </datalist>
                <span>起始:</span>
                <input type="text" class="datepicker-input" id="strategyStartDate" value="2010-01-01" style="width:145px;">
                <span>结束:</span>
                <input type="text" class="datepicker-input" id="strategyEndDate" value="${today}" style="width:145px;">
            </div>
            <div style="margin:12px 0;">
                <button id="newStrategyBtn">📄 新建</button>
                <button id="saveStrategyBtn">💾 保存</button>
                <button id="deleteStrategyBtn">🗑 删除</button>
                <button id="runStrategyBtn">▶ 运行回测</button>
            </div>
            <textarea id="strategyTextArea" rows="12">def initialize(context):
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
            <div class="log-box" id="runLogConsole">
                [系统] 就绪，点击运行回测或从左侧历史回测加载策略代码。<br>
            </div>
            <div id="strategyEquityChart" style="height:240px; width:100%; margin-top:12px; background:#0e1220; border-radius:16px;"></div>
        </div>
    `;

    var strategyListDL = document.getElementById('strategyList');
    var selectorInput = document.getElementById('strategySelectorInput');
    var nameInput = document.getElementById('strategyNameInput');
    var textarea = document.getElementById('strategyTextArea');
    var stockInput = document.getElementById('strategyStockInput');
    var startDateInput = document.getElementById('strategyStartDate');
    var endDateInput = document.getElementById('strategyEndDate');
    var newBtn = document.getElementById('newStrategyBtn');
    var saveBtn = document.getElementById('saveStrategyBtn');
    var deleteBtn = document.getElementById('deleteStrategyBtn');
    var runBtn = document.getElementById('runStrategyBtn');
    var logDiv = document.getElementById('runLogConsole');
    var equityChartDiv = document.getElementById('strategyEquityChart');
    var currentId = 0;

    // 绑定日期选择器
    setTimeout(function() {
        bindDatePicker(startDateInput);
        bindDatePicker(endDateInput);
    }, 50);

    // -----------------------------------------------------------------
    // 1) 刷新策略列表（填充 datalist）
    function refreshStrategyList() {
        bridge.list_strategies().then(function(jsonStr) {
            var strategies = JSON.parse(jsonStr);
            strategyListDL.innerHTML = '';
            strategies.forEach(function(s) {
                var opt = document.createElement('option');
                opt.value = s.id;
                opt.label = s.name + ' (' + s.id + ')';
                strategyListDL.appendChild(opt);
            });
        }).catch(function(err) {
            console.error('获取策略列表失败', err);
        });
    }

    // 2) 选择策略（change 事件）
    selectorInput.addEventListener('change', function() {
        var val = this.value;
        var options = strategyListDL.options;
        var foundId = null;
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            if (opt.label === val || opt.value == val) {
                foundId = parseInt(opt.value);
                break;
            }
        }
        if (foundId) {
            bridge.load_strategy(foundId).then(function(jsonStr) {
                var obj = JSON.parse(jsonStr);
                if (obj && obj.id) {
                    currentId = obj.id;
                    nameInput.value = obj.name;
                    textarea.value = obj.code;
                    // 将输入框内容设为对应的 label，方便用户看到
                    selectorInput.value = obj.name + ' (' + obj.id + ')';
                }
            }).catch(function(err) {
                console.error('加载策略失败', err);
            });
        } else {
            // 未匹配到已知策略，清空编辑器
            currentId = 0;
            nameInput.value = '新策略';
            textarea.value = '';
        }
    });

    // 3) 新建
    newBtn.addEventListener('click', function() {
        currentId = 0;
        nameInput.value = '新策略';
        textarea.value = '';
        selectorInput.value = '';
        refreshStrategyList();   // 刷新列表（以便下次立即看到新策略）
    });

    // 4) 保存
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
                logDiv.innerHTML += '<div>✅ 保存策略成功 ID=' + result.id + '</div>';
                refreshStrategyList();   // 刷新下拉列表
                // 更新输入框显示
                selectorInput.value = name + ' (' + result.id + ')';
            } else {
                logDiv.innerHTML += '<div>❌ 保存失败: ' + (result.message || '') + '</div>';
            }
        }).catch(function(err) {
            console.error('保存策略失败', err);
            logDiv.innerHTML += '<div>❌ 保存失败: ' + err.message + '</div>';
        });
    });

    // 5) 删除
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
                currentId = 0;
                nameInput.value = '新策略';
                textarea.value = '';
                selectorInput.value = '';
                refreshStrategyList();   // 刷新下拉列表
            } else {
                logDiv.innerHTML += '<div>❌ 删除失败: ' + (result.message || '') + '</div>';
            }
        }).catch(function(err) {
            console.error('删除失败', err);
        });
    });

    // 6) 运行回测（真实执行）
    runBtn.addEventListener('click', function() {
        var userCode = textarea.value;
        var stockCode = stockInput.value.trim() || '000001';
        var startDate = startDateInput.value || '2010-01-01';
        var endDate = endDateInput.value || today;
        var cash = 1000000;
        var paramsJson = JSON.stringify({
            user_code: userCode,
            stock_code: stockCode,
            start: startDate,
            end: endDate,
            cash: cash
        });
        logDiv.innerHTML += '<div>🚀 正在执行回测，请稍候...</div>';

        bridge.run_custom_backtest(paramsJson).then(function(resultJson) {
            var res = JSON.parse(resultJson);
            if (!res.success || res.error) {
                logDiv.innerHTML += '<div>❌ 回测失败: ' + (res.error || '未知错误') + '</div>';
                return;
            }
            var signals = res.signals || [];
            var equityCurve = res.equity_curve || [];
            var metrics = res.metrics || {};

            // 更新买卖点
            // 清空原有买卖点（注意保留原有引用对象）
            buyPoints.length = 0;
            sellPoints.length = 0;
            signals.forEach(function(s) {
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

            // 显示绩效摘要
            var totalReturn = metrics.total_return != null ? metrics.total_return : 'N/A';
            var annualReturn = metrics.annual_return != null ? metrics.annual_return : 'N/A';
            var maxDrawdown = metrics.max_drawdown != null ? metrics.max_drawdown : 'N/A';
            var sharpe = metrics.sharpe_ratio != null ? metrics.sharpe_ratio : 'N/A';
            var winRate = metrics.win_rate != null ? metrics.win_rate : 'N/A';
            var trades = metrics.total_trades != null ? metrics.total_trades : 0;

            logDiv.innerHTML += '<div>📊 累计收益: <span style="color:' + (totalReturn >= 0 ? '#ff4d4f' : '#52c41a') + ';">' + totalReturn + '%</span></div>';
            logDiv.innerHTML += '<div>📊 年化收益: ' + annualReturn + '%</div>';
            logDiv.innerHTML += '<div>📊 最大回撤: ' + maxDrawdown + '%</div>';
            logDiv.innerHTML += '<div>📊 夏普比率: ' + sharpe + '</div>';
            logDiv.innerHTML += '<div>📊 胜率: ' + winRate + '%</div>';
            logDiv.innerHTML += '<div>📊 总交易次数: ' + trades + '</div>';
            logDiv.innerHTML += '<div>📈 共产生买入信号 ' + buyPoints.length + ' 个，卖出信号 ' + sellPoints.length + ' 个</div>';
            logDiv.innerHTML += '<div>💡 可前往「买卖点成交图」查看K线标识</div>';

            // 绘制权益曲线
            if (equityCurve.length > 0 && typeof echarts !== 'undefined') {
                var chart = echarts.init(equityChartDiv);
                var dates = equityCurve.map(function(e) { return e.date; });
                var values = equityCurve.map(function(e) { return e.value; });
                chart.setOption({
                    tooltip: { trigger: 'axis' },
                    xAxis: { type: 'category', data: dates, axisLabel: { color: '#9aa9cc' } },
                    yAxis: { type: 'value', name: '账户价值(元)', axisLabel: { color: '#9aa9cc' } },
                    series: [{
                        type: 'line',
                        data: values,
                        smooth: true,
                        lineStyle: { color: '#4f7eff' },
                        areaStyle: { color: 'rgba(79,126,255,0.2)' }
                    }]
                });
            } else {
                equityChartDiv.innerHTML = '<div style="color:#aaa; text-align:center; padding:60px 0;">缺少权益曲线数据</div>';
            }
            logDiv.scrollTop = logDiv.scrollHeight;
        }).catch(function(err) {
            console.error('回测请求失败', err);
            logDiv.innerHTML += '<div>❌ 回测请求失败: ' + err.message + '</div>';
        });
    });

    // 7) 页面初始化时立即加载策略列表
    refreshStrategyList();
}
