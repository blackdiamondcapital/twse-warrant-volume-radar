import { calcSMA, calcDuoKongTrend, mapBars } from './indicators'
import { DEFAULT_DUO_KONG_TREND_PERIOD } from './chartTheme'

/** 動態轉折（小不點）階梯線：上漲段 red、下跌段 green */
export function calcReversalSegments(closes, boxSize = 0.5) {
  const n = closes.length
  const red = new Array(n).fill(null)
  const green = new Array(n).fill(null)
  if (!n) return { red, green }

  const quantize = (v) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v / boxSize) * boxSize : null

  let base = quantize(closes[0])
  if (base == null) return { red, green }

  let dir = 0
  let color = null
  let swingHigh = base
  let swingLow = base
  let bullThreshold = base
  let bearThreshold = base
  let started = false

  for (let i = 1; i < n; i++) {
    const currClose = closes[i]
    if (!Number.isFinite(currClose)) continue
    const c = quantize(currClose)
    if (c == null) continue

    if (!started) {
      if (c === base) continue
      dir = c > base ? 1 : -1
      color = dir > 0 ? 'up' : 'down'
      if (dir > 0) {
        red[i - 1] = base
        red[i] = c
      } else {
        green[i - 1] = base
        green[i] = c
      }
      swingHigh = Math.max(base, c)
      swingLow = Math.min(base, c)
      bullThreshold = swingHigh
      bearThreshold = swingLow
      base = c
      started = true
      continue
    }

    if (dir > 0) {
      if (c >= base) {
        base = c
        if (c > swingHigh) {
          swingHigh = c
          bullThreshold = swingHigh
        }
      } else {
        base = c
        if (c < swingLow) swingLow = c
        bearThreshold = swingLow
        if (c <= bearThreshold) {
          dir = -1
          color = 'down'
        }
      }
    } else if (dir < 0) {
      if (c <= base) {
        base = c
        if (c < swingLow) {
          swingLow = c
          bearThreshold = swingLow
        }
      } else {
        base = c
        if (c > swingHigh) {
          swingHigh = c
          bullThreshold = swingHigh
        }
        if (c >= bullThreshold) {
          dir = 1
          color = 'up'
        }
      }
    }

    if (color === 'up') red[i] = base
    else if (color === 'down') green[i] = base
  }

  return { red, green }
}

function segmentAt(red, green, i) {
  if (i < 0) return null
  if (red[i] != null) return 'up'
  if (green[i] != null) return 'down'
  return null
}

/** 小不點：最新一根為紅（多頭段第一根） */
export function isReversalFirstRed(closes) {
  if (!closes?.length) return false
  const { red, green } = calcReversalSegments(closes)
  const i = closes.length - 1
  if (i < 1) return false
  return segmentAt(red, green, i) === 'up' && segmentAt(red, green, i - 1) === 'down'
}

/** 多空趨勢線：斜率剛轉為上漲（第一根紅段） */
export function isDuoKongTrendFirstRed(closes, period = DEFAULT_DUO_KONG_TREND_PERIOD) {
  const { base } = calcDuoKongTrend(closes, period)
  const i = base.length - 1
  if (i < 2) return false
  const risingNow = base[i] != null && base[i - 1] != null && base[i] > base[i - 1]
  const risingPrev =
    base[i - 1] != null && base[i - 2] != null && base[i - 1] > base[i - 2]
  return risingNow && !risingPrev
}

/** 5 均線 > 10 均線（最新 bar） */
export function isMa5AboveMa10(closes) {
  if (!closes?.length) return false
  const ma5 = calcSMA(closes, 5)
  const ma10 = calcSMA(closes, 10)
  const i = closes.length - 1
  return ma5[i] != null && ma10[i] != null && ma5[i] > ma10[i]
}

export function evaluateTaSignals(bars) {
  const mapped = mapBars(bars)
  const closes = mapped.map((b) => b.close).filter((v) => v != null)
  return {
    reversalFirstRed: isReversalFirstRed(closes),
    ma5gtMa10: isMa5AboveMa10(closes),
    duoKongTrendFirstRed: isDuoKongTrendFirstRed(closes),
  }
}

export function passesTaFilters(signals, taFilters) {
  if (!taFilters) return true
  if (taFilters.reversalFirstRed && !signals.reversalFirstRed) return false
  if (taFilters.ma5gtMa10 && !signals.ma5gtMa10) return false
  if (taFilters.duoKongTrendFirstRed && !signals.duoKongTrendFirstRed) return false
  return true
}

export function hasActiveTaFilters(taFilters) {
  return !!(taFilters?.reversalFirstRed || taFilters?.ma5gtMa10 || taFilters?.duoKongTrendFirstRed)
}
