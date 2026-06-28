// js/indicators.js
// 纯函数指标计算库 — 无外部依赖，所有计算在前端完成

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
            const idx = difStart + j;
            dea[idx] = parseFloat(deaSlice[j].toFixed(4));
            if (dif[idx] !== null && dea[idx] !== null) {
                histogram[idx] = parseFloat(((dif[idx] - dea[idx]) * 2).toFixed(4));
            }
        }
    }

    return { dif, dea, histogram };
}

export function calculateRSI(closes, period = 14) {
    const n = closes.length;
    const rsi = new Array(n).fill(null);
    if (n < period + 1) return rsi;

    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) avgGain += diff;
        else avgLoss += -diff;
    }
    avgGain /= period;
    avgLoss /= period;
    rsi[period] = avgLoss === 0 ? 100 : parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));

    for (let i = period + 1; i < n; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rsi[i] = avgLoss === 0 ? 100 : parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
    }
    return rsi;
}

export function calculateKDJ(highs, lows, closes, n = 9, m1 = 3, m2 = 3) {
    const len = closes.length;
    const k = new Array(len).fill(null);
    const d = new Array(len).fill(null);
    const j = new Array(len).fill(null);
    if (len < n) return { k, d, j };

    const alphaK = 1 / m1;
    const alphaD = 1 / m2;
    let prevK = 50, prevD = 50;

    for (let i = n - 1; i < len; i++) {
        let highN = -Infinity, lowN = Infinity;
        for (let t = i - n + 1; t <= i; t++) {
            if (highs[t] > highN) highN = highs[t];
            if (lows[t] < lowN) lowN = lows[t];
        }
        const range = highN - lowN;
        const rsv = range === 0 ? 50 : ((closes[i] - lowN) / range) * 100;
        const curK = prevK + alphaK * (rsv - prevK);
        const curD = prevD + alphaD * (curK - prevD);
        const curJ = 3 * curK - 2 * curD;
        k[i] = parseFloat(curK.toFixed(2));
        d[i] = parseFloat(curD.toFixed(2));
        j[i] = parseFloat(curJ.toFixed(2));
        prevK = curK;
        prevD = curD;
    }
    return { k, d, j };
}

export function calculateBollinger(closes, period = 20, stdDev = 2) {
    const n = closes.length;
    const upper = new Array(n).fill(null);
    const middle = new Array(n).fill(null);
    const lower = new Array(n).fill(null);
    if (n < period) return { upper, middle, lower };

    for (let i = period - 1; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += closes[i - j];
        const ma = sum / period;
        middle[i] = parseFloat(ma.toFixed(2));

        let variance = 0;
        for (let j = 0; j < period; j++) {
            variance += (closes[i - j] - ma) ** 2;
        }
        const std = Math.sqrt(variance / (period - 1));
        upper[i] = parseFloat((ma + stdDev * std).toFixed(2));
        lower[i] = parseFloat((ma - stdDev * std).toFixed(2));
    }

    return { upper, middle, lower };
}

export function calculateATRChannel(highs, lows, closes, period = 14, multiplier = 2) {
    const n = closes.length;
    const upper = new Array(n).fill(null);
    const middle = new Array(n).fill(null);
    const lower = new Array(n).fill(null);
    if (n < period + 1) return { upper, middle, lower };

    // 计算 TR（True Range）
    const tr = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        const h = highs[i], l = lows[i];
        const prevClose = i > 0 ? closes[i - 1] : closes[0];
        tr[i] = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
    }

    // Wilder 平滑 ATR
    const atr = new Array(n).fill(null);
    let atrSum = 0;
    for (let i = 1; i <= period; i++) atrSum += tr[i];
    atr[period] = atrSum / period;
    for (let i = period + 1; i < n; i++) {
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }

    // SMA 作为中轨
    for (let i = period - 1; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += closes[i - j];
        const ma = sum / period;
        middle[i] = parseFloat(ma.toFixed(2));
    }

    // 上下轨 = 中轨 ± multiplier * ATR（从 period 位置开始，因为 ATR 也从 period 开始有效）
    for (let i = period; i < n; i++) {
        if (atr[i] !== null && middle[i] !== null) {
            upper[i] = parseFloat((middle[i] + multiplier * atr[i]).toFixed(2));
            lower[i] = parseFloat((middle[i] - multiplier * atr[i]).toFixed(2));
        }
    }

    return { upper, middle, lower };
}

