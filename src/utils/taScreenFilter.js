import { fetchTimeseries } from '../api'
import { evaluateTaSignals, hasActiveTaFilters, passesTaFilters } from '../lib/taScreenRules'

async function fetchClosesForCode(code, limitDays = 120) {
  const resp = await fetchTimeseries({ code, limitDays })
  return Array.isArray(resp?.data) ? resp.data : []
}

export async function filterMasterRowsByTa(rows, taFilters, { onProgress, concurrency = 6 } = {}) {
  if (!hasActiveTaFilters(taFilters) || !rows?.length) return rows

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
        const bars = await fetchClosesForCode(code)
        const signals = evaluateTaSignals(bars)
        if (passesTaFilters(signals, taFilters)) matched.push(row)
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
