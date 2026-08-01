import * as XLSX from 'xlsx'
import { fetchMasterDetail } from '../api'
import { resolveDaysToExpiry } from './warrantDisplay.js'
import { rowToDetailSheetRow } from './exportMasterExcel.js'
import { downloadExcelFile } from './downloadExcel.js'
import { enrichMasterRowsWithGrades } from './taScreenFilter.js'

const MASTER_ENRICH_CONCURRENCY = 14

function pad2(n) {
  return String(n).padStart(2, '0')
}

function todayStamp() {
  const d = new Date()
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
}

function mergeMasterDetail(row, detail) {
  const d = detail || {}
  const expiry = d.expiry_date || row.expiry_date || ''
  const merged = {
    ...row,
    underlying_code: row.underlying_code ?? d.underlying_code ?? '',
    underlying_name: row.underlying_name ?? d.underlying_name ?? '',
    latest_exercise_price: d.latest_exercise_price ?? d.original_exercise_price ?? row.latest_exercise_price ?? '',
    latest_exercise_ratio: d.latest_exercise_ratio ?? row.latest_exercise_ratio ?? '',
    expiry_date: expiry,
    issuance: d.issuance_units_thousand ?? d.accumulated_issuance ?? d.issuance ?? row.issuance ?? '',
    latest_trade_date: row.trade_date ?? d.latest_trade_date ?? row.latest_trade_date ?? '',
    market: row.market ?? d.market ?? '',
    close_price: row.close_price ?? d.latest_close_price ?? d.close_price ?? '',
  }
  merged.days_to_expiry = resolveDaysToExpiry(merged)
  return merged
}

async function enrichHeatRowsFromMaster(rows, { onProgress } = {}) {
  const list = [...rows]
  const out = new Array(list.length)
  let done = 0
  let cursor = 0

  async function worker() {
    while (cursor < list.length) {
      const idx = cursor++
      const row = list[idx]
      const code = row?.warrant_code
      if (!code) {
        out[idx] = row
        done += 1
        onProgress?.({ done, total: list.length })
        continue
      }
      try {
        const resp = await fetchMasterDetail(code)
        out[idx] = mergeMasterDetail(row, resp?.data)
      } catch {
        out[idx] = row
      }
      done += 1
      onProgress?.({ done, total: list.length })
    }
  }

  const workers = Math.min(MASTER_ENRICH_CONCURRENCY, list.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return out
}

function rowToHeatDetailSheetRow(row) {
  return {
    排名: row.rank ?? '',
    ...rowToDetailSheetRow(row),
    成交金額: row.turnover ?? '',
  }
}

export async function exportHeatToExcel(rows, { tradeDate, onProgress } = {}) {
  if (!rows?.length) {
    throw new Error('沒有熱度排行可匯出')
  }

  onProgress?.({ phase: 'master', done: 0, total: rows.length })
  const withMaster = await enrichHeatRowsFromMaster(rows, {
    onProgress: ({ done, total }) => onProgress?.({ phase: 'master', done, total }),
  })

  onProgress?.({ phase: 'grade', done: 0, total: withMaster.length })
  const enriched = await enrichMasterRowsWithGrades(withMaster, {
    onProgress: ({ done, total }) => onProgress?.({ phase: 'grade', done, total }),
  })

  const sheet = XLSX.utils.json_to_sheet(enriched.map(rowToHeatDetailSheetRow))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '當日熱度')
  const datePart = tradeDate ? String(tradeDate).replace(/-/g, '') : todayStamp()
  const method = await downloadExcelFile(workbook, `當日熱度_詳細_${datePart}.xlsx`)
  return { count: enriched.length, method }
}
