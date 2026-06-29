// ==================== 数据源设置 & 降级通知 ====================
import { bridge, bridgeReady, onBridgeReady } from './bridge.js';

// ---- 自定义下拉面板（避免 QtWebEngine 原生 select 问题）----
function _closeAtCustomSelect() {
    var panel = document.querySelector('.at-custom-select-panel');
    if (panel) panel.remove();
    document.removeEventListener('click', _onAtDocClick);
}
function _onAtDocClick(e) {
    var panel = document.querySelector('.at-custom-select-panel');
    if (panel && !panel.contains(e.target)) {
        _closeAtCustomSelect();
    }
}
function showAtCustomSelect(input, options, callback) {
    _closeAtCustomSelect();
    if (!options || options.length === 0) return;

    var panel = document.createElement('div');
    panel.className = 'at-custom-select-panel';
    panel.style.cssText = 'position:fixed;z-index:99999;background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:6px 0;max-height:250px;overflow-y:auto;min-width:180px;box-shadow:0 8px 20px rgba(0,0,0,0.5);';

    options.forEach(function(opt) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:8px 16px;cursor:pointer;color:#fff;font-size:13px;white-space:nowrap;';
        item.textContent = opt.label;
        item.setAttribute('data-value', opt.value);
        item.addEventListener('mouseenter', function() { item.style.background = '#2d3a5e'; });
        item.addEventListener('mouseleave', function() { item.style.background = 'transparent'; });
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            input.value = opt.label;
            input.setAttribute('data-value', opt.value);
            _closeAtCustomSelect();
            if (typeof callback === 'function') callback(opt.value);
        });
        panel.appendChild(item);
    });

    document.body.appendChild(panel);

    var rect = input.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.style.top = (rect.bottom + 4) + 'px';

    setTimeout(function() {
        document.addEventListener('click', _onAtDocClick);
    }, 0);
}

// ---- 自定义下拉面板（避免 QtWebEngine 原生 select 问题）----
var idleDaysOptions = [
    { label: '3 天', value: '3' },
    { label: '7 天', value: '7' },
    { label: '15 天', value: '15' },
    { label: '从不', value: '0' }
];

function _closeCustomDropdown(cls) {
    var panel = document.querySelector('.' + (cls || 'idle-days-dropdown'));
    if (panel) panel.remove();
    document.removeEventListener('click', _onDocClickDropdown);
}
function _onDocClickDropdown(e) {
    var panel = document.querySelector('.idle-days-dropdown');
    if (panel && !panel.contains(e.target) && e.target.id !== 'idleUpdateDays' && e.target.id !== 'idleDaysArrow') {
        _closeCustomDropdown('idle-days-dropdown');
    }
}
function _showIdleDaysDropdown(input, options, onSelect) {
    _closeCustomDropdown('idle-days-dropdown');
    if (!options || options.length === 0) return;

    var panel = document.createElement('div');
    panel.className = 'idle-days-dropdown';
    panel.style.cssText = 'position:fixed;z-index:99999;background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:4px 0;max-height:220px;overflow-y:auto;min-width:80px;box-shadow:0 8px 20px rgba(0,0,0,0.5);';

    options.forEach(function(opt) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:8px 16px;cursor:pointer;color:#fff;font-size:13px;white-space:nowrap;';
        item.textContent = opt.label;
        item.addEventListener('mouseenter', function() { item.style.background = '#2d3a5e'; });
        item.addEventListener('mouseleave', function() { item.style.background = 'transparent'; });
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            input.value = opt.label;
            input.setAttribute('data-value', opt.value);
            _closeCustomDropdown('idle-days-dropdown');
            if (typeof onSelect === 'function') onSelect(opt.value);
        });
        panel.appendChild(item);
    });

    document.body.appendChild(panel);
    var rect = input.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.style.top = (rect.bottom + 4) + 'px';

    setTimeout(function() {
        document.addEventListener('click', _onDocClickDropdown);
    }, 0);
}

// ---- 通知栏 ----
export function showNotification(message, type) {
    var bar = document.getElementById('degradationNoticeBar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'degradationNoticeBar';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:12px 24px;text-align:center;font-size:14px;font-weight:600;transform:translateY(-100%);transition:transform 0.35s ease;display:flex;justify-content:center;align-items:center;gap:12px;';
        document.body.appendChild(bar);
    }
    var bg = type === 'warning' ? '#e67e22' : (type === 'error' ? '#e74c3c' : '#27ae60');
    bar.style.background = bg;
    bar.style.color = '#fff';
    bar.innerHTML = '<span>' + message + '</span><button id="noticeDismissBtn" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:12px;">知道了</button>';
    bar.style.transform = 'translateY(0)';

    var dismissBtn = document.getElementById('noticeDismissBtn');
    if (dismissBtn) {
        dismissBtn.addEventListener('click', function() {
            bar.style.transform = 'translateY(-100%)';
        });
    }
    setTimeout(function() {
        if (bar.style.transform === 'translateY(0px)') {
            bar.style.transform = 'translateY(-100%)';
        }
    }, 8000);
}

// ---- 首次启动检查 ----
export function checkFirstLaunch() {
    if (!bridgeReady) {
        onBridgeReady(checkFirstLaunch);
        return;
    }
    try {
        // 直接查询后端配置
        if (bridge && typeof bridge.get_data_source_config === 'function') {
            bridge.get_data_source_config().then(function(jsonStr) {
                try {
                    const cfg = JSON.parse(jsonStr);
                    if (cfg.success) {
                        // 有效配置：baostock 永远有效；tushare 且 token 非空
                        const isValid = (cfg.data_source === 'baostock') ||
                                        (cfg.data_source === 'tushare' && cfg.tushare_token && cfg.tushare_token.trim() !== '');
                        if (isValid) {
                            // 同步设置 localStorage，以便下次快速判断（但不再作为唯一依据）
                            localStorage.setItem('tquant_datasource_configured', '1');
                            return; // 配置有效，不弹窗
                        }
                    }
                } catch (e) {}
                // 无效配置，弹窗
                setTimeout(() => openDataSourceModal(), 800);
            }).catch(function() {
                setTimeout(() => openDataSourceModal(), 800);
            });
        } else {
            setTimeout(() => openDataSourceModal(), 800);
        }
    } catch (e) {
        console.warn('[Settings] 首次检查异常:', e);
    }
}

// ---- 检查降级通知 ----
export function checkDegradationNotice() {
    if (!bridgeReady || !bridge || typeof bridge.get_data_source_config !== 'function') return;
    bridge.get_data_source_config().then(function(jsonStr) {
        try {
            var cfg = JSON.parse(jsonStr);
            if (!cfg.success) return;
            var lastChoice = localStorage.getItem('tquant_last_source_choice');
            if (lastChoice === 'tushare' && cfg.data_source === 'baostock') {
                showNotification('数据源已自动降级为 Baostock（Tushare 积分不足）', 'warning');
                localStorage.setItem('tquant_last_source_choice', 'baostock');
            }
        } catch (e) {}
    }).catch(function() {});
}

// ---- 模态框操作（使用 Tquant.html 中的静态 HTML）----
export function openDataSourceModal() {
    var overlay = document.getElementById('dataSourceModal');
    if (!overlay) return;
    overlay.classList.add('active');

    // 加载当前配置到表单
    loadCurrentConfig();

    // 绑定事件（只绑一次，通过标记避免重复）
    if (!overlay._eventsBound) {
        bindModalEvents(overlay);
        overlay._eventsBound = true;
    }
}

function closeDataSourceModal() {
    var overlay = document.getElementById('dataSourceModal');
    if (overlay) overlay.classList.remove('active');
}

function loadCurrentConfig() {
    if (!bridge || typeof bridge.get_data_source_config !== 'function') return;
    bridge.get_data_source_config().then(function(jsonStr) {
        try {
            var cfg = JSON.parse(jsonStr);
            if (!cfg.success) return;

            var radioB = document.querySelector('input[name="dataSource"][value="baostock"]');
            var radioT = document.querySelector('input[name="dataSource"][value="tushare"]');
            var tokenInput = document.getElementById('tushareTokenInput');
            var tokenGroup = document.getElementById('tokenGroup');
            var optB = document.getElementById('dsOptBaostock');
            var optT = document.getElementById('dsOptTushare');

            if (cfg.data_source === 'tushare') {
                if (radioT) radioT.checked = true;
                if (tokenGroup) tokenGroup.style.display = '';
                if (optB) optB.classList.remove('selected');
                if (optT) optT.classList.add('selected');
            } else {
                if (radioB) radioB.checked = true;
                if (tokenGroup) tokenGroup.style.display = 'none';
                if (optB) optB.classList.add('selected');
                if (optT) optT.classList.remove('selected');
            }
            if (tokenInput) tokenInput.value = cfg.tushare_token || '';
            // 清空之前的验证结果
            var integralResult = document.getElementById('integralResult');
            if (integralResult) integralResult.textContent = '';
        } catch (e) {}
    }).catch(function() {});
}

