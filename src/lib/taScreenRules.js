import { calcSMA, calcDuoKongLine, mapBars } from './indicators'

/** 選股「剛站上多空線」專用週期（與圖表預設 77 可不同） */
export const TA_SCREEN_DUO_KONG_PERIOD = 45

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
 * 剛站上多空線：最新收盤 > 多空線，前一根收盤 <= 前一根多空線。
 */
export function isDuoKongCrossUp(closes, period = TA_SCREEN_DUO_KONG_PERIOD) {
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
    duoKongCrossUp: isDuoKongCrossUp(closes),
  }
}

export function passesTaFilters(signals, taFilters) {
  if (!taFilters) return true
  if (taFilters.reversalFirstRed && !signals.reversalFirstRed) return false
  if (taFilters.heikinFirstRed && !signals.heikinFirstRed) return false
  if (taFilters.ma5gtMa10 && !signals.ma5gtMa10) return false
  if (taFilters.duoKongCrossUp && !signals.duoKongCrossUp) return false
  return true
}

export const CLIENT_ONLY_TA_FILTER_KEYS = ['duoKongCrossUp']
export const BACKEND_TA_FILTER_KEYS = ['ma5gtMa10', 'heikinFirstRed']

export function hasBackendTaFilters(taFilters) {
  return BACKEND_TA_FILTER_KEYS.some((key) => taFilters?.[key])
}

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
    || taFilters?.duoKongCrossUp
  )
}
