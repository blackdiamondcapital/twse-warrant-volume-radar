import { calcSMA, calcDuoKongLine, mapBars } from './indicators'
import { DEFAULT_DUO_KONG_PERIOD } from './chartTheme.js'

/** 對齊主站 StockChartECharts 動態轉折（小不點）預設參數 */
export const DEFAULT_GOLDEN_WAVE_PARAMS = {
  fastMa: 30,
  slowMa: 100,
  fastMa2: 130,
  slowMa2: 140,
  multiMa: 18,
  waveMa2: 18,
  waveMa3: 18,
  boxPeriod: 78,
}

/** 依 K 線根數選擇小不點參數（固定使用主站預設 30 / 100） */
export function resolveGoldenWaveParams(_barCount) {
  return DEFAULT_GOLDEN_WAVE_PARAMS
}

function calcEMA(arr, period) {
  const n = arr.length
  const result = new Array(n).fill(null)
  const k = 2 / (period + 1)
  let ema = null
  for (let i = 0; i < n; i++) {
    const val = Number(arr[i])
    if (!Number.isFinite(val)) continue
    ema = ema == null ? val : val * k + ema * (1 - k)
    result[i] = ema
  }
  return result
}

/** 動態轉折（小不點）／黃金波段 DIF 柱 */
export function calcGoldenWave(closes, params = DEFAULT_GOLDEN_WAVE_PARAMS) {
  const n = closes.length
  const dif = new Array(n).fill(null)
  const difSub = new Array(n).fill(null)
  if (!n) return { dif, difSub }

  const emaFast = calcEMA(closes, params.fastMa)
  const emaSlow = calcEMA(closes, params.slowMa)
  const emaFast2 = calcEMA(closes, params.fastMa2)
  const emaSlow2 = calcEMA(closes, params.slowMa2)

  for (let i = 0; i < n; i++) {
    const f = emaFast[i]
    const s = emaSlow[i]
    if (f != null && s != null) dif[i] = f - s
  }

  const difSlow = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const f2 = emaFast2[i]
    const s2 = emaSlow2[i]
    if (f2 != null && s2 != null) difSlow[i] = f2 - s2
  }

  for (let i = 0; i < n; i++) {
    const d = dif[i]
    const ds = difSlow[i]
    if (d != null && ds != null) difSub[i] = Math.abs(d - ds)
  }

  return { dif, difSub }
}

/** 小不點紅柱：DIF >= 0 且 DIFSub 較 3 根前放大（對齊圖表 barUpColor） */
export function isGoldenWaveBarRed(difVal, difSubVal, difSubPrev3) {
  const dif = Number(difVal)
  if (!Number.isFinite(dif) || dif < 0) return false
  const subNow = Number(difSubVal)
  const subPrev3 = Number(difSubPrev3)
  if (!Number.isFinite(subNow)) return false
  if (!Number.isFinite(subPrev3)) return true
  return subNow > subPrev3
}

function goldenWaveBarRedAt(gw, i) {
  const subPrev3 = i >= 3 ? gw.difSub[i - 3] : null
  return isGoldenWaveBarRed(gw.dif[i], gw.difSub[i], subPrev3)
}

/** 對齊圖表：以全部日線高低點計算 0%～100% 黃金切割；100% = 區間最低價 */
export function calcFibLevelsFromBars(bars) {
  const ohlc = mapBars(bars).filter(
    (b) => b.high != null && b.low != null && Number.isFinite(b.high) && Number.isFinite(b.low),
  )
  if (ohlc.length < 2) return null
  let globalHigh = -Infinity
  let globalLow = Infinity
  for (const b of ohlc) {
    if (b.high > globalHigh) globalHigh = b.high
    if (b.low < globalLow) globalLow = b.low
  }
  if (!Number.isFinite(globalHigh) || !Number.isFinite(globalLow) || globalHigh <= globalLow) {
    return null
  }
  const range = globalHigh - globalLow
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
  const levels = ratios.map((r) => ({
    ratio: r,
    value: globalHigh - range * r,
  }))
  return { globalHigh, globalLow, range, levels, fib100: globalLow, fib0: globalHigh }
}

/**
 * 最新收盤接近指定黃金切割價位（0% = 區間最高、100% = 區間最低）。
 * @param {number} ratio 0 或 1
 * @param {number} toleranceRatio 容許誤差占區間振幅比例，預設 1.5%
 */
export function isPriceAtFibRatio(bars, ratio, toleranceRatio = 0.015) {
  const fib = calcFibLevelsFromBars(bars)
  if (!fib) return false
  const level = fib.levels.find((l) => l.ratio === ratio)
  if (!level) return false
  const ohlc = mapBars(bars).filter((b) => b.close != null)
  const last = ohlc[ohlc.length - 1]
  if (!last) return false
  const tol = Math.max(fib.range * toleranceRatio, fib.globalHigh * 0.005)
  const close = Number(last.close)
  if (!Number.isFinite(close)) return false
  const target = level.value
  if (ratio >= 1) {
    const low = last.low != null ? Number(last.low) : close
    return Math.abs(close - target) <= tol || Math.abs(low - target) <= tol
  }
  if (ratio <= 0) {
    const high = last.high != null ? Number(last.high) : close
    return Math.abs(close - target) <= tol || Math.abs(high - target) <= tol
  }
  return Math.abs(close - target) <= tol
}