function bindModalEvents(overlay) {
    var radioB = document.querySelector('input[name="dataSource"][value="baostock"]');
    var radioT = document.querySelector('input[name="dataSource"][value="tushare"]');
    var tokenGroup = document.getElementById('tokenGroup');
    var optB = document.getElementById('dsOptBaostock');
    var optT = document.getElementById('dsOptTushare');
    var closeBtn = document.getElementById('dsModalCloseX');
    var cancelBtn = document.getElementById('cancelModalBtn');
    var saveBtn = document.getElementById('saveDataSourceBtn');
    var checkBtn = document.getElementById('checkTokenBtn');
    var tokenInput = document.getElementById('tushareTokenInput');
    var integralResult = document.getElementById('integralResult');

    function setSource(source) {
	    if (source === 'tushare') {
	        if (tokenGroup) tokenGroup.style.display = 'block';
	        if (optB) optB.classList.remove('selected');
	        if (optT) optT.classList.add('selected');
	        if (radioT) radioT.checked = true;
	    } else {
	        if (tokenGroup) tokenGroup.style.display = 'none';
	        if (optB) optB.classList.add('selected');
	        if (optT) optT.classList.remove('selected');
	        if (radioB) radioB.checked = true;
	    }
	}

    if (radioB) radioB.addEventListener('change', function() { if (this.checked) setSource('baostock'); });
    if (radioT) radioT.addEventListener('change', function() { if (this.checked) setSource('tushare'); });
    if (optB) optB.addEventListener('click', function() { setSource('baostock'); });
    if (optT) optT.addEventListener('click', function() { setSource('tushare'); });

    if (closeBtn) closeBtn.addEventListener('click', closeDataSourceModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeDataSourceModal);
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeDataSourceModal();
    });

    document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
            closeDataSourceModal();
        }
    });

    // 验证积分
    if (checkBtn) {
        checkBtn.addEventListener('click', function() {
            var token = tokenInput ? tokenInput.value.trim() : '';
            if (!token) {
                if (integralResult) integralResult.innerHTML = '<span style="color:#e74c3c;">请输入 Token</span>';
                return;
            }
            if (integralResult) integralResult.innerHTML = '<span style="color:#f2c94c;">正在查询...</span>';
            checkBtn.disabled = true;
            checkBtn.textContent = '查询中...';

            if (bridge && typeof bridge.check_tushare_integral === 'function') {
                bridge.check_tushare_integral(token).then(function(jsonStr) {
                    try {
                        var res = JSON.parse(jsonStr);
                        if (res.success) {
                            var color = res.sufficient ? '#27ae60' : '#e74c3c';
                            if (integralResult) integralResult.innerHTML = '<span style="color:' + color + ';">' + res.message + '</span>';
                        } else {
                            if (integralResult) integralResult.innerHTML = '<span style="color:#e74c3c;">' + (res.error || '查询失败') + '</span>';
                        }
                    } catch (e) {
                        if (integralResult) integralResult.innerHTML = '<span style="color:#e74c3c;">解析结果失败</span>';
                    }
                    checkBtn.disabled = false;
                    checkBtn.textContent = '验证积分';
                }).catch(function(err) {
                    if (integralResult) integralResult.innerHTML = '<span style="color:#e74c3c;">请求失败: ' + err.message + '</span>';
                    checkBtn.disabled = false;
                    checkBtn.textContent = '验证积分';
                });
            } else {
                if (integralResult) integralResult.innerHTML = '<span style="color:#e74c3c;">Bridge 不可用</span>';
                checkBtn.disabled = false;
                checkBtn.textContent = '验证积分';
            }
        });
    }

    // 保存配置
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            var source = radioT && radioT.checked ? 'tushare' : 'baostock';
            var token = tokenInput ? tokenInput.value.trim() : '';

            if (source === 'tushare' && !token) {
                if (integralResult) integralResult.innerHTML = '<span style="color:#e74c3c;">使用 Tushare 需要填写 Token</span>';
                return;
            }
            if (!bridge || typeof bridge.set_data_source_config !== 'function') {
                if (integralResult) integralResult.innerHTML = '<span style="color:#e74c3c;">Bridge 不可用，无法保存</span>';
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = '保存中...';

            bridge.set_data_source_config(source, token).then(function(jsonStr) {
                try {
                    var res = JSON.parse(jsonStr);
                    if (res.success) {
                        localStorage.setItem('tquant_last_source_choice', source);
                        localStorage.setItem('tquant_datasource_configured', '1');
                        showNotification(res.message, 'success');
                        closeDataSourceModal();
                    } else {
                        if (integralResult) integralResult.innerHTML = '<span style="color:#e74c3c;">保存失败: ' + (res.error || '未知错误') + '</span>';
                    }
                } catch (e) {
                    if (integralResult) integralResult.innerHTML = '<span style="color:#e74c3c;">解析结果失败</span>';
                }
                saveBtn.disabled = false;
                saveBtn.textContent = '保存配置';
            }).catch(function(err) {
                if (integralResult) integralResult.innerHTML = '<span style="color:#e74c3c;">请求失败: ' + err.message + '</span>';
                saveBtn.disabled = false;
                saveBtn.textContent = '保存配置';
            });
        });
    }
}