export function calculateCCI(highs, lows, closes, period = 20) {
    const n = closes.length;
    const cci = new Array(n).fill(null);
    if (n < period) return cci;

    // 典型价格 TP = (high + low + close) / 3
    const tp = new Array(n);
    for (let i = 0; i < n; i++) {
        tp[i] = (highs[i] + lows[i] + closes[i]) / 3;
    }

    for (let i = period - 1; i < n; i++) {
        // SMA of TP
        let tpSum = 0;
        for (let j = 0; j < period; j++) tpSum += tp[i - j];
        const tpSma = tpSum / period;

        // Mean Deviation
        let mdSum = 0;
        for (let j = 0; j < period; j++) mdSum += Math.abs(tp[i - j] - tpSma);
        const md = mdSum / period;

        if (md === 0) {
            cci[i] = 0;
        } else {
            cci[i] = parseFloat(((tp[i] - tpSma) / (0.015 * md)).toFixed(2));
        }
    }

    return cci;
}

export function calculateWilliamsR(highs, lows, closes, period = 14) {
    const n = closes.length;
    const wr = new Array(n).fill(null);
    if (n < period) return wr;

    for (let i = period - 1; i < n; i++) {
        let highest = -Infinity, lowest = Infinity;
        for (let j = i - period + 1; j <= i; j++) {
            if (highs[j] > highest) highest = highs[j];
            if (lows[j] < lowest) lowest = lows[j];
        }
        const range = highest - lowest;
        if (range === 0) {
            wr[i] = 0;
        } else {
            wr[i] = parseFloat((-100 * (highest - closes[i]) / range).toFixed(2));
        }
    }

    return wr;
}

export function calculateOBV(closes, volumes, maPeriod = 20) {
    const n = closes.length;
    const obv = new Array(n).fill(null);
    const ma = new Array(n).fill(null);

    if (n === 0) return { obv, ma };

    obv[0] = volumes[0];
    for (let i = 1; i < n; i++) {
        if (closes[i] > closes[i - 1]) {
            obv[i] = obv[i - 1] + volumes[i];
        } else if (closes[i] < closes[i - 1]) {
            obv[i] = obv[i - 1] - volumes[i];
        } else {
            obv[i] = obv[i - 1];
        }
    }

    for (let i = maPeriod - 1; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < maPeriod; j++) sum += obv[i - j];
        ma[i] = parseFloat((sum / maPeriod).toFixed(2));
    }

    return { obv, ma };
}

export function calculateROC(closes, period = 12) {
    const n = closes.length;
    const roc = new Array(n).fill(null);
    for (let i = period; i < n; i++) {
        roc[i] = parseFloat(((closes[i] - closes[i - period]) / closes[i - period] * 100).toFixed(2));
    }
    return roc;
}

export function calculateSAR(highs, lows, acceleration = 0.02, maxAcceleration = 0.2) {
    const n = highs.length;
    const sar = new Array(n).fill(null);
    if (n === 0) return sar;

    let up = true;
    let ep = highs[0];
    let af = acceleration;
    let sarVal = lows[0];
    sar[0] = sarVal;

    for (let i = 1; i < n; i++) {
        if (up) {
            sarVal = sarVal + af * (ep - sarVal);
            if (i >= 1) sarVal = Math.min(sarVal, lows[i - 1]);
            if (i >= 2) sarVal = Math.min(sarVal, lows[i - 2]);
        } else {
            sarVal = sarVal + af * (ep - sarVal);
            if (i >= 1) sarVal = Math.max(sarVal, highs[i - 1]);
            if (i >= 2) sarVal = Math.max(sarVal, highs[i - 2]);
        }

        sar[i] = parseFloat(sarVal.toFixed(2));

        if (up) {
            if (highs[i] > ep) {
                ep = highs[i];
                af = Math.min(af + acceleration, maxAcceleration);
            }
            if (lows[i] < sarVal) {
                up = false;
                sarVal = ep;
                ep = lows[i];
                af = acceleration;
            }
        } else {
            if (lows[i] < ep) {
                ep = lows[i];
                af = Math.min(af + acceleration, maxAcceleration);
            }
            if (highs[i] > sarVal) {
                up = true;
                sarVal = ep;
                ep = highs[i];
                af = acceleration;
            }
        }
    }

    return sar;
}

