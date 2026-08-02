import { fetchTimeseries } from '../api'
import { evaluateTaSignals, hasActiveTaFilters, passesTaFilters } from '../lib/taScreenRules'
import { gradeWarrant, buildGradeDetail } from '../lib/warrantGrade.js'

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

export function needsClientSideMasterFilter(taFilters, gradeFilter = '', { scopedSearch = false } = {}) {
  // 技術面可掃全市場；評等仍僅在有搜尋範圍時於前端計算
  if (hasActiveTaFilters(taFilters)) return true
  if (!scopedSearch) return false
  if (gradeFilter) return true
  return false
}

/** 搜尋結果逐檔計算 A/B/C（不篩掉列） */
export async function enrichMasterRowsWithGrades(
  rows,
  { onProgress, concurrency = DEFAULT_CONCURRENCY } = {},
) {
  return filterMasterRowsClient(rows, {
    taFilters: {},
    gradeFilter: '',
    gradeOnly: true,
    onProgress,
    concurrency,
  })
}

/** 逐檔抓日線，套用技術分析／評等條件並計算評等 */
export async function filterMasterRowsClient(
  rows,
  {
    taFilters,
    gradeFilter = '',
    gradeOnly = false,
    onProgress,
    onMatch,
    concurrency = DEFAULT_CONCURRENCY,
    timeseriesLimitDays,
  } = {},
) {
  const needTa = hasActiveTaFilters(taFilters)
  const needGrade = !!gradeFilter
  const enrichGrade = needGrade || gradeOnly
  if ((!needTa && !needGrade && !gradeOnly) || !rows?.length) return rows

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
          if (gradeOnly) pushMatch({ ...row })
          done += 1
          onProgress?.({ done, total: list.length, matched: matched.length })
          continue
        }
        const signals = evaluateTaSignals(bars)
        if (needTa && !passesTaFilters(signals, taFilters)) {
          done += 1
          onProgress?.({ done, total: list.length, matched: matched.length })
          continue
        }
        const enriched = { ...row, bar_count: bars.length }
        if (enrichGrade) {
          const grade = gradeWarrant(enriched, { taSignals: signals })
          enriched.warrant_grade = grade
          enriched.grade_detail = buildGradeDetail(enriched, { taSignals: signals })
          if (needGrade && grade !== gradeFilter) {
            done += 1
            onProgress?.({ done, total: list.length, matched: matched.length })
            continue
          }
        }
        pushMatch(enriched)
      } catch {
        if (gradeOnly) pushMatch({ ...row })
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