// ---- 渲染设置页面 ----
export function renderSettingsPage(container) {
    container.innerHTML = `
        <div class="card">
            <div class="card-title">⚙️ 设置</div>

            <!-- 数据源设置区域 -->
            <div style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #323d5a;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <h4 style="color:#4f7eff;margin:0;">📡 数据源配置</h4>
                    <button id="openDsModalBtn" style="background:#4f7eff;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;">修改配置</button>
                </div>
                <div id="dsConfigSummary" style="color:#9aa9cc;font-size:13px;">加载中...</div>
                <p style="color:#9aa9cc;font-size:12px;margin-top:4px;">Baostock 免费无需配置；Tushare 需注册获取 Token，积分 ≥ 200 才可获取前复权数据。</p>
            </div>

            <h4 style="color:#4f7eff; margin-top:12px;">🖼️ 头像设置</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">前往"个人中心"页面上传头像，支持 PNG/JPG 格式，自动保存到本地。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">📅 日期选择</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">所有日期输入框使用自定义日期选择器，点击输入框即可弹出日历面板。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">📈 K线图表</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">基于 ECharts 渲染，支持缩放、拖拽。买卖点以标记点形式叠加显示。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">💻 策略编辑器</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">支持 Tab 缩进（转换为4空格），语法高亮。策略通过 JSON 文件持久化存储。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">🔌 Bridge 连接</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">Python 后端通过 QWebChannel 与前端通信。右上角指示灯显示连接状态。无连接时自动降级为模拟数据。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">💡 快捷键</h4>
            <div class="code-area" style="margin-bottom:12px;">
Tab (编辑器)     → 插入4个空格
Enter (搜索框)   → 触发查询
Esc (弹窗)       → 关闭弹窗
Ctrl+Shift+D     → 切换调试面板（右下角浮窗）</div>

            <h4 style="color:#4f7eff; margin-top:12px;">🐛 调试面板</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">按 <b>Ctrl+Shift+D</b> 或访问 <b>?debug=1</b> 开启右下角调试面板。面板显示指标计算的原始日期、连续序列、非空值数量等关键信息，用于排查副图不连续问题。双击面板可清空内容。</p>

            <!-- 数据管理区域 -->
            <div style="margin-top: 20px; border-top: 1px solid #323d5a; padding-top: 16px;">
                <h4 style="color:#4f7eff;">📊 数据管理</h4>

                <!-- 按需更新说明 -->
                <p style="color:#9aa9cc; font-size:12px; margin-bottom:8px;">查询个股时自动按需拉取最新数据，无需手动全量更新。每日定时全量更新已禁用。</p>

                <!-- 空闲后台更新 -->
                <div style="display:flex;align-items:center;gap:12px;margin-top:12px;">
                    <span style="color:#9aa9cc;font-size:13px;">🕐 空闲时后台更新：</span>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                        <input type="checkbox" id="idleUpdateToggle" checked style="accent-color:#4f7eff;">
                        <span style="color:#fff;font-size:12px;">启用</span>
                    </label>
                    <span style="color:#9aa9cc;font-size:12px;margin-left:8px;">阈值：</span>
                    <div style="position:relative;display:inline-block;">
                        <input type="text" id="idleUpdateDays" readonly data-value="3" value="3 天" style="width:70px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 24px 4px 8px;font-size:12px;cursor:pointer;box-sizing:border-box;">
                        <span id="idleDaysArrow" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);color:#9aa9cc;pointer-events:none;font-size:10px;">▼</span>
                    </div>
                    <button id="saveIdleSettingsBtn" style="background:#2d3a5e;border:none;border-radius:6px;color:#fff;padding:4px 12px;cursor:pointer;font-size:12px;">保存</button>
                    <span id="idleSettingsStatus" style="color:#27ae60;font-size:11px;"></span>
                </div>
                <p style="color:#9aa9cc;font-size:11px;margin-top:4px;">用户连续 30 分钟无操作后，自动更新超过阈值的股票（每次最多 50 只，间隔 2 秒）。</p>

                <!-- 更新选项 -->
                <div style="margin-top:16px;padding:12px;background:#0e1220;border:1px solid #2a3145;border-radius:8px;">
                    <h5 style="color:#fff;margin:0 0 10px 0;">⚙️ 全量更新选项</h5>
                    <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                            <input type="checkbox" id="optUpdateKline" checked style="accent-color:#4f7eff;">
                            <span style="color:#fff;font-size:12px;">更新日线K线</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                            <input type="checkbox" id="optUpdateTurnover" style="accent-color:#4f7eff;">
                            <span style="color:#fff;font-size:12px;">更新换手率</span>
                        </label>
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="color:#9aa9cc;font-size:12px;">只更新最近</span>
                            <input type="number" id="optMaxDaysBack" value="0" min="0" max="365" step="1"
                                style="width:55px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 6px;font-size:12px;text-align:center;">
                            <span style="color:#9aa9cc;font-size:12px;">天（0=不限制）</span>
                        </div>
                        <button id="saveUpdateOptionsBtn" style="background:#2d3a5e;border:none;border-radius:6px;color:#fff;padding:5px 12px;cursor:pointer;font-size:12px;">保存选项</button>
                        <span id="updateOptionsStatus" style="color:#27ae60;font-size:11px;"></span>
                    </div>
                </div>

                <!-- 手动全量更新 -->
                <div style="margin-top:14px;">
                    <button id="manualUpdateDataBtn" style="background:#4f7eff; border:none; padding:6px 18px; border-radius:30px; color:#fff; font-weight:600; cursor:pointer;">🔄 立即全量更新日线数据</button>
                    <span id="updateStatusMsg" style="margin-left: 12px; color:#9aa9cc; font-size:12px;"></span>
                </div>
                <p style="color:#9aa9cc; font-size:11px; margin-top:4px;">高级用户手动触发，遍历所有股票执行全量更新（耗时较长，期间可正常使用程序）。</p>

                <!-- 更新进度条 -->
                <div id="updateProgressArea" style="display:none; margin-top:12px; padding:10px; background:#0e1220; border:1px solid #2a3145; border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span id="updateProgressLabel" style="color:#4f7eff;font-size:12px;">⏳ 正在更新...</span>
                        <span id="updateProgressPercent" style="color:#fff;font-size:12px;font-weight:600;">0%</span>
                    </div>
                    <div style="background:#1e253b;border-radius:10px;height:8px;overflow:hidden;">
                        <div id="updateProgressBar" style="background:linear-gradient(90deg,#4f7eff,#27ae60);height:100%;width:0%;border-radius:10px;transition:width 0.3s ease;"></div>
                    </div>
                    <p id="updateProgressDetail" style="color:#9aa9cc;font-size:11px;margin:4px 0 0 0;"></p>
                </div>

                <!-- 财务更新 -->
                <button id="manualFinUpdateBtn" style="background:#4f7eff; border:none; padding:6px 18px; border-radius:30px; color:#fff; font-weight:600; cursor:pointer; margin-top:8px;">📊 手动更新财务数据</button>
                <span id="finUpdateStatusMsg" style="margin-left: 12px; color:#9aa9cc; font-size:12px;"></span>
                <p style="color:#9aa9cc; font-size:12px; margin-top:4px;">财务数据（PE/PB/ROE/市值/股本）需手动触发更新，建议每 3 个月更新一次，耗时约 3-10 分钟。</p>

                <!-- 概念题材更新 -->
                <button id="manualConceptUpdateBtn" style="background:#4f7eff; border:none; padding:6px 18px; border-radius:30px; color:#fff; font-weight:600; cursor:pointer; margin-top:8px;">🏷️ 手动更新概念题材</button>
                <span id="conceptUpdateStatusMsg" style="margin-left: 12px; color:#9aa9cc; font-size:12px;"></span>
                <p style="color:#9aa9cc; font-size:12px; margin-top:4px;">概念题材数据（板块归属、题材分类）需手动触发更新，建议每 1-3 个月更新一次，耗时约 3-10 分钟。</p>

                <!-- 行业分类更新 -->
                <button id="manualIndustryUpdateBtn" style="background:#4f7eff; border:none; padding:6px 18px; border-radius:30px; color:#fff; font-weight:600; cursor:pointer; margin-top:8px;">🏭 手动更新行业分类</button>
                <span id="industryUpdateStatusMsg" style="margin-left: 12px; color:#9aa9cc; font-size:12px;"></span>
                <p style="color:#9aa9cc; font-size:12px; margin-top:4px;">行业分类数据（股票所属行业）需手动触发更新，建议每 1 个月更新一次，耗时约 1-3 分钟。</p>
            </div>

            <!-- 自动下单配置区域 -->
            <div style="margin-top: 20px; border-top: 1px solid #323d5a; padding-top: 16px;">
                <h4 style="color:#4f7eff;">🤖 自动真实下单配置</h4>
                <p style="color:#9aa9cc; font-size:12px; margin-bottom:12px;">在实时模拟交易页面启用"同时真实下单"后，每次策略信号会自动向券商发起真实订单。</p>

                <div id="autoTradeConfigPanel">
                    <!-- 模式选择 -->
                    <div class="metric-row" style="margin-bottom:10px;">
                        <span style="color:#9aa9cc;font-size:13px;">下单模式：</span>
                        <input type="text" id="atModeSelectInput" readonly data-value="pyautogui" value="pyautogui（模拟操作）"
                            style="width:220px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:6px 10px;font-size:13px;cursor:pointer;">
                        <select id="atModeSelect" style="display:none;">
                            <option value="pyautogui">pyautogui（模拟操作）</option>
                            <option value="easytrader">easytrader（API下单）</option>
                        </select>
                        <button id="atSaveModeBtn" style="background:#2d3a5e;border:none;border-radius:6px;color:#fff;padding:6px 14px;cursor:pointer;font-size:12px;">保存</button>
                        <span id="atModeStatus" style="color:#27ae60;font-size:11px;"></span>
                    </div>

                    <!-- 风控设置 -->
                    <div style="margin-top:12px;">
                        <h5 style="color:#fff;margin:0 0 8px 0;">🛡️ 风控设置</h5>
                        <div class="metric-row" style="margin-bottom:6px;">
                            <span style="color:#9aa9cc;font-size:12px;">单笔最大金额：</span>
                            <input type="number" id="atMaxAmount" min="0" max="10000000" step="1000" value="50000"
                                style="width:100px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <span style="color:#9aa9cc;font-size:11px;">元</span>
                        </div>
                        <div class="metric-row" style="margin-bottom:6px;">
                            <span style="color:#9aa9cc;font-size:12px;">单笔最大数量：</span>
                            <input type="number" id="atMaxVolume" min="0" max="10000000" step="100" value="10000"
                                style="width:100px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <span style="color:#9aa9cc;font-size:11px;">股</span>
                        </div>
                        <div class="metric-row" style="margin-bottom:6px;">
                            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                                <input type="checkbox" id="atTradingHoursOnly" checked style="accent-color:#4f7eff;">
                                <span style="color:#fff;font-size:12px;">仅交易时段执行</span>
                            </label>
                        </div>
                        <button id="atSaveRiskBtn" style="background:#2d3a5e;border:none;border-radius:6px;color:#fff;padding:6px 14px;cursor:pointer;font-size:12px;margin-top:4px;">保存风控设置</button>
                        <span id="atRiskStatus" style="color:#27ae60;font-size:11px;margin-left:8px;"></span>
                    </div>

                    <!-- pyautogui 配置 -->
                    <div id="atPyautoguiConfig" style="margin-top:12px;padding:10px;background:#0e1220;border:1px solid #2a3145;border-radius:8px;">
                        <h5 style="color:#fff;margin:0 0 8px 0;">🖱️ pyautogui 配置</h5>
                        <div class="metric-row" style="margin-bottom:6px;">
                            <span style="color:#9aa9cc;font-size:12px;">窗口标题：</span>
                            <input type="text" id="atPgWindowTitle" value="网上股票交易系统5.0"
                                style="width:200px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <button id="captureWindowTitleBtn" style="background:#4f7eff;border:none;border-radius:6px;color:#fff;padding:2px 12px;cursor:pointer;font-size:11px;">捕获</button>
                        </div>
                        <div style="margin-bottom:8px;">
                            <span style="color:#9aa9cc;font-size:12px;">代码输入坐标(x,y)：</span>
                            <input type="number" id="atPgCodeX" value="300" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <input type="number" id="atPgCodeY" value="500" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <button id="captureCodePosBtn" class="capture-coord-btn" style="background:#4f7eff;border:none;border-radius:6px;color:#fff;padding:2px 10px;cursor:pointer;font-size:11px;">📍 捕获</button>
                        </div>
                        <div style="margin-bottom:8px;">
                            <span style="color:#9aa9cc;font-size:12px;">价格输入坐标(x,y)：</span>
                            <input type="number" id="atPgPriceX" value="400" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <input type="number" id="atPgPriceY" value="530" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <button id="capturePricePosBtn" class="capture-coord-btn" style="background:#4f7eff;border:none;border-radius:6px;color:#fff;padding:2px 10px;cursor:pointer;font-size:11px;">📍 捕获</button>
                        </div>
                        <div style="margin-bottom:8px;">
                            <span style="color:#9aa9cc;font-size:12px;">数量输入坐标(x,y)：</span>
                            <input type="number" id="atPgVolX" value="500" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <input type="number" id="atPgVolY" value="560" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <button id="captureVolumePosBtn" class="capture-coord-btn" style="background:#4f7eff;border:none;border-radius:6px;color:#fff;padding:2px 10px;cursor:pointer;font-size:11px;">📍 捕获</button>
                        </div>
                        <div style="margin-bottom:8px;">
                            <span style="color:#9aa9cc;font-size:12px;">买入按钮坐标(x,y)：</span>
                            <input type="number" id="atBuyBtnX" value="524" step="1" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <input type="number" id="atBuyBtnY" value="531" step="1" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <button id="captureBuyBtnPosBtn" class="capture-coord-btn" style="background:#4f7eff;border:none;border-radius:6px;color:#fff;padding:2px 10px;cursor:pointer;font-size:11px;">📍 捕获</button>
                        </div>
                        <div style="margin-bottom:8px;">
                            <span style="color:#9aa9cc;font-size:12px;">卖出按钮坐标(x,y)：</span>
                            <input type="number" id="atSellBtnX" value="541" step="1" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <input type="number" id="atSellBtnY" value="528" step="1" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <button id="captureSellBtnPosBtn" class="capture-coord-btn" style="background:#4f7eff;border:none;border-radius:6px;color:#fff;padding:2px 10px;cursor:pointer;font-size:11px;">📍 捕获</button>
                        </div>
                        <div style="margin-bottom:8px;">
                            <span style="color:#9aa9cc;font-size:12px;">确认"是"坐标(x,y)：</span>
                            <input type="number" id="atConfirmYesX" value="1044" step="1" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <input type="number" id="atConfirmYesY" value="739" step="1" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <button id="captureConfirmYesPosBtn" class="capture-coord-btn" style="background:#4f7eff;border:none;border-radius:6px;color:#fff;padding:2px 10px;cursor:pointer;font-size:11px;">📍 捕获</button>
                        </div>
                        <div style="margin-bottom:8px;">
                            <span style="color:#9aa9cc;font-size:12px;">确认"否"坐标(x,y)：</span>
                            <input type="number" id="atConfirmNoX" value="1196" step="1" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <input type="number" id="atConfirmNoY" value="745" step="1" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <button id="captureConfirmNoPosBtn" class="capture-coord-btn" style="background:#4f7eff;border:none;border-radius:6px;color:#fff;padding:2px 10px;cursor:pointer;font-size:11px;">📍 捕获</button>
                        </div>
                        <div style="margin-bottom:8px;">
                            <span style="color:#9aa9cc;font-size:12px;">错误弹窗"确定"坐标(x,y)：</span>
                            <input type="number" id="atErrorOkX" value="0" step="1" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <input type="number" id="atErrorOkY" value="0" step="1" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                            <button id="captureErrorOkPosBtn" class="capture-coord-btn" style="background:#4f7eff;border:none;border-radius:6px;color:#fff;padding:2px 10px;cursor:pointer;font-size:11px;">📍 捕获</button>
                        </div>
                        <div id="atCaptureStatus" style="color:#f2c94c;font-size:11px;margin-bottom:4px;display:none;"></div>
                        <button id="atCancelCaptureBtn" style="background:#e74c3c;border:none;border-radius:6px;color:#fff;padding:2px 12px;cursor:pointer;font-size:11px;display:none;">取消捕获</button>
                        <div class="metric-row" style="margin-bottom:6px;">
                            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                                <input type="checkbox" id="atPgUseImage" checked style="accent-color:#4f7eff;">
                                <span style="color:#fff;font-size:12px;">启用图像识别</span>
                            </label>
                            <span style="color:#9aa9cc;font-size:11px;margin-left:8px;">置信度：</span>
                            <input type="number" id="atPgConfidence" value="0.8" step="0.05" min="0.5" max="1.0"
                                style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                        </div>
                        <button id="atSavePyautoguiBtn" style="background:#2d3a5e;border:none;border-radius:6px;color:#fff;padding:6px 14px;cursor:pointer;font-size:12px;">保存 pyautogui 配置</button>
                        <span id="atPgStatus" style="color:#27ae60;font-size:11px;margin-left:8px;"></span>
                    </div>

                    <!-- easytrader 配置 -->
                    <div id="atEasytraderConfig" style="margin-top:12px;padding:10px;background:#0e1220;border:1px solid #2a3145;border-radius:8px;display:none;">
                        <h5 style="color:#fff;margin:0 0 8px 0;">📡 easytrader 配置</h5>
                        <div class="metric-row" style="margin-bottom:6px;">
                            <span style="color:#9aa9cc;font-size:12px;">券商类型：</span>
                            <input type="text" id="atEtBrokerInput" readonly data-value="ht_client" value="华泰证券"
                                style="width:140px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;cursor:pointer;">
                            <select id="atEtBroker" style="display:none;">
                                <option value="ht_client">华泰证券</option>
                                <option value="gj_client">国金证券</option>
                                <option value="yh_client">银河证券</option>
                                <option value="xueqiu">雪球</option>
                            </select>
                        </div>
                        <div class="metric-row" style="margin-bottom:6px;">
                            <span style="color:#9aa9cc;font-size:12px;">配置文件路径：</span>
                            <input type="text" id="atEtConfigPath" value="ht.json"
                                style="width:200px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">
                        </div>
                        <button id="atSaveEasytraderBtn" style="background:#2d3a5e;border:none;border-radius:6px;color:#fff;padding:6px 14px;cursor:pointer;font-size:12px;">保存 easytrader 配置</button>
                        <span id="atEtStatus" style="color:#27ae60;font-size:11px;margin-left:8px;"></span>
                    </div>

                    <!-- 下单日志 -->
                    <div style="margin-top:12px;">
                        <h5 style="color:#fff;margin:0 0 8px 0;">📋 最近下单记录</h5>
                        <button id="atRefreshLogsBtn" style="background:#2d3a5e;border:none;border-radius:6px;color:#fff;padding:4px 12px;cursor:pointer;font-size:11px;margin-bottom:6px;">刷新</button>
                        <div id="atLogTable" style="max-height:200px;overflow-y:auto;background:#0e1220;border:1px solid #2a3145;border-radius:8px;">
                            <table style="width:100%;font-size:11px;color:#9aa9cc;">
                                <thead><tr><th>时间</th><th>股票</th><th>方向</th><th>价格</th><th>数量</th><th>状态</th><th>信息</th></tr></thead>
                                <tbody id="atLogTbody"><tr><td colspan="7" style="text-align:center;">点击刷新加载</td></tr></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div id="windowCaptureOverlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); z-index:100000; justify-content:center; align-items:center; color:#fff; font-size:18px;">
            <div style="background:#1a2135; padding:30px; border-radius:16px; text-align:center; max-width:450px;">
                <p style="margin:0 0 8px 0;">请点击目标窗口的标题栏</p>
                <p style="font-size:14px; color:#9aa9cc; margin:0;">例如同花顺窗口顶部，点击后将自动捕获窗口标题</p>
                <button id="cancelCaptureTitleBtn" style="margin-top:20px; background:#e74c3c; border:none; padding:8px 24px; border-radius:30px; cursor:pointer; color:#fff; font-size:14px;">取消</button>
            </div>
        </div>`;

    updateConfigSummary();
    loadIdleSettings();
    loadUpdateOptionsUI();

    var openBtn = document.getElementById('openDsModalBtn');
    if (openBtn) {
        openBtn.addEventListener('click', function() { openDataSourceModal(); });
    }

    // 自定义下拉：空闲更新阈值
    var daysInput = document.getElementById('idleUpdateDays');
    var daysArrow = document.getElementById('idleDaysArrow');
    if (daysInput) {
        daysInput.addEventListener('click', function(e) {
            e.stopPropagation();
            _showIdleDaysDropdown(daysInput, idleDaysOptions, null);
        });
    }
    if (daysArrow) {
        daysArrow.addEventListener('click', function(e) {
            e.stopPropagation();
            _showIdleDaysDropdown(daysInput, idleDaysOptions, null);
        });
    }

    // 保存空闲更新设置
    var saveIdleBtn = document.getElementById('saveIdleSettingsBtn');
    if (saveIdleBtn) {
        saveIdleBtn.addEventListener('click', function() {
            var toggle = document.getElementById('idleUpdateToggle');
            var daysInput = document.getElementById('idleUpdateDays');
            var enabled = toggle ? toggle.checked : true;
            var days = daysInput ? parseInt(daysInput.getAttribute('data-value') || '3') : 3;

            if (!bridge || typeof bridge.save_idle_update_settings !== 'function') return;

            bridge.save_idle_update_settings(enabled, days).then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                if (res.success) {
                    localStorage.setItem('idle_update_enabled', enabled ? '1' : '0');
                    localStorage.setItem('idle_update_days', String(days));
                    var st = document.getElementById('idleSettingsStatus');
                    if (st) { st.textContent = '已保存'; setTimeout(function() { st.textContent = ''; }, 2000); }
                } else {
                    var st = document.getElementById('idleSettingsStatus');
                    if (st) { st.textContent = '保存失败'; st.style.color = '#e74c3c'; }
                }
            }).catch(function() {
                var st = document.getElementById('idleSettingsStatus');
                if (st) { st.textContent = '保存失败'; st.style.color = '#e74c3c'; }
            });
        });
    }

    // 保存更新选项
    var saveOptsBtn = document.getElementById('saveUpdateOptionsBtn');
    if (saveOptsBtn && bridge && typeof bridge.save_update_options === 'function') {
        saveOptsBtn.addEventListener('click', function() {
            var options = {
                update_kline: document.getElementById('optUpdateKline').checked,
                update_turnover: document.getElementById('optUpdateTurnover').checked,
                max_days_back: parseInt(document.getElementById('optMaxDaysBack').value) || 0
            };
            localStorage.setItem('tquant_update_options', JSON.stringify(options));
            bridge.save_update_options(JSON.stringify(options)).then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                var st = document.getElementById('updateOptionsStatus');
                if (st) {
                    st.textContent = res.success ? '已保存' : '保存失败';
                    st.style.color = res.success ? '#27ae60' : '#e74c3c';
                    setTimeout(function() { st.textContent = ''; }, 2000);
                }
            }).catch(function() {
                var st = document.getElementById('updateOptionsStatus');
                if (st) { st.textContent = '保存失败'; st.style.color = '#e74c3c'; }
            });
        });
    }

    // 手动更新日线数据（带选项）
    var updateBtn = document.getElementById('manualUpdateDataBtn');
    if (updateBtn && bridge && typeof bridge.trigger_data_update === 'function') {
        updateBtn.addEventListener('click', function() {
            var options = {
                update_kline: document.getElementById('optUpdateKline').checked,
                update_turnover: document.getElementById('optUpdateTurnover').checked,
                max_days_back: parseInt(document.getElementById('optMaxDaysBack').value) || 0
            };
            if (!options.update_kline && !options.update_turnover) {
                var statusSpan = document.getElementById('updateStatusMsg');
                statusSpan.textContent = '请至少选择一项更新任务';
                statusSpan.style.color = '#e74c3c';
                setTimeout(function() { statusSpan.textContent = ''; statusSpan.style.color = '#9aa9cc'; }, 3000);
                return;
            }

            var statusSpan = document.getElementById('updateStatusMsg');
            updateBtn.disabled = true;
            updateBtn.textContent = '⏳ 更新中...';
            statusSpan.textContent = '正在启动更新...';

            // 显示进度区域
            var progressArea = document.getElementById('updateProgressArea');
            if (progressArea) {
                progressArea.style.display = 'block';
                document.getElementById('updateProgressBar').style.width = '0%';
                document.getElementById('updateProgressPercent').textContent = '0%';
                document.getElementById('updateProgressLabel').textContent = '⏳ 正在初始化...';
                document.getElementById('updateProgressDetail').textContent = '';
            }

            // 启动进度轮询
            var progressTimer = null;
            var startPolling = function() {
                if (progressTimer) clearInterval(progressTimer);
                progressTimer = setInterval(function() {
                    if (bridge && typeof bridge.get_update_progress === 'function') {
                        bridge.get_update_progress().then(function(jsonStr) {
                            try {
                                var prog = JSON.parse(jsonStr);
                                if (prog.status === 'done') {
                                    clearInterval(progressTimer);
                                    document.getElementById('updateProgressBar').style.width = '100%';
                                    document.getElementById('updateProgressPercent').textContent = '100%';
                                    document.getElementById('updateProgressLabel').textContent = '更新完成';
                                    document.getElementById('updateProgressDetail').textContent = '';
                                    updateBtn.disabled = false;
                                    updateBtn.textContent = '立即全量更新日线数据';
                                    statusSpan.textContent = '更新完成';
                                    setTimeout(function() {
                                        var area = document.getElementById('updateProgressArea');
                                        if (area) area.style.display = 'none';
                                        statusSpan.textContent = '';
                                    }, 5000);
                                } else if (prog.status === 'error') {
                                    clearInterval(progressTimer);
                                    document.getElementById('updateProgressLabel').textContent = '更新失败';
                                    document.getElementById('updateProgressDetail').textContent = prog.message || '';
                                    updateBtn.disabled = false;
                                    updateBtn.textContent = '立即全量更新日线数据';
                                    statusSpan.textContent = '更新失败: ' + (prog.message || '');
                                } else if (prog.status === 'running') {
                                    var pct = prog.percent || 0;
                                    document.getElementById('updateProgressBar').style.width = pct + '%';
                                    document.getElementById('updateProgressPercent').textContent = pct + '%';
                                    var stepLabel = prog.step === 'turnover' ? '正在批量获取换手率...'
                                        : prog.step === 'index' ? '正在更新指数日线...'
                                        : '正在更新K线...';
                                    document.getElementById('updateProgressLabel').textContent = '⏳ ' + stepLabel;
                                    var detail = '';
                                    if (prog.total_stocks > 0) {
                                        detail = prog.current_stock + ' / ' + prog.total_stocks + ' 只';
                                    }
                                    document.getElementById('updateProgressDetail').textContent = detail;
                                }
                            } catch (e) {}
                        }).catch(function() {});
                    }
                }, 2000);
            };

            var optionsJson = JSON.stringify(options);
            bridge.trigger_data_update(optionsJson).then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                if (res.success) {
                    statusSpan.textContent = res.message;
                    startPolling();
                } else {
                    statusSpan.textContent = res.message || '触发失败';
                    statusSpan.style.color = '#e74c3c';
                    updateBtn.disabled = false;
                    updateBtn.textContent = '立即全量更新日线数据';
                    var area = document.getElementById('updateProgressArea');
                    if (area) area.style.display = 'none';
                    if (progressTimer) clearInterval(progressTimer);
                }
            }).catch(function(err) {
                statusSpan.textContent = '触发失败: ' + err.message;
                statusSpan.style.color = '#e74c3c';
                updateBtn.disabled = false;
                updateBtn.textContent = '立即全量更新日线数据';
                var area = document.getElementById('updateProgressArea');
                if (area) area.style.display = 'none';
                if (progressTimer) clearInterval(progressTimer);
            });
        });
    }

    // 手动更新财务数据
    var finBtn = document.getElementById('manualFinUpdateBtn');
    if (finBtn && bridge && typeof bridge.trigger_financial_update === 'function') {
        finBtn.addEventListener('click', function() {
            var statusSpan = document.getElementById('finUpdateStatusMsg');
            finBtn.disabled = true;
            finBtn.textContent = '⏳ 正在更新...';
            statusSpan.textContent = '财务数据更新中，此过程需要 3-10 分钟...';
            statusSpan.style.color = '#f2c94c';
            bridge.trigger_financial_update().then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                statusSpan.textContent = res.success ? '已触发更新，请查看后端日志' : (res.message || '更新失败');
                statusSpan.style.color = res.success ? '#27ae60' : '#e74c3c';
                setTimeout(function() { finBtn.disabled = false; finBtn.textContent = '📊 手动更新财务数据'; }, 3000);
            }).catch(function(err) {
                statusSpan.textContent = '触发失败: ' + err.message;
                statusSpan.style.color = '#e74c3c';
                finBtn.disabled = false;
                finBtn.textContent = '📊 手动更新财务数据';
            });
        });
    }

    // 手动更新概念题材
    var conceptBtn = document.getElementById('manualConceptUpdateBtn');
    if (conceptBtn && bridge && typeof bridge.trigger_concept_update === 'function') {
        conceptBtn.addEventListener('click', function() {
            var statusSpan = document.getElementById('conceptUpdateStatusMsg');
            conceptBtn.disabled = true;
            conceptBtn.textContent = '⏳ 正在更新...';
            statusSpan.textContent = '概念题材数据更新中，此过程需要 3-10 分钟...';
            statusSpan.style.color = '#f2c94c';
            bridge.trigger_concept_update().then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                statusSpan.textContent = res.success ? '已触发更新，请查看后端日志' : (res.message || '更新失败');
                statusSpan.style.color = res.success ? '#27ae60' : '#e74c3c';
                setTimeout(function() { conceptBtn.disabled = false; conceptBtn.textContent = '🏷️ 手动更新概念题材'; }, 3000);
            }).catch(function(err) {
                statusSpan.textContent = '触发失败: ' + err.message;
                statusSpan.style.color = '#e74c3c';
                conceptBtn.disabled = false;
                conceptBtn.textContent = '🏷️ 手动更新概念题材';
            });
        });
    }

    // 手动更新行业分类
    var industryBtn = document.getElementById('manualIndustryUpdateBtn');
    if (industryBtn && bridge && typeof bridge.trigger_industry_update === 'function') {
        industryBtn.addEventListener('click', function() {
            var statusSpan = document.getElementById('industryUpdateStatusMsg');
            industryBtn.disabled = true;
            industryBtn.textContent = '⏳ 正在更新...';
            statusSpan.textContent = '行业分类数据更新中，此过程需要 1-3 分钟...';
            statusSpan.style.color = '#f2c94c';
            bridge.trigger_industry_update().then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                statusSpan.textContent = res.success ? '已触发更新，请查看后端日志' : (res.message || '更新失败');
                statusSpan.style.color = res.success ? '#27ae60' : '#e74c3c';
                setTimeout(function() { industryBtn.disabled = false; industryBtn.textContent = '🏭 手动更新行业分类'; }, 3000);
            }).catch(function(err) {
                statusSpan.textContent = '触发失败: ' + err.message;
                statusSpan.style.color = '#e74c3c';
                industryBtn.disabled = false;
                industryBtn.textContent = '🏭 手动更新行业分类';
            });
        });
    }

    // 自动下单配置事件绑定
    bindAutoTradeSettingsEvents();
}