export function calculateMean(closes, period) {
    return sma(closes, period);
}

export function calculateMedian(closes, period) {
    const n = closes.length;
    const result = new Array(n).fill(null);
    if (n < period) return result;

    const window = new Array(period);
    for (let i = period - 1; i < n; i++) {
        for (let j = 0; j < period; j++) {
            window[j] = closes[i - j];
        }
        window.sort((a, b) => a - b);
        const mid = Math.floor(period / 2);
        result[i] = period % 2 === 1
            ? parseFloat(window[mid].toFixed(2))
            : parseFloat(((window[mid - 1] + window[mid]) / 2).toFixed(2));
    }
    return result;
}

export function calculateVWAP(highs, lows, closes, volumes, period) {
    const n = closes.length;
    const result = new Array(n).fill(null);
    if (n < period) return result;

    for (let i = period - 1; i < n; i++) {
        let sumTPV = 0;
        let sumV = 0;
        for (let j = 0; j < period; j++) {
            const idx = i - j;
            const tp = (highs[idx] + lows[idx] + closes[idx]) / 3;
            const vol = volumes[idx] || 0;
            sumTPV += tp * vol;
            sumV += vol;
        }
        result[i] = sumV === 0 ? 0 : parseFloat((sumTPV / sumV).toFixed(2));
    }
    return result;
}

/**
 * 线性加权移动平均（权重从1到period线性递增，最后一天权重最高）
 * @param {number[]} data - 原始数据数组
 * @param {number} period - 周期，默认21
 * @returns {number[]} 加权平均值，前 period-1 个元素为 null
 */
export function weightedSMA(data, period = 21) {
    const result = new Array(data.length).fill(null);
    const weightSum = (period * (period + 1)) / 2;
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j] * (period - j);
        }
        result[i] = parseFloat((sum / weightSum).toFixed(2));
    }
    return result;
}

/**
 * 短底信号：基于168日低点和21日高点的归一化EMA交叉
 * @param {number[]} highs - 最高价数组
 * @param {number[]} lows - 最低价数组
 * @param {number[]} closes - 收盘价数组
 * @returns {boolean[]} 信号数组，true表示当日出现短底信号
 */
export function shortBottomSignal(highs, lows, closes) {
    const n = closes.length;
    const signal = new Array(n).fill(false);
    if (n < 168) return signal;

    const lowest168 = new Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) {
        let min = Infinity;
        for (let j = Math.max(0, i - 167); j <= i; j++) {
            if (lows[j] < min) min = lows[j];
        }
        lowest168[i] = min;
    }

    const highest21 = new Array(n).fill(-Infinity);
    for (let i = 0; i < n; i++) {
        let max = -Infinity;
        for (let j = Math.max(0, i - 20); j <= i; j++) {
            if (highs[j] > max) max = highs[j];
        }
        highest21[i] = max;
    }

    const r = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        const denom = highest21[i] - lowest168[i];
        r[i] = denom > 0 ? ((closes[i] - lowest168[i]) / denom) * 100 : 50;
    }

    const ema5 = ema(r, 5);
    const rHalf = r.map(v => v * 0.5);
    const ema13 = ema(rHalf, 13);

    for (let i = 1; i < n; i++) {
        if (ema5[i] !== null && ema13[i] !== null && ema5[i - 1] !== null && ema13[i - 1] !== null) {
            signal[i] = (ema5[i - 1] <= ema13[i - 1] && ema5[i] > ema13[i]);
        }
    }
    return signal;
}

/**
 * 20日最高价和20日最低价（压力/支撑）
 * @param {number[]} highs - 最高价数组
 * @param {number[]} lows - 最低价数组
 * @returns {{ high20: number[], low20: number[] }}
 */
export function calcSupportResistance(highs, lows) {
    const n = highs.length;
    const high20 = new Array(n).fill(null);
    const low20 = new Array(n).fill(null);
    for (let i = 19; i < n; i++) {
        let maxH = -Infinity, minL = Infinity;
        for (let j = 0; j < 20; j++) {
            if (highs[i - j] > maxH) maxH = highs[i - j];
            if (lows[i - j] < minL) minL = lows[i - j];
        }
        high20[i] = parseFloat(maxH.toFixed(2));
        low20[i] = parseFloat(minL.toFixed(2));
    }
    return { high20, low20 };
}

