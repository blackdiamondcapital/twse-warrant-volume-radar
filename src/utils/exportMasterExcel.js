import * as XLSX from 'xlsx'
import { fetchMasterSearch } from '../api'
import { warrantTypeLabel } from './warrantDisplay'
import { downloadExcelFile } from './downloadExcel.js'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function todayStamp() {
  const d = new Date()
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
}

function buildSearchParams(filters, numOrUndef, page, pageSize) {
  return {
    q: filters.q || undefined,
    market: filters.market,
    type: filters.type || undefined,
    expiryFrom: filters.expiryFrom || undefined,
    expiryTo: filters.expiryTo || undefined,
    closeMin: numOrUndef(filters.closeMin),
    closeMax: numOrUndef(filters.closeMax),
    exerciseMin: numOrUndef(filters.exerciseMin),
    exerciseMax: numOrUndef(filters.exerciseMax),
    ratioMin: numOrUndef(filters.ratioMin),
    ratioMax: numOrUndef(filters.ratioMax),
    volumeMin: numOrUndef(filters.volumeMin),
    volumeMax: numOrUndef(filters.volumeMax),
    daysMin: numOrUndef(filters.daysMin),
    daysMax: numOrUndef(filters.daysMax),
    sort: filters.sort || 'expiry',
    sortDir: filters.sortDir || 'asc',
    page,
    pageSize,
  }
}

function rowToSheetRow(row) {
  return {
    權證代號: row.warrant_code ?? '',
    權證名稱: row.warrant_name ?? '',
    類型: warrantTypeLabel(row) ?? '',
    標的代號: row.underlying_code ?? '',
    標的名稱: row.underlying_name ?? '',
    市場: row.market ?? '',
    收盤: row.close_price ?? '',
    成交量: row.volume ?? '',
    履約價: row.latest_exercise_price ?? '',
    剩餘天數: row.days_to_expiry ?? '',
    到期日: row.expiry_date ?? '',
    發行量: row.issuance ?? '',
    最近成交日: row.latest_trade_date ?? '',
  }
}

export async function exportRowsToExcel(rows, filenamePrefix = '權證主檔') {
  if (!rows?.length) {
    throw new Error('沒有符合條件的主檔可匯出')
  }
  const sheet = XLSX.utils.json_to_sheet(rows.map(rowToSheetRow))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '發行主檔')
  const method = await downloadExcelFile(workbook, `${filenamePrefix}_${todayStamp()}.xlsx`)
  return { count: rows.length, method }
}

export async function fetchAllMasterRows(filters, numOrUndef, { onProgress } = {}) {
  const pageSize = 1000
  let page = 1
  let total = Infinity
  const allRows = []

  while (allRows.length < total) {
    const data = await fetchMasterSearch(buildSearchParams(filters, numOrUndef, page, pageSize))
    const rows = data.data || []
    total = Number(data.total) || 0
    allRows.push(...rows)
    onProgress?.({ loaded: allRows.length, total })
    if (!rows.length || allRows.length >= total) break
    page += 1
  }

  return allRows
}

/** 主檔輪播：最多抓 maxRows 筆，避免一次載入過多 */
export async function fetchMasterRowsUpTo(filters, numOrUndef, maxRows = 200) {
  const cap = Math.max(1, Number(maxRows) || 200)
  const pageSize = Math.min(1000, cap)
  let page = 1
  let total = Infinity
  const allRows = []

  while (allRows.length < total && allRows.length < cap) {
    const data = await fetchMasterSearch(buildSearchParams(filters, numOrUndef, page, pageSize))
    const rows = data.data || []
    total = Number(data.total) || 0
    allRows.push(...rows)
    if (!rows.length || allRows.length >= total || allRows.length >= cap) break
    page += 1
  }

  return allRows.slice(0, cap)
}

export async function exportMasterToExcel(filters, numOrUndef, { onProgress, rows: presetRows } = {}) {
  const rows = presetRows?.length
    ? presetRows
    : await fetchAllMasterRows(filters, numOrUndef, { onProgress })
  return exportRowsToExcel(rows)
}