function _getAtModeValue() {
    var input = document.getElementById('atModeSelectInput');
    return input ? (input.getAttribute('data-value') || 'pyautogui') : 'pyautogui';
}

function _setAtModeUI(value, label) {
    var input = document.getElementById('atModeSelectInput');
    if (input) {
        input.value = label || value;
        input.setAttribute('data-value', value);
    }
    var hidden = document.getElementById('atModeSelect');
    if (hidden) hidden.value = value;
}

function _getAtBrokerValue() {
    var input = document.getElementById('atEtBrokerInput');
    return input ? (input.getAttribute('data-value') || 'ht_client') : 'ht_client';
}

function _setAtBrokerUI(value, label) {
    var input = document.getElementById('atEtBrokerInput');
    if (input) {
        input.value = label || value;
        input.setAttribute('data-value', value);
    }
    var hidden = document.getElementById('atEtBroker');
    if (hidden) hidden.value = value;
}

function _toggleModePanels(mode) {
    var pgPanel = document.getElementById('atPyautoguiConfig');
    var etPanel = document.getElementById('atEasytraderConfig');
    if (mode === 'pyautogui') {
        if (pgPanel) pgPanel.style.display = 'block';
        if (etPanel) etPanel.style.display = 'none';
    } else {
        if (pgPanel) pgPanel.style.display = 'none';
        if (etPanel) etPanel.style.display = 'block';
    }
}