/**
 * 金手指信号：MA20 上穿 MA120
 * @param {number[]} closes - 收盘价数组
 * @returns {boolean[]} 信号数组
 */
export function calcGoldenFinger(closes) {
    const n = closes.length;
    const ma20 = sma(closes, 20);
    const ma120 = sma(closes, 120);
    const signal = new Array(n).fill(false);
    for (let i = 1; i < n; i++) {
        if (ma20[i] !== null && ma20[i - 1] !== null && ma120[i] !== null && ma120[i - 1] !== null) {
            signal[i] = (ma20[i - 1] <= ma120[i - 1] && ma20[i] > ma120[i]);
        }
    }
    return signal;
}

/**
 * 计算 Supertrend（超级趋势）
 * @param {number[]} highs - 最高价数组
 * @param {number[]} lows - 最低价数组
 * @param {number[]} closes - 收盘价数组
 * @param {number} period - ATR 周期，默认 10
 * @param {number} multiplier - 通道倍数，默认 3
 * @returns {{ trend: number[], upper: number[], lower: number[], signal: boolean[] }}
 */
export function calculateSupertrend(highs, lows, closes, period = 10, multiplier = 3) {
    const n = closes.length;
    const trend = new Array(n).fill(null);
    const trendLine = new Array(n).fill(null);
    const signal = new Array(n).fill(false);
    if (n < period + 1) return { trend, trendLine, signal };

    // Wilder smoothed ATR
    const tr = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        const prevClose = i > 0 ? closes[i - 1] : closes[0];
        tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - prevClose), Math.abs(lows[i] - prevClose));
    }
    const atr = new Array(n).fill(null);
    let atrSum = 0;
    for (let i = 1; i <= period; i++) atrSum += tr[i];
    atr[period] = atrSum / period;
    for (let i = period + 1; i < n; i++) {
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }

    // Basic bands
    const src = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
    const basicUpper = src.map((s, i) => atr[i] !== null ? parseFloat((s + multiplier * atr[i]).toFixed(2)) : s);
    const basicLower = src.map((s, i) => atr[i] !== null ? parseFloat((s - multiplier * atr[i]).toFixed(2)) : s);

    // Determine initial trend
    let currTrend = null;
    let startIdx = period;
    for (let i = period; i < n; i++) {
        if (closes[i] > basicUpper[i]) {
            currTrend = 1;
            startIdx = i;
            break;
        } else if (closes[i] < basicLower[i]) {
            currTrend = -1;
            startIdx = i;
            break;
        }
    }
    if (currTrend === null) {
        currTrend = 1;
    }
    trend[startIdx] = currTrend;
    trendLine[startIdx] = currTrend === 1 ? basicLower[startIdx] : basicUpper[startIdx];

    // Trend tracking with single trendLine
    for (let i = startIdx + 1; i < n; i++) {
        if (currTrend === 1) {
            if (closes[i] > trendLine[i - 1]) {
                trend[i] = 1;
                trendLine[i] = Math.max(basicLower[i], trendLine[i - 1]);
            } else {
                currTrend = -1;
                trend[i] = -1;
                signal[i] = true;
                trendLine[i] = basicUpper[i];
            }
        } else {
            if (closes[i] < trendLine[i - 1]) {
                trend[i] = -1;
                trendLine[i] = Math.min(basicUpper[i], trendLine[i - 1]);
            } else {
                currTrend = 1;
                trend[i] = 1;
                signal[i] = true;
                trendLine[i] = basicLower[i];
            }
        }
    }

    return { trend, trendLine, signal };
}

/**
 * 计算 Chaikin 资金流 (CMF)
 * @param {number[]} highs - 最高价数组
 * @param {number[]} lows - 最低价数组
 * @param {number[]} closes - 收盘价数组
 * @param {number[]} volumes - 成交量数组
 * @param {number} period - 计算周期，默认 20
 * @returns {{ cmf: number[] }}
 */
