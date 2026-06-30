// stub: simplified public version — full implementation is local only
// ponytail: keeps renderStrategyPage shell; full version has full card builder UI

import { bridge } from './bridge.js';
import { Logger } from './logger.js';

var strategyLogger = new Logger('Strategy');

export function renderStrategyPage(container) {
    if (!container) return;
    container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #888;">
            <h2>策略工厂</h2>
            <p>公开版仅展示策略框架界面，完整版支持：</p>
            <ul style="list-style: none; padding: 0; line-height: 2;">
                <li>可视化卡片式策略构建</li>
                <li>拖拽组合技术指标 (MA/RSI/MACD/KDJ 等 12+ 指标)</li>
                <li>Optuna TPE 智能超参搜索</li>
                <li>单股/多股组合回测</li>
                <li>策略变体对比</li>
            </ul>
            <p style="margin-top: 20px; font-size: 12px; color: #555;">
                策略配置文件保存在 <code>strategies/</code> 目录
            </p>
        </div>
    `;

    if (bridge && bridge.onStrategyPageReady) {
        bridge.onStrategyPageReady();
    }
}

export function getCurrentStockPool() { return []; }
export function reloadStockPool() {}
