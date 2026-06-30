// stub: simplified public version - keeps renderStrategyPage shell
import { bridge } from './bridge.js';

export function renderStrategyPage(container) {
    if (!container) return;
    container.innerHTML = '<div style="padding:40px;text-align:center;color:#888"><h2>Strategy Factory</h2><p>Public demo version. Full version supports:</p><ul style="list-style:none;padding:0;line-height:2"><li>Visual card-based strategy builder</li><li>12+ technical indicators (MA/RSI/MACD/KDJ/...)</li><li>Optuna TPE hyperparameter search</li><li>Single/multi-stock backtest</li><li>Strategy variant comparison</li></ul></div>';
    if (bridge && bridge.onStrategyPageReady) bridge.onStrategyPageReady();
}

export function getCurrentStockPool() { return []; }
export function reloadStockPool() {}