export function calculateCMF(highs, lows, closes, volumes, period = 20) {
    const n = closes.length;
    const cmf = new Array(n).fill(null);
    if (n < period) return { cmf };

    // 资金流乘数 MFM = ((C-L) - (H-C)) / (H-L)
    const mfm = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        const range = highs[i] - lows[i];
        if (range === 0) {
            mfm[i] = 0;
        } else {
            mfm[i] = ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range;
        }
    }

    // 资金流量 MFV = MFM × volume
    const mfv = mfm.map((m, i) => m * volumes[i]);

    // CMF = Sum(MFV, N) / Sum(Volume, N)
    for (let i = period - 1; i < n; i++) {
        let sumMfv = 0, sumVol = 0;
        for (let j = 0; j < period; j++) {
            sumMfv += mfv[i - j];
            sumVol += volumes[i - j];
        }
        cmf[i] = sumVol === 0 ? 0 : parseFloat((sumMfv / sumVol).toFixed(4));
    }
    return { cmf };
}

/**
 * 计算共振指标（Resonance Indicator）
 * 基于 RSI 超卖、KDJ 金叉、MACD 金叉、均线多头排列的共振评分
 * 每个指标满足条件计 1 分，总分 = 共振分数，signal 表示分数 >= 阈值
 * @param {number[]} highs - 最高价
 * @param {number[]} lows - 最低价
 * @param {number[]} closes - 收盘价
 * @param {object} options - 参数配置
 * @returns {{ score: number[], signal: boolean[] }}
 */
export function calculateResonance(highs, lows, closes, options = {}) {
    const {
        rsiOversold = 30,
        maShort = 5,
        maMid = 10,
        maLong = 20,
        kdjN = 9,
        kdjM1 = 3,
        kdjM2 = 3,
        resonanceThreshold = 3
    } = options;

    const n = closes.length;
    const score = new Array(n).fill(0);
    const signal = new Array(n).fill(false);
    if (n < Math.max(maLong, kdjN, 20) + 10) return { score, signal };

    const macd = calculateMACD(closes);
    const rsi = calculateRSI(closes, 14);
    const kdj = calculateKDJ(highs, lows, closes, kdjN, kdjM1, kdjM2);
    const maShortArr = sma(closes, maShort);
    const maMidArr = sma(closes, maMid);
    const maLongArr = sma(closes, maLong);

    for (let i = Math.max(maLong, kdjN + 2, 20); i < n; i++) {
        let cnt = 0;

        // 1. RSI 超卖
        if (rsi[i] !== null && rsi[i] < rsiOversold) cnt++;

        // 2. KDJ 金叉：K 上穿 D
        if (kdj.k[i] !== null && kdj.d[i] !== null && kdj.k[i - 1] !== null && kdj.d[i - 1] !== null) {
            if (kdj.k[i - 1] <= kdj.d[i - 1] && kdj.k[i] > kdj.d[i]) cnt++;
        }

        // 3. MACD 金叉：DIF 上穿 DEA
        if (macd.dif[i] !== null && macd.dea[i] !== null && macd.dif[i - 1] !== null && macd.dea[i - 1] !== null) {
            if (macd.dif[i - 1] <= macd.dea[i - 1] && macd.dif[i] > macd.dea[i]) cnt++;
        }

        // 4. 均线多头排列（短 > 中 > 长）
        if (maShortArr[i] !== null && maMidArr[i] !== null && maLongArr[i] !== null) {
            if (maShortArr[i] > maMidArr[i] && maMidArr[i] > maLongArr[i]) cnt++;
        }

        score[i] = cnt;
        signal[i] = cnt >= resonanceThreshold;
    }

    return { score, signal };
}

/**
 * 七脉神剑 (Seven Swords) — 7个技术指标的多空方向综合评估
 * 每个指标输出方向：+1(多头/买入), -1(空头/卖出), 0(中性)
 *
 * 指标定义：
 *   量能(VOL):  MA(VOL,5) > MA(VOL,10) → +1
 *   CCI:        CCI(14) < -100(超卖→+1), CCI > +100(超买→-1), 中间=0
 *   MACD:       DIF > DEA(金叉/多头) → +1
 *   SAR:        CLOSE > SAR(上升趋势) → +1
 *   RSI:        RSI(6) < 30(超卖→+1), RSI > 70(超买→-1), 中间=0
 *   KDJ:        K(3) > D(3)(多头) → +1
 *   动能(CJDX): J[i] > J[i-1](动能向上) → +1
 *
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number[]} volumes
 * @returns {{ swords: Array<{name:string, signals:number[]}>, total: number[] }}
 */
