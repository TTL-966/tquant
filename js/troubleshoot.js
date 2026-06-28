// js/troubleshoot.js
// 异常处理页面：展示常见策略编写错误及解决方案

export function renderTroubleshootPage(container) {
    container.innerHTML = `
        <div class="card">
            <div class="card-title">🩺 异常处理 — 常见错误与解决方案</div>
            <p style="color:#9aa9cc; margin-bottom:16px;">编写策略代码时可能遇到的常见错误及修复方法。所有错误信息均可在前端回测日志区域查看。</p>

            <div style="background:#151c2c;border:1px solid #242a40;border-radius:12px;padding:16px;margin-bottom:16px;">
                <h4 style="color:#ff6b6b;margin-bottom:8px;">1. KeyError: '000001'</h4>
                <p style="color:#9aa9cc;font-size:13px;margin-bottom:4px;"><strong style="color:#f2c94c;">原因：</strong>把 bar_dict 当作对象访问，写成了 <code style="color:#4f7eff;">bar_dict[stock].close</code> 或 <code style="color:#4f7eff;">bar_dict[stock]['close']</code>。</p>
                <p style="color:#9aa9cc;font-size:13px;margin-bottom:8px;"><strong style="color:#4cff4c;">方案：</strong>bar_dict 是当前K线数据的字典，直接用字段名访问，无需通过股票代码索引。</p>
                <div class="code-area" style="margin-bottom:4px;"># 错误写法
current_price = bar_dict[stock].close    # KeyError!
current_vol = bar_dict[stock]['volume']  # KeyError!

# 正确写法
current_price = bar_dict.get('close', 0)
current_open = bar_dict['open']
current_vol = bar_dict.get('volume', 0)</div>
            </div>

            <div style="background:#151c2c;border:1px solid #242a40;border-radius:12px;padding:16px;margin-bottom:16px;">
                <h4 style="color:#ff6b6b;margin-bottom:8px;">2. AttributeError: 'types.SimpleNamespace' object has no attribute 'stock'</h4>
                <p style="color:#9aa9cc;font-size:13px;margin-bottom:4px;"><strong style="color:#f2c94c;">原因：</strong>在 <code style="color:#4f7eff;">initialize</code> 中没有设置 <code style="color:#4f7eff;">context.stock</code>，但 <code style="color:#4f7eff;">handle_bar</code> 中直接使用了 <code style="color:#4f7eff;">context.stock</code>。</p>
                <p style="color:#9aa9cc;font-size:13px;margin-bottom:8px;"><strong style="color:#4cff4c;">方案：</strong>在 <code style="color:#4f7eff;">initialize</code> 中声明，或直接在 <code style="color:#4f7eff;">handle_bar</code> 中使用占位符（编辑器会自动替换）。</p>
                <div class="code-area" style="margin-bottom:4px;"># 方案一：在 initialize 中设置
def initialize(context):
    context.stock = "STOCK_CODE_PLACEHOLDER"

# 方案二：直接在 handle_bar 中定义（推荐）
def handle_bar(context, bar_dict):
    stock = "STOCK_CODE_PLACEHOLDER"  # 编辑器自动替换</div>
            </div>

            <div style="background:#151c2c;border:1px solid #242a40;border-radius:12px;padding:16px;margin-bottom:16px;">
                <h4 style="color:#ff6b6b;margin-bottom:8px;">3. 'dict' object has no attribute 'positions'</h4>
                <p style="color:#9aa9cc;font-size:13px;margin-bottom:4px;"><strong style="color:#f2c94c;">原因：</strong>把 <code style="color:#4f7eff;">context.portfolio</code> 当作对象访问，使用了 <code style="color:#4f7eff;">.positions</code> 属性。引擎中 portfolio 是一个普通字典，不是对象。</p>
                <p style="color:#9aa9cc;font-size:13px;margin-bottom:8px;"><strong style="color:#4cff4c;">方案：</strong>使用字典方法 <code style="color:#4f7eff;">.get()</code> 获取持仓信息。</p>
                <div class="code-area" style="margin-bottom:4px;"># 错误写法
pos = context.portfolio.positions      # AttributeError!
current = context.portfolio.positions[stock].amount  # AttributeError!

# 正确写法
holdings = context.portfolio.get('holdings', {})
current_position = holdings.get(stock, 0)

# 检查是否持仓
if current_position > 0:
    log.info("当前持仓 " + str(current_position) + " 股")</div>
            </div>

            <div style="background:#151c2c;border:1px solid #242a40;border-radius:12px;padding:16px;margin-bottom:16px;">
                <h4 style="color:#ff6b6b;margin-bottom:8px;">4. 回测信号为 0 / 没有产生任何交易</h4>
                <p style="color:#9aa9cc;font-size:13px;margin-bottom:4px;"><strong style="color:#f2c94c;">常见原因：</strong></p>
                <ul style="color:#9aa9cc;font-size:13px;padding-left:20px;margin:4px 0 8px 0;">
                    <li>策略条件过于严格（如阈值设置过高），导致买卖条件从未满足。</li>
                    <li><code style="color:#4f7eff;">history_bars</code> 获取的数据长度不足，提前 <code style="color:#4f7eff;">return</code> 退出了。</li>
                    <li>策略代码中存在异常，被后端捕获但未产生信号。</li>
                    <li>回测区间内股票停牌或数据缺失。</li>
                </ul>
                <p style="color:#9aa9cc;font-size:13px;margin-bottom:4px;"><strong style="color:#4cff4c;">排查方案：</strong></p>
                <ul style="color:#9aa9cc;font-size:13px;padding-left:20px;margin:4px 0;">
                    <li>查看前端回测日志区域，关注 <code style="color:#4f7eff;">[ERROR]</code> 和 <code style="color:#4f7eff;">[WARN]</code> 标记的后端日志。</li>
                    <li>在策略中加入调试日志：<code style="color:#4f7eff;">log.info("当前价格: " + str(bar_dict['close']))</code>。</li>
                    <li>放宽指标阈值（如均线周期、RSI 超买超卖线），增加交易机会。</li>
                    <li>确保 <code style="color:#4f7eff;">history_bars</code> 获取了足够的历史数据（建议至少 30 根日K线）。</li>
                    <li>先用"双均线模板"在 000001 上测试，确认回测引擎正常运行。</li>
                </ul>
            </div>

            <div style="background:#151c2c;border:1px solid #242a40;border-radius:12px;padding:16px;margin-bottom:16px;">
                <h4 style="color:#ff6b6b;margin-bottom:8px;">6. 'Logger' object has no attribute 'debug'</h4>
                <p style="color:#9aa9cc;font-size:13px;margin-bottom:4px;"><strong style="color:#f2c94c;">原因：</strong>策略中使用了 <code style="color:#4f7eff;">log.debug()</code> 输出调试信息，但旧版 Logger 类未定义 debug 方法。</p>
                <p style="color:#9aa9cc;font-size:13px;margin-bottom:8px;"><strong style="color:#4cff4c;">方案：</strong></p>
                <ul style="color:#9aa9cc;font-size:13px;padding-left:20px;margin:4px 0 8px 0;">
                    <li><strong>临时方法（无需重启）：</strong>将 <code style="color:#4f7eff;">log.debug(...)</code> 改为 <code style="color:#4f7eff;">log.info(...)</code>。</li>
                    <li><strong>永久方案（推荐）：</strong>系统已在后端新增 <code style="color:#4f7eff;">log.debug()</code> 和 <code style="color:#4f7eff;">log.warn()</code> 方法，重启 Tquant 应用后可直接安全使用，无需替换为 log.info。</li>
                </ul>
                <div class="code-area" style="margin-bottom:4px;"># 临时修复（无需重启 Tquant）
log.info(f"观望 | 价格:{current_close:.2f}")

# 永久修复（需重启 Tquant 应用后生效）
log.debug(f"观望 | 价格:{current_close:.2f} ATR:{current_atr:.2f}")
log.warn(f"资金不足 | 需要:{cost:.2f} 现金:{cash:.2f}")</div>
            </div>

            <div class="card-title" style="margin-top:24px;">📋 通用调试流程</div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;">
                <div style="flex:1;min-width:200px;background:#151c2c;border:1px solid #242a40;border-radius:12px;padding:16px;text-align:center;">
                    <div style="font-size:28px;margin-bottom:8px;">🔍</div>
                    <h4 style="color:#4f7eff;margin-bottom:6px;">阅读日志</h4>
                    <p style="color:#9aa9cc;font-size:13px;">查看回测日志区域，找到第一条报错信息，确定错误类型和发生位置。</p>
                </div>
                <div style="flex:1;min-width:200px;background:#151c2c;border:1px solid #242a40;border-radius:12px;padding:16px;text-align:center;">
                    <div style="font-size:28px;margin-bottom:8px;">🩺</div>
                    <h4 style="color:#4f7eff;margin-bottom:6px;">对照错误表</h4>
                    <p style="color:#9aa9cc;font-size:13px;">在"异常处理"页面中找到对应的错误关键字，按照解决方案修改代码。</p>
                </div>
                <div style="flex:1;min-width:200px;background:#151c2c;border:1px solid #242a40;border-radius:12px;padding:16px;text-align:center;">
                    <div style="font-size:28px;margin-bottom:8px;">🚀</div>
                    <h4 style="color:#4f7eff;margin-bottom:6px;">逐步测试</h4>
                    <p style="color:#9aa9cc;font-size:13px;">每次只修改一处，重新运行回测验证，避免引入新错误。</p>
                </div>
            </div>
        </div>`;
}