function bindAutoTradeSettingsEvents() {
    // 加载配置
    loadAutoTradeConfig();

    // 模式切换 - 自定义下拉
    var modeInput = document.getElementById('atModeSelectInput');
    if (modeInput) {
        modeInput.addEventListener('click', function(e) {
            e.stopPropagation();
            showAtCustomSelect(this, [
                { value: 'pyautogui', label: 'pyautogui（模拟操作）' },
                { value: 'easytrader', label: 'easytrader（API下单）' }
            ], function(val) {
                _setAtModeUI(val, val === 'pyautogui' ? 'pyautogui（模拟操作）' : 'easytrader（API下单）');
                _toggleModePanels(val);
            });
        });
    }

    // 券商类型 - 自定义下拉
    var brokerInput = document.getElementById('atEtBrokerInput');
    if (brokerInput) {
        brokerInput.addEventListener('click', function(e) {
            e.stopPropagation();
            showAtCustomSelect(this, [
                { value: 'ht_client', label: '华泰证券' },
                { value: 'gj_client', label: '国金证券' },
                { value: 'yh_client', label: '银河证券' },
                { value: 'xueqiu', label: '雪球' }
            ], function(val) {
                var labelMap = { ht_client: '华泰证券', gj_client: '国金证券', yh_client: '银河证券', xueqiu: '雪球' };
                _setAtBrokerUI(val, labelMap[val] || val);
            });
        });
    }

    // 保存模式
    var saveModeBtn = document.getElementById('atSaveModeBtn');
    if (saveModeBtn) {
        saveModeBtn.addEventListener('click', function() {
            if (!bridge || typeof bridge.update_auto_trade_config !== 'function') return;
            var mode = _getAtModeValue();
            bridge.update_auto_trade_config(JSON.stringify({ mode: mode })).then(function() {
                var st = document.getElementById('atModeStatus');
                if (st) { st.textContent = '已保存'; setTimeout(function() { st.textContent = ''; }, 2000); }
            });
        });
    }

    // 保存风控设置
    var saveRiskBtn = document.getElementById('atSaveRiskBtn');
    if (saveRiskBtn) {
        saveRiskBtn.addEventListener('click', function() {
            if (!bridge || typeof bridge.update_auto_trade_config !== 'function') return;
            var maxAmount = parseFloat(document.getElementById('atMaxAmount').value) || 50000;
            var maxVolume = parseInt(document.getElementById('atMaxVolume').value) || 10000;
            var tradingHours = document.getElementById('atTradingHoursOnly').checked;
            bridge.update_auto_trade_config(JSON.stringify({
                risk: {
                    max_amount_per_order: maxAmount,
                    max_volume_per_order: maxVolume,
                    trading_hours_only: tradingHours
                }
            })).then(function() {
                var st = document.getElementById('atRiskStatus');
                if (st) { st.textContent = '已保存'; setTimeout(function() { st.textContent = ''; }, 2000); }
            });
        });
    }

    // 保存 pyautogui 配置
    var savePgBtn = document.getElementById('atSavePyautoguiBtn');
    if (savePgBtn) {
        savePgBtn.addEventListener('click', function() {
            if (!bridge || typeof bridge.update_auto_trade_config !== 'function') return;
            var conf = {
                pyautogui: {
                    window_title: document.getElementById('atPgWindowTitle').value || '',
                    code_input_pos: [
                        parseInt(document.getElementById('atPgCodeX').value) || 300,
                        parseInt(document.getElementById('atPgCodeY').value) || 500
                    ],
                    price_input_pos: [
                        parseInt(document.getElementById('atPgPriceX').value) || 400,
                        parseInt(document.getElementById('atPgPriceY').value) || 530
                    ],
                    volume_input_pos: [
                        parseInt(document.getElementById('atPgVolX').value) || 500,
                        parseInt(document.getElementById('atPgVolY').value) || 560
                    ],
                    buy_button_pos: [
                        parseInt(document.getElementById('atBuyBtnX').value) || 524,
                        parseInt(document.getElementById('atBuyBtnY').value) || 531
                    ],
                    sell_button_pos: [
                        parseInt(document.getElementById('atSellBtnX').value) || 541,
                        parseInt(document.getElementById('atSellBtnY').value) || 528
                    ],
                    confirm_yes_pos: [
                        parseInt(document.getElementById('atConfirmYesX').value) || 1044,
                        parseInt(document.getElementById('atConfirmYesY').value) || 739
                    ],
                    confirm_no_pos: [
                        parseInt(document.getElementById('atConfirmNoX').value) || 1196,
                        parseInt(document.getElementById('atConfirmNoY').value) || 745
                    ],
                    error_ok_pos: [
                        parseInt(document.getElementById('atErrorOkX').value) || 0,
                        parseInt(document.getElementById('atErrorOkY').value) || 0
                    ],
                    use_image_recognition: document.getElementById('atPgUseImage').checked,
                    confidence: parseFloat(document.getElementById('atPgConfidence').value) || 0.8
                }
            };
            bridge.update_auto_trade_config(JSON.stringify(conf)).then(function() {
                var st = document.getElementById('atPgStatus');
                if (st) { st.textContent = '已保存'; setTimeout(function() { st.textContent = ''; }, 2000); }
            });
        });
    }

    // 保存 easytrader 配置
    var saveEtBtn = document.getElementById('atSaveEasytraderBtn');
    if (saveEtBtn) {
        saveEtBtn.addEventListener('click', function() {
            if (!bridge || typeof bridge.update_auto_trade_config !== 'function') return;
            var conf = {
                easytrader: {
                    broker: _getAtBrokerValue(),
                    config_path: document.getElementById('atEtConfigPath').value || 'ht.json'
                }
            };
            bridge.update_auto_trade_config(JSON.stringify(conf)).then(function() {
                var st = document.getElementById('atEtStatus');
                if (st) { st.textContent = '已保存'; setTimeout(function() { st.textContent = ''; }, 2000); }
            });
        });
    }

    // 捕获窗口标题按钮（点击目标窗口模式）
    var captureTitleBtn = document.getElementById('captureWindowTitleBtn');
    var titleOverlay = document.getElementById('windowCaptureOverlay');
    var cancelTitleBtn = document.getElementById('cancelCaptureTitleBtn');

    if (captureTitleBtn) {
        captureTitleBtn.addEventListener('click', function() {
            if (!bridge || typeof bridge.start_capture_window_title !== 'function') {
                showToast('当前版本不支持窗口标题捕获，请手动输入', true);
                return;
            }
            titleOverlay.style.display = 'flex';
            bridge.start_capture_window_title();
        });
    }

    if (cancelTitleBtn) {
        cancelTitleBtn.addEventListener('click', function() {
            if (bridge && typeof bridge.cancel_capture_window_title === 'function') {
                bridge.cancel_capture_window_title();
            }
            titleOverlay.style.display = 'none';
        });
    }

    // 后端 window_title_captured 信号 → 全局回调
    window.onWindowTitleCaptured = function(title) {
        var overlay = document.getElementById('windowCaptureOverlay');
        if (overlay) overlay.style.display = 'none';

        if (title && title.trim()) {
            var titleInput = document.getElementById('atPgWindowTitle');
            if (titleInput) titleInput.value = title;
            showToast('捕获成功: ' + title, false, 2500);
            var saveBtn = document.getElementById('atSavePyautoguiBtn');
            if (saveBtn) saveBtn.click();
        } else {
            showToast('捕获失败或超时，请确保点击了有效窗口', true, 3000);
        }
    };

    // 坐标捕获按钮
    window._coordinateCaptureTarget = 'code';
    ['Code', 'Price', 'Volume', 'BuyBtn', 'SellBtn', 'ConfirmYes', 'ConfirmNo', 'ErrorOk'].forEach(function(name) {
        var btn = document.getElementById('capture' + name + 'PosBtn');
        if (!btn) return;
        btn.addEventListener('click', function() {
            var target = name.toLowerCase();
            window._coordinateCaptureTarget = target;

            // 高亮当前捕获按钮
            document.querySelectorAll('.capture-coord-btn').forEach(function(b) { b.style.background = '#4f7eff'; });
            btn.style.background = '#f2c94c';

            if (bridge && typeof bridge.start_coordinate_capture === 'function') {
                bridge.start_coordinate_capture(target);
                var statusEl = document.getElementById('atCaptureStatus');
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.textContent = '⏳ 捕获模式已启动，请将鼠标移到目标位置并按 Ctrl+左键（30秒超时）';
                }
                var cancelBtn = document.getElementById('atCancelCaptureBtn');
                if (cancelBtn) cancelBtn.style.display = 'inline-block';
            }
        });
    });

    // 取消捕获按钮
    var cancelCaptureBtn = document.getElementById('atCancelCaptureBtn');
    if (cancelCaptureBtn) {
        cancelCaptureBtn.addEventListener('click', function() {
            if (bridge && typeof bridge.cancel_coordinate_capture === 'function') {
                bridge.cancel_coordinate_capture();
            }
            cancelCaptureBtn.style.display = 'none';
        });
    }

    // 刷新下单日志
    var refreshLogsBtn = document.getElementById('atRefreshLogsBtn');
    if (refreshLogsBtn) {
        refreshLogsBtn.addEventListener('click', fetchAutoTradeLogs);
    }
}

