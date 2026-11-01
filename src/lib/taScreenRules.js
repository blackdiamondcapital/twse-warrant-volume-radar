import { calcSMA, calcDuoKongLine, calcKD, calcRSI, calcMACD, mapBars } from './indicators'

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

/** 小不點：最新一根為紅柱，且前一根非紅柱 */
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

export function isHeikinFirstGreen(bars) {
  const ha = buildHeikinAshi(bars)
  const i = ha.length - 1
  if (i < 1) return false
  return !isHeikinBarRed(ha[i]) && isHeikinBarRed(ha[i - 1])
}

export function isHeikinRed(bars) {
  const ha = buildHeikinAshi(bars)
  const i = ha.length - 1
  if (i < 0) return false
  return isHeikinBarRed(ha[i])
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

export function isDuoKongAbove(closes, period = TA_SCREEN_DUO_KONG_PERIOD) {
  if (!closes?.length) return false
  const dk = calcDuoKongLine(closes, period)
  const i = closes.length - 1
  return closes[i] != null && dk.base[i] != null && closes[i] > dk.base[i]
}

export function isDuoKongCrossDown(closes, period = TA_SCREEN_DUO_KONG_PERIOD) {
  if (!closes?.length || closes.length < 2) return false
  const dk = calcDuoKongLine(closes, period)
  const i = closes.length - 1
  const prev = i - 1
  if (closes[i] == null || closes[prev] == null || dk.base[i] == null || dk.base[prev] == null) return false
  return closes[i] < dk.base[i] && closes[prev] >= dk.base[prev]
}

function lastTwo(arr) {
  if (!arr?.length || arr.length < 2) return [null, null]
  return [arr[arr.length - 2], arr[arr.length - 1]]
}

export function evaluateTaSignals(bars) {
  const mapped = mapBars(bars).filter((b) => b.close != null)
  const ohlcBars = mapped.filter(
    (b) => b.open != null && b.high != null && b.low != null && b.close != null,
  )
  const closes = mapped.map((b) => b.close)
  const volumes = mapped.map((b) => b.volume)
  const gwParams = resolveGoldenWaveParams(closes.length)
  const i = closes.length - 1
  const ma5 = calcSMA(closes, 5)
  const ma10 = calcSMA(closes, 10)
  const ma20 = calcSMA(closes, 20)
  const [ma5Prev, ma5Now] = lastTwo(ma5)
  const [ma10Prev, ma10Now] = lastTwo(ma10)
  const rsi = calcRSI(closes, 14)
  const macd = calcMACD(closes, 12, 26, 9)
  const kd = calcKD(ohlcBars, 9, 3, 3)
  const rsiNow = rsi[i]
  const [difPrev, difNow] = lastTwo(macd.dif)
  const [deaPrev, deaNow] = lastTwo(macd.dea)
  const [kPrev, kNow] = lastTwo(kd.k)
  const [dPrev, dNow] = lastTwo(kd.d)
  const prevBar = ohlcBars[ohlcBars.length - 2]
  const lastBar = ohlcBars[ohlcBars.length - 1]
  const volNow = Number(volumes[i])
  const volPrev = Number(volumes[i - 1])

  return {
    reversalFirstRed: isGoldenWaveFirstRed(closes, gwParams),
    heikinFirstRed: isHeikinFirstRed(ohlcBars),
    heikinFirstGreen: isHeikinFirstGreen(ohlcBars),
    heikinRed: isHeikinRed(ohlcBars),
    ma5gtMa10: isMa5AboveMa10(closes),
    ma10gtMa20: ma10Now != null && ma20[i] != null && ma10Now > ma20[i],
    maBullAlign: ma5Now != null && ma10Now != null && ma20[i] != null && ma5Now > ma10Now && ma10Now > ma20[i],
    maBearAlign: ma5Now != null && ma10Now != null && ma20[i] != null && ma5Now < ma10Now && ma10Now < ma20[i],
    ma5CrossUpMa10: ma5Prev != null && ma10Prev != null && ma5Now != null && ma10Now != null
      && ma5Prev <= ma10Prev && ma5Now > ma10Now,
    ma5CrossDownMa10: ma5Prev != null && ma10Prev != null && ma5Now != null && ma10Now != null
      && ma5Prev >= ma10Prev && ma5Now < ma10Now,
    closeAboveMa5: closes[i] != null && ma5Now != null && closes[i] > ma5Now,
    duoKongCrossUp: isDuoKongCrossUp(closes),
    duoKongAbove: isDuoKongAbove(closes),
    duoKongCrossDown: isDuoKongCrossDown(closes),
    rsiLt30: rsiNow != null && rsiNow < 30,
    rsiGt70: rsiNow != null && rsiNow > 70,
    macdDifGt0: difNow != null && difNow > 0,
    macdGoldCross: difPrev != null && deaPrev != null && difNow != null && deaNow != null
      && difPrev <= deaPrev && difNow > deaNow,
    kdKgtD: kNow != null && dNow != null && kNow > dNow,
    kdGoldCrossLow: kPrev != null && dPrev != null && kNow != null && dNow != null
      && kPrev <= dPrev && kNow > dNow && kNow < 30,
    breakPrevHigh: lastBar && prevBar && lastBar.close != null && prevBar.high != null
      && lastBar.close > prevBar.high,
    volumeUp: Number.isFinite(volNow) && Number.isFinite(volPrev) && volPrev > 0 && volNow >= volPrev * 1.5,
  }
}

export const TA_FILTER_GROUPS = [
  {
    id: 'ma',
    label: '均線',
    items: [
      { key: 'ma5gtMa10', label: '5均 > 10均' },
      { key: 'ma10gtMa20', label: '10均 > 20均' },
      { key: 'maBullAlign', label: '多頭排列' },
      { key: 'maBearAlign', label: '空頭排列' },
      { key: 'ma5CrossUpMa10', label: '5/10 金叉' },
      { key: 'ma5CrossDownMa10', label: '5/10 死叉' },
      { key: 'closeAboveMa5', label: '收盤 > 5均' },
    ],
  },
  {
    id: 'dk',
    label: '多空線',
    items: [
      { key: 'duoKongCrossUp', label: '剛站上多空線' },
      { key: 'duoKongAbove', label: '站上多空線' },
      { key: 'duoKongCrossDown', label: '剛跌破多空線' },
    ],
  },
  {
    id: 'ha',
    label: '神奇K',
    items: [
      { key: 'heikinFirstRed', label: '第一根紅' },
      { key: 'heikinFirstGreen', label: '第一根綠' },
      { key: 'heikinRed', label: '紅K' },
    ],
  },
  {
    id: 'mom',
    label: '動能',
    items: [
      { key: 'reversalFirstRed', label: '小不點第一根紅' },
      { key: 'rsiLt30', label: 'RSI < 30' },
      { key: 'rsiGt70', label: 'RSI > 70' },
      { key: 'macdDifGt0', label: 'MACD DIF > 0' },
      { key: 'macdGoldCross', label: 'MACD 金叉' },
      { key: 'kdKgtD', label: 'KD K > D' },
      { key: 'kdGoldCrossLow', label: 'KD 低檔金叉' },
    ],
  },
  {
    id: 'pv',
    label: '量價',
    items: [
      { key: 'breakPrevHigh', label: '突破昨高' },
      { key: 'volumeUp', label: '放量 1.5 倍' },
    ],
  },
]

export const BACKEND_TA_FILTER_KEYS = TA_FILTER_GROUPS.flatMap((g) => g.items.map((i) => i.key))
export const TA_FILTER_LABELS = Object.fromEntries(
  TA_FILTER_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label])),
)

export function emptyTaFilters() {
  return Object.fromEntries(BACKEND_TA_FILTER_KEYS.map((key) => [key, false]))
}

export function passesTaFilters(signals, taFilters) {
  if (!taFilters) return true
  for (const key of BACKEND_TA_FILTER_KEYS) {
    if (taFilters[key] && !signals[key]) return false
  }
  return true
}

export const CLIENT_ONLY_TA_FILTER_KEYS = []

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
  return BACKEND_TA_FILTER_KEYS.some((key) => taFilters?.[key])
}

export function taScreenQueryFlags(taFilters) {
  const out = {}
  for (const key of BACKEND_TA_FILTER_KEYS) {
    if (taFilters?.[key]) out[key] = 1
  }
  return out
}

export function activeTaFilterLabels(taFilters) {
  return BACKEND_TA_FILTER_KEYS.filter((key) => taFilters?.[key]).map((key) => TA_FILTER_LABELS[key])
}
