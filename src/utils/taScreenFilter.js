import { fetchTimeseries } from '../api'
import { evaluateTaSignals, hasActiveTaFilters, passesTaFilters } from '../lib/taScreenRules'

const TIMESERIES_LIMIT_DAYS = 90
const DUO_KONG_TIMESERIES_LIMIT_DAYS = 60
/** 全市場 client-side 技術掃描上限（依成交量排序） */
export const TA_FULL_MARKET_SCAN_CAP = 600
/** 有篩選條件時 client-side 技術掃描上限 */
export const TA_SCOPED_SCAN_CAP = 1200
/** 後端 ta-screen 後再接 client 篩選時的上限 */
export const TA_BACKEND_CLIENT_CAP = 1200
export const TA_SCAN_CONCURRENCY = 40
const DEFAULT_CONCURRENCY = TA_SCAN_CONCURRENCY

const barCache = new Map()
const barInflight = new Map()

function cacheKey(code, limitDays) {
  return `${code}:${limitDays}`
}

async function fetchBarsForCode(code, limitDays = TIMESERIES_LIMIT_DAYS) {
  const key = cacheKey(code, limitDays)
  if (barCache.has(key)) return barCache.get(key)
  if (barInflight.has(key)) return barInflight.get(key)
  const pending = fetchTimeseries({ code, limitDays })
    .then((resp) => {
      const bars = Array.isArray(resp?.data) ? resp.data : []
      barCache.set(key, bars)
      return bars
    })
    .finally(() => {
      barInflight.delete(key)
    })
  barInflight.set(key, pending)
  return pending
}

export function clearMasterBarCache() {
  barCache.clear()
  barInflight.clear()
}

/** 逐檔抓日線，套用技術分析條件 */
export async function filterMasterRowsClient(
  rows,
  {
    taFilters,
    onProgress,
    onMatch,
    concurrency = DEFAULT_CONCURRENCY,
    timeseriesLimitDays,
  } = {},
) {
  const needTa = hasActiveTaFilters(taFilters)
  if (!needTa || !rows?.length) return rows

  let barLimit = timeseriesLimitDays ?? TIMESERIES_LIMIT_DAYS
  if (taFilters?.duoKongCrossUp) {
    barLimit = timeseriesLimitDays ?? DUO_KONG_TIMESERIES_LIMIT_DAYS
  }

  const list = [...rows]
  const matched = []
  let done = 0
  let cursor = 0
  const workerCount = Math.max(1, Math.min(concurrency, list.length))

  function pushMatch(row) {
    matched.push(row)
    onMatch?.(row, matched.length)
  }

  async function worker() {
    while (cursor < list.length) {
      const idx = cursor++
      const row = list[idx]
      const code = row?.warrant_code
      if (!code) {
        done += 1
        onProgress?.({ done, total: list.length, matched: matched.length })
        continue
      }
      try {
        const bars = await fetchBarsForCode(code, barLimit)
        if (!bars.length) {
          done += 1
          onProgress?.({ done, total: list.length, matched: matched.length })
          continue
        }
        const signals = evaluateTaSignals(bars)
        if (!passesTaFilters(signals, taFilters)) {
          done += 1
          onProgress?.({ done, total: list.length, matched: matched.length })
          continue
        }
        pushMatch({ ...row, bar_count: bars.length })
      } catch {
        /* skip unmatched on fetch error */
      }
      done += 1
      onProgress?.({ done, total: list.length, matched: matched.length })
    }
  }

  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)
  return matched
}

/** @deprecated 改用 filterMasterRowsClient */
export async function filterMasterRowsByTa(rows, taFilters, options = {}) {
  return filterMasterRowsClient(rows, { ...options, taFilters })
}
