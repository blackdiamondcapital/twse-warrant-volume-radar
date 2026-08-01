import { fetchTimeseries } from '../api'
import { evaluateTaSignals, hasActiveTaFilters, passesTaFilters } from '../lib/taScreenRules'
import { gradeWarrant, buildGradeDetail } from '../lib/warrantGrade.js'

const TIMESERIES_LIMIT_DAYS = 750

async function fetchBarsForCode(code, limitDays = TIMESERIES_LIMIT_DAYS) {
  const resp = await fetchTimeseries({ code, limitDays })
  return Array.isArray(resp?.data) ? resp.data : []
}

export function needsClientSideMasterFilter(taFilters, barsMin) {
  const minBars = Number(barsMin)
  return hasActiveTaFilters(taFilters) || (Number.isFinite(minBars) && minBars > 0)
}

/**
 * 逐檔抓日線，套用 K 棒數門檻與／或技術分析條件（同一趟請求）。
 * 符合者附加 bar_count 供結果表顯示。
 */
export async function filterMasterRowsClient(
  rows,
  { taFilters, barsMin, onProgress, concurrency = 6 } = {},
) {
  const needTa = hasActiveTaFilters(taFilters)
  const minBars = Number(barsMin)
  const needBars = Number.isFinite(minBars) && minBars > 0
  if ((!needTa && !needBars) || !rows?.length) return rows

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
        const barCount = bars.length
        if (needBars && barCount < minBars) {
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
        const enriched = { ...row, bar_count: barCount }
        enriched.warrant_grade = gradeWarrant(enriched, { taSignals: signals })
        enriched.grade_detail = buildGradeDetail(enriched, { taSignals: signals })
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
  return filterMasterRowsClient(rows, { ...options, taFilters, barsMin: undefined })
}