function loadAutoTradeConfig() {
    if (!bridge || typeof bridge.get_auto_trade_config !== 'function') return;
    bridge.get_auto_trade_config().then(function(jsonStr) {
        try {
            var data = JSON.parse(jsonStr);
            if (!data.success || !data.config) return;
            var cfg = data.config;

            // 模式
            var mode = cfg.mode || 'pyautogui';
            _setAtModeUI(mode, mode === 'pyautogui' ? 'pyautogui（模拟操作）' : 'easytrader（API下单）');
            _toggleModePanels(mode);

            // 风控
            var risk = cfg.risk || {};
            var maxAmt = document.getElementById('atMaxAmount');
            var maxVol = document.getElementById('atMaxVolume');
            var tradingHours = document.getElementById('atTradingHoursOnly');
            if (maxAmt) maxAmt.value = risk.max_amount_per_order || 50000;
            if (maxVol) maxVol.value = risk.max_volume_per_order || 10000;
            if (tradingHours) tradingHours.checked = risk.trading_hours_only !== false;

            // pyautogui
            var pg = cfg.pyautogui || {};
            var pgTitle = document.getElementById('atPgWindowTitle');
            var pgCodeX = document.getElementById('atPgCodeX');
            var pgCodeY = document.getElementById('atPgCodeY');
            var pgPriceX = document.getElementById('atPgPriceX');
            var pgPriceY = document.getElementById('atPgPriceY');
            var pgVolX = document.getElementById('atPgVolX');
            var pgVolY = document.getElementById('atPgVolY');
            var pgUseImage = document.getElementById('atPgUseImage');
            var pgConf = document.getElementById('atPgConfidence');
            var buyBtnX = document.getElementById('atBuyBtnX');
            var buyBtnY = document.getElementById('atBuyBtnY');
            var sellBtnX = document.getElementById('atSellBtnX');
            var sellBtnY = document.getElementById('atSellBtnY');
            var confirmYesX = document.getElementById('atConfirmYesX');
            var confirmYesY = document.getElementById('atConfirmYesY');
            var confirmNoX = document.getElementById('atConfirmNoX');
            var confirmNoY = document.getElementById('atConfirmNoY');
            var errorOkX = document.getElementById('atErrorOkX');
            var errorOkY = document.getElementById('atErrorOkY');
            if (pgTitle) pgTitle.value = pg.window_title || '网上股票交易系统5.0';
            if (pgCodeX) pgCodeX.value = (pg.code_input_pos || [300,500])[0];
            if (pgCodeY) pgCodeY.value = (pg.code_input_pos || [300,500])[1];
            if (pgPriceX) pgPriceX.value = (pg.price_input_pos || [400,530])[0];
            if (pgPriceY) pgPriceY.value = (pg.price_input_pos || [400,530])[1];
            if (pgVolX) pgVolX.value = (pg.volume_input_pos || [500,560])[0];
            if (pgVolY) pgVolY.value = (pg.volume_input_pos || [500,560])[1];
            if (buyBtnX) buyBtnX.value = (pg.buy_button_pos || [524,531])[0];
            if (buyBtnY) buyBtnY.value = (pg.buy_button_pos || [524,531])[1];
            if (sellBtnX) sellBtnX.value = (pg.sell_button_pos || [541,528])[0];
            if (sellBtnY) sellBtnY.value = (pg.sell_button_pos || [541,528])[1];
            if (confirmYesX) confirmYesX.value = (pg.confirm_yes_pos || [1044,739])[0];
            if (confirmYesY) confirmYesY.value = (pg.confirm_yes_pos || [1044,739])[1];
            if (confirmNoX) confirmNoX.value = (pg.confirm_no_pos || [1196,745])[0];
            if (confirmNoY) confirmNoY.value = (pg.confirm_no_pos || [1196,745])[1];
            if (errorOkX) errorOkX.value = (pg.error_ok_pos || [0,0])[0];
            if (errorOkY) errorOkY.value = (pg.error_ok_pos || [0,0])[1];
            if (pgUseImage) pgUseImage.checked = pg.use_image_recognition !== false;
            if (pgConf) pgConf.value = pg.confidence || 0.8;

            // easytrader
            var et = cfg.easytrader || {};
            var brokerVal = et.broker || 'ht_client';
            var brokerLabelMap = { ht_client: '华泰证券', gj_client: '国金证券', yh_client: '银河证券', xueqiu: '雪球' };
            _setAtBrokerUI(brokerVal, brokerLabelMap[brokerVal] || brokerVal);
            var etCfgPath = document.getElementById('atEtConfigPath');
            if (etCfgPath) etCfgPath.value = et.config_path || 'ht.json';
        } catch (e) { /* ignore */ }
    }).catch(function() { /* ignore */ });
}