/** 100% = 整段日線最低點 */
export function isPriceAtFib100(bars, toleranceRatio = 0.015) {
  return isPriceAtFibRatio(bars, 1, toleranceRatio)
}

/** 0% = 整段日線最高點 */
export function isPriceAtFib0(bars, toleranceRatio = 0.015) {
  return isPriceAtFibRatio(bars, 0, toleranceRatio)
}

/** 小不點：最新一根為紅柱，且前一根非紅柱（評等仍使用，選股已移除） */
export function isGoldenWaveFirstRed(closes, params = DEFAULT_GOLDEN_WAVE_PARAMS) {
  if (!closes?.length) return false
  const gw = calcGoldenWave(closes, params)
  const i = gw.dif.length - 1
  if (i < 0) return false
  if (!goldenWaveBarRedAt(gw, i)) return false
  if (i < 1) return true
  return !goldenWaveBarRedAt(gw, i - 1)
}

export function buildHeikinAshi(bars) {
  const ha = []
  for (let i = 0; i < bars.length; i++) {
    const open = Number(bars[i].open)
    const high = Number(bars[i].high)
    const low = Number(bars[i].low)
    const close = Number(bars[i].close)
    if (![open, high, low, close].every(Number.isFinite)) continue
    const haClose = (open + high + low + close) / 4
    const prev = ha[i - 1]
    const prevHaOpen = prev ? prev.open : open
    const prevHaClose = prev ? prev.close : close
    const haOpen = (prevHaOpen + prevHaClose) / 2
    ha.push({
      open: haOpen,
      close: haClose,
      high: Math.max(high, haOpen, haClose),
      low: Math.min(low, haOpen, haClose),
    })
  }
  return ha
}

function isHeikinBarRed(candle) {
  if (!candle) return false
  return candle.close >= candle.open
}

/** 神奇 K 線：最新一根紅 K，前一根非紅 K */
export function isHeikinFirstRed(bars) {
  const ha = buildHeikinAshi(bars)
  const i = ha.length - 1
  if (i < 1) return false
  return isHeikinBarRed(ha[i]) && !isHeikinBarRed(ha[i - 1])
}

/** 5 均線 > 10 均線（最新 bar） */
export function isMa5AboveMa10(closes) {
  if (!closes?.length) return false
  const ma5 = calcSMA(closes, 5)
  const ma10 = calcSMA(closes, 10)
  const i = closes.length - 1
  return ma5[i] != null && ma10[i] != null && ma5[i] > ma10[i]
}

/**
 * 剛站上多空線：最新收盤 > 多空線，前一根收盤 <= 前一根多空線（週期對齊圖表預設 77）。
 */
export function isDuoKongCrossUp(closes, period = DEFAULT_DUO_KONG_PERIOD) {
  if (!closes?.length || closes.length < 2) return false
  const dk = calcDuoKongLine(closes, period)
  const i = closes.length - 1
  const prev = i - 1
  const closeNow = closes[i]
  const closePrev = closes[prev]
  const dkNow = dk.base[i]
  const dkPrev = dk.base[prev]
  if (
    closeNow == null || closePrev == null
    || dkNow == null || dkPrev == null
  ) return false
  return closeNow > dkNow && closePrev <= dkPrev
}

export function evaluateTaSignals(bars) {
  const mapped = mapBars(bars).filter((b) => b.close != null)
  const ohlcBars = mapped.filter(
    (b) => b.open != null && b.high != null && b.low != null && b.close != null,
  )
  const closes = mapped.map((b) => b.close)
  const gwParams = resolveGoldenWaveParams(closes.length)
  return {
    reversalFirstRed: isGoldenWaveFirstRed(closes, gwParams),
    heikinFirstRed: isHeikinFirstRed(ohlcBars),
    ma5gtMa10: isMa5AboveMa10(closes),
    fibAt0: isPriceAtFib0(bars),
    fibAt100: isPriceAtFib100(bars),
    duoKongCrossUp: isDuoKongCrossUp(closes),
  }
}

export function passesTaFilters(signals, taFilters) {
  if (!taFilters) return true
  if (taFilters.reversalFirstRed && !signals.reversalFirstRed) return false
  if (taFilters.heikinFirstRed && !signals.heikinFirstRed) return false
  if (taFilters.ma5gtMa10 && !signals.ma5gtMa10) return false
  if (taFilters.fibAt0 && !signals.fibAt0) return false
  if (taFilters.fibAt100 && !signals.fibAt100) return false
  if (taFilters.duoKongCrossUp && !signals.duoKongCrossUp) return false
  return true
}

export const CLIENT_ONLY_TA_FILTER_KEYS = ['fibAt0', 'fibAt100', 'duoKongCrossUp']

export function pickClientOnlyTaFilters(taFilters) {
  const out = {}
  for (const key of CLIENT_ONLY_TA_FILTER_KEYS) {
    if (taFilters?.[key]) out[key] = true
  }
  return out
}

export function hasClientOnlyTaFilters(taFilters) {
  return CLIENT_ONLY_TA_FILTER_KEYS.some((key) => taFilters?.[key])
}

export function hasActiveTaFilters(taFilters) {
  return !!(
    taFilters?.reversalFirstRed
    || taFilters?.heikinFirstRed
    || taFilters?.ma5gtMa10
    || taFilters?.fibAt0
    || taFilters?.fibAt100
    || taFilters?.duoKongCrossUp
  )
}
