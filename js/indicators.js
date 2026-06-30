// stub: simplified public version — full implementation is local only
// ponytail: only EMA/SMA/MACD kept; full version has RSI/KDJ/Bollinger/CCI/OBV/etc.

function ema(data, period) {
    const k = 2 / (period + 1);
    const result = new Array(data.length).fill(null);
    if (data.length === 0) return result;
    let prev = data[0];
    result[0] = prev;
    for (let i = 1; i < data.length; i++) {
        const cur = data[i] * k + prev * (1 - k);
        result[i] = cur;
        prev = cur;
    }
    return result;
}

function sma(data, period) {
    const result = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j];
        result[i] = parseFloat((sum / period).toFixed(2));
    }
    return result;
}

export function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
    const n = closes.length;
    const dif = new Array(n).fill(null);
    const dea = new Array(n).fill(null);
    const histogram = new Array(n).fill(null);
    if (n < slow) return { dif, dea, histogram };
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);
    for (let i = 0; i < n; i++) {
        if (emaFast[i] !== null && emaSlow[i] !== null) {
            dif[i] = parseFloat((emaFast[i] - emaSlow[i]).toFixed(4));
        }
    }
    let difStart = 0;
    while (difStart < n && dif[difStart] === null) difStart++;
    if (difStart < n) {
        const difSlice = dif.slice(difStart);
        const deaSlice = ema(difSlice, signal);
        for (let j = 0; j < deaSlice.length; j++) {
            dea[difStart + j] = parseFloat(deaSlice[j].toFixed(4));
        }
        for (let i = difStart + signal - 1; i < n; i++) {
            if (dif[i] !== null && dea[i] !== null) {
                histogram[i] = parseFloat(((dif[i] - dea[i]) * 2).toFixed(4));
            }
        }
    }
    return { dif, dea, histogram };
}

// Stub: other indicators return empty arrays. Full version has RSI, KDJ, Bollinger, etc.
export function calculateRSI(closes, period = 14) {
    return new Array(closes.length).fill(null);
}

export function calculateKDJ(highs, lows, closes, n = 9, m1 = 3, m2 = 3) {
    const nLen = closes.length;
    return { k: new Array(nLen).fill(null), d: new Array(nLen).fill(null), j: new Array(nLen).fill(null) };
}

export function calculateBollinger(closes, period = 20, multiplier = 2) {
    const n = closes.length;
    return { upper: new Array(n).fill(null), middle: new Array(n).fill(null), lower: new Array(n).fill(null) };
}

export function calculateCCI(highs, lows, closes, period = 14) {
    return new Array(closes.length).fill(null);
}

export function calculateOBV(closes, volumes) {
    return new Array(closes.length).fill(null);
}

export function calculateROC(closes, period = 12) {
    return new Array(closes.length).fill(null);
}

export function calculateWR(highs, lows, closes, period = 14) {
    return new Array(closes.length).fill(null);
}

export function calculatePSY(closes, period = 12) {
    return new Array(closes.length).fill(null);
}

export function calculateATR(highs, lows, closes, period = 14) {
    return new Array(closes.length).fill(null);
}