function fetchAutoTradeLogs() {
    if (!bridge || typeof bridge.get_auto_trade_logs !== 'function') return;
    bridge.get_auto_trade_logs().then(function(jsonStr) {
        try {
            var data = JSON.parse(jsonStr);
            var tbody = document.getElementById('atLogTbody');
            if (!tbody) return;
            if (!data.success || !data.logs || data.logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9aa9cc;">无下单记录</td></tr>';
                return;
            }
            tbody.innerHTML = data.logs.map(function(r) {
                var statusColor = r.status === 'success' ? '#27ae60' : (r.status === 'failed' ? '#e74c3c' : '#f2c94c');
                var statusText = r.status === 'success' ? '成功' : (r.status === 'failed' ? '失败' : r.status);
                return '<tr>' +
                    '<td>' + (r.timestamp || '--') + '</td>' +
                    '<td>' + (r.stock_code || '--') + '</td>' +
                    '<td style="color:' + (r.action === 'buy' ? '#ef5350' : '#26a69a') + ';">' + (r.action === 'buy' ? '买入' : '卖出') + '</td>' +
                    '<td>' + (r.price != null ? r.price.toFixed(2) : '--') + '</td>' +
                    '<td>' + (r.volume || 0) + '</td>' +
                    '<td style="color:' + statusColor + ';">' + statusText + '</td>' +
                    '<td style="color:#9aa9cc;">' + (r.message || '') + '</td>' +
                    '</tr>';
            }).join('');
        } catch (e) { /* ignore */ }
    }).catch(function() { /* ignore */ });
}

