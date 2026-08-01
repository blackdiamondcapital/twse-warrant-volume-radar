import { fetchTimeseries } from '../api'
import { evaluateTaSignals, hasActiveTaFilters, passesTaFilters } from '../lib/taScreenRules'
import { gradeWarrant, buildGradeDetail } from '../lib/warrantGrade.js'

const TIMESERIES_LIMIT_DAYS = 90
const DEFAULT_CONCURRENCY = 14

const barCache = new Map()

function cacheKey(code, limitDays) {
  return `${code}:${limitDays}`
}

async function fetchBarsForCode(code, limitDays = TIMESERIES_LIMIT_DAYS) {
  const key = cacheKey(code, limitDays)
  if (barCache.has(key)) return barCache.get(key)
  const resp = await fetchTimeseries({ code, limitDays })
  const bars = Array.isArray(resp?.data) ? resp.data : []
  barCache.set(key, bars)
  return bars
}

export function clearMasterBarCache() {
  barCache.clear()
}

export function needsClientSideMasterFilter(taFilters, gradeFilter = '') {
  return hasActiveTaFilters(taFilters) || !!gradeFilter
}

/** 逐檔抓日線，套用技術分析／評等條件並計算評等 */
export async function filterMasterRowsClient(
  rows,
  { taFilters, gradeFilter = '', onProgress, concurrency = DEFAULT_CONCURRENCY } = {},
) {
  const needTa = hasActiveTaFilters(taFilters)
  const needGrade = !!gradeFilter
  if ((!needTa && !needGrade) || !rows?.length) return rows

  const list = [...rows]
  const matched = []
  let done = 0
  let cursor = 0

  async function worker() {
    while (cursor < list.length) {
      const idx = cursor++
      const row = list[idx]
      const code = row?.warrant_code
      if (!code) {
        done += 1
        onProgress?.({ done, total: list.length })
        continue
      }
      try {
        const bars = await fetchBarsForCode(code)
        if (!bars.length) {
          done += 1
          onProgress?.({ done, total: list.length })
          continue
        }
        const signals = evaluateTaSignals(bars)
        if (needTa && !passesTaFilters(signals, taFilters)) {
          done += 1
          onProgress?.({ done, total: list.length })
          continue
        }
        const enriched = { ...row, bar_count: bars.length }
        const grade = gradeWarrant(enriched, { taSignals: signals })
        enriched.warrant_grade = grade
        enriched.grade_detail = buildGradeDetail(enriched, { taSignals: signals })
        if (needGrade && grade !== gradeFilter) {
          done += 1
          onProgress?.({ done, total: list.length })
          continue
        }
        matched.push(enriched)
      } catch {
        /* 略過無行情者 */
      }
      done += 1
      onProgress?.({ done, total: list.length })
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, list.length) }, () => worker())
  await Promise.all(workers)
  return matched
}

/** @deprecated 改用 filterMasterRowsClient */
export async function filterMasterRowsByTa(rows, taFilters, options = {}) {
  return filterMasterRowsClient(rows, { ...options, taFilters })
}