export function calculateSevenSwords(highs, lows, closes, volumes) {
    const n = closes.length;
    const SWORD_NAMES = ['量能(VOL)', 'CCI', 'MACD', 'SAR', 'RSI', 'KDJ', '动能(CJDX)'];

    const swords = SWORD_NAMES.map(name => ({
        name,
        signals: new Array(n).fill(0)
    }));
    const total = new Array(n).fill(0);

    if (n < 15) return { swords, total };

    // ---- 1. 量能(VOL): MA5 > MA10 ----
    if (volumes && volumes.length >= n) {
        const volMA5 = sma(volumes, 5);
        const volMA10 = sma(volumes, 10);
        for (let i = 10; i < n; i++) {
            if (volMA5[i] !== null && volMA10[i] !== null) {
                swords[0].signals[i] = volMA5[i] > volMA10[i] ? 1 : -1;
            }
        }
    } else {
        // 无量能数据时，使用价格的量价替代：价涨量增视为多头
        const volMA5 = sma(closes, 5);
        const volMA10 = sma(closes, 10);
        for (let i = 10; i < n; i++) {
            if (volMA5[i] !== null && volMA10[i] !== null) {
                swords[0].signals[i] = volMA5[i] > volMA10[i] ? 1 : -1;
            }
        }
    }

    // ---- 2. CCI(14): 超卖(< -100)买入，超买(> +100)卖出 ----
    const cci = calculateCCI(highs, lows, closes, 14);
    for (let i = 14; i < n; i++) {
        if (cci[i] !== null) {
            if (cci[i] < -100) swords[1].signals[i] = 1;
            else if (cci[i] > 100) swords[1].signals[i] = -1;
            else swords[1].signals[i] = 0;
        }
    }

    // ---- 3. MACD(12,26,9): DIF > DEA → 多头 ----
    const macd = calculateMACD(closes, 12, 26, 9);
    for (let i = 26; i < n; i++) {
        if (macd.dif[i] !== null && macd.dea[i] !== null) {
            swords[2].signals[i] = macd.dif[i] > macd.dea[i] ? 1 : -1;
        }
    }

    // ---- 4. SAR(0.02,0.2): CLOSE > SAR → 上升趋势 ----
    const sar = calculateSAR(highs, lows, 0.02, 0.2);
    for (let i = 1; i < n; i++) {
        if (sar[i] !== null) {
            swords[3].signals[i] = closes[i] > sar[i] ? 1 : -1;
        }
    }

    // ---- 5. RSI(6): RSI < 30(超卖→+1), RSI > 70(超买→-1) ----
    const rsi = calculateRSI(closes, 6);
    for (let i = 6; i < n; i++) {
        if (rsi[i] !== null) {
            if (rsi[i] < 30) swords[4].signals[i] = 1;
            else if (rsi[i] > 70) swords[4].signals[i] = -1;
            else swords[4].signals[i] = 0;
        }
    }

    // ---- 6. KDJ(9,3,3): K > D → 多头 ----
    const kdj = calculateKDJ(highs, lows, closes, 9, 3, 3);
    for (let i = 10; i < n; i++) {
        if (kdj.k[i] !== null && kdj.d[i] !== null) {
            swords[5].signals[i] = kdj.k[i] > kdj.d[i] ? 1 : -1;
        }
    }

    // ---- 7. 动能(CJDX): J[i] > J[i-1] → 动能向上 ----
    for (let i = 11; i < n; i++) {
        if (kdj.j[i] !== null && kdj.j[i - 1] !== null) {
            swords[6].signals[i] = kdj.j[i] > kdj.j[i - 1] ? 1 : -1;
        }
    }

    // 计算每日多头总数
    for (let i = 0; i < n; i++) {
        let cnt = 0;
        for (let s = 0; s < 7; s++) {
            if (swords[s].signals[i] === 1) cnt++;
        }
        total[i] = cnt;
    }

    return { swords, total };
}