function loadIdleSettings() {
    var toggle = document.getElementById('idleUpdateToggle');
    var daysInput = document.getElementById('idleUpdateDays');
    if (toggle) {
        var v = localStorage.getItem('idle_update_enabled');
        toggle.checked = v !== '0';
    }
    if (daysInput) {
        var d = localStorage.getItem('idle_update_days') || '3';
        var opt = idleDaysOptions.find(function(o) { return o.value === d; });
        daysInput.value = opt ? opt.label : '3 天';
        daysInput.setAttribute('data-value', d);
    }
}

function loadUpdateOptionsUI() {
    if (!bridge || typeof bridge.get_data_source_config !== 'function') {
        // 降级：使用 localStorage 缓存
        var saved = localStorage.getItem('tquant_update_options');
        if (saved) {
            try {
                var opts = JSON.parse(saved);
                var klineCb = document.getElementById('optUpdateKline');
                var turnoverCb = document.getElementById('optUpdateTurnover');
                var daysInput = document.getElementById('optMaxDaysBack');
                if (klineCb) klineCb.checked = opts.update_kline !== false;
                if (turnoverCb) turnoverCb.checked = opts.update_turnover === true;
                if (daysInput) daysInput.value = opts.max_days_back || 0;
            } catch (e) {}
        }
        return;
    }

    bridge.get_data_source_config().then(function(jsonStr) {
        try {
            var cfg = JSON.parse(jsonStr);
            if (!cfg.success || !cfg.update_options) return;
            var opts = cfg.update_options;
            var klineCb = document.getElementById('optUpdateKline');
            var turnoverCb = document.getElementById('optUpdateTurnover');
            var daysInput = document.getElementById('optMaxDaysBack');
            if (klineCb) klineCb.checked = opts.update_kline !== false;
            if (turnoverCb) turnoverCb.checked = opts.update_turnover === true;
            if (daysInput) daysInput.value = opts.max_days_back || 0;
            localStorage.setItem('tquant_update_options', JSON.stringify(opts));
        } catch (e) {}
    }).catch(function() {});
}

function updateConfigSummary() {
    var summary = document.getElementById('dsConfigSummary');
    if (!summary) return;
    if (!bridge || typeof bridge.get_data_source_config !== 'function') {
        summary.innerHTML = '<span style="color:#e74c3c;">Bridge 未连接，无法读取配置</span>';
        return;
    }
    bridge.get_data_source_config().then(function(jsonStr) {
        try {
            var cfg = JSON.parse(jsonStr);
            if (!cfg.success) { summary.innerHTML = '<span style="color:#e74c3c;">读取配置失败</span>'; return; }
            var sourceName = cfg.data_source === 'tushare' ? 'Tushare' : 'Baostock（免费）';
            var tokenInfo = cfg.data_source === 'tushare'
                ? ' | Token: ' + (cfg.tushare_token ? cfg.tushare_token.substring(0, 8) + '...' : '未设置')
                : '';
            summary.innerHTML = '当前数据源: <span style="color:#4f7eff;font-weight:600;">' + sourceName + '</span>' + tokenInfo;
        } catch (e) { summary.innerHTML = '<span style="color:#e74c3c;">解析配置失败</span>'; }
    }).catch(function() { summary.innerHTML = '<span style="color:#e74c3c;">读取配置失败</span>'; });
}
