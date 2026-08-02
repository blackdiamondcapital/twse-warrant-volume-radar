import * as XLSX from 'xlsx'
import { fetchMasterSearch } from '../api'
import {
  isIndividualStockWarrant,
  isUnexpiredWarrant,
  normalizeWarrantExpiryFields,
  resolveDaysToExpiry,
  resolveExpiryDate,
  warrantTypeLabel,
} from './warrantDisplay.js'
import { buildMasterSearchParams } from './masterSearchParams.js'
import { rowMatchesMasterQuery } from './masterSearchMatch.js'
import { downloadExcelFile } from './downloadExcel.js'
import { enrichMasterRowsWithGrades } from './taScreenFilter.js'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function todayStamp() {
  const d = new Date()
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
}

function buildSearchParams(filters, numOrUndef, page, pageSize) {
  return buildMasterSearchParams(filters, numOrUndef, { page, pageSize })
}

function rowToSheetRow(row) {
  return rowToDetailSheetRow(row)
}

export function rowToDetailSheetRow(row) {
  const normalized = normalizeWarrantExpiryFields(row)
  const days = resolveDaysToExpiry(normalized)
  const expiry = resolveExpiryDate(normalized) ?? normalized.expiry_date ?? ''
  return {
    權證代號: normalized.warrant_code ?? '',
    權證名稱: normalized.warrant_name ?? '',
    類型: warrantTypeLabel(normalized) ?? '',
    標的代號: normalized.underlying_code ?? '',
    標的名稱: normalized.underlying_name ?? '',
    市場: normalized.market ?? '',
    評等: normalized.warrant_grade ?? '',
    收盤: normalized.close_price ?? '',
    成交量: normalized.volume ?? '',
    履約價: normalized.latest_exercise_price ?? '',
    行使比例: normalized.latest_exercise_ratio ?? '',
    剩餘天數: days ?? '',
    到期日: expiry,
    發行量: normalized.issuance ?? '',
    最近成交日: normalized.latest_trade_date ?? '',
  }
}

function rowToCompactSheetRow(row) {
  const normalized = normalizeWarrantExpiryFields(row)
  const days = resolveDaysToExpiry(normalized)
  const expiry = resolveExpiryDate(normalized) ?? normalized.expiry_date ?? ''
  return {
    標的代號: normalized.underlying_code ?? '',
    標的名稱: normalized.underlying_name ?? '',
    權證代號: normalized.warrant_code ?? '',
    類型: warrantTypeLabel(normalized) ?? '',
    剩餘天數: days ?? '',
    到期日: expiry,
  }
}

function sortExportRows(rows) {
  return [...rows].sort((a, b) => {
    const ua = String(a.underlying_code || '')
    const ub = String(b.underlying_code || '')
    if (ua !== ub) return ua.localeCompare(ub, 'zh-Hant')
    const ta = warrantTypeLabel(a) || ''
    const tb = warrantTypeLabel(b) || ''
    if (ta !== tb) return ta.localeCompare(tb, 'zh-Hant')
    return String(a.warrant_code || '').localeCompare(String(b.warrant_code || ''))
  })
}

export async function exportRowsToExcel(rows, {
  filenamePrefix = '權證主檔',
  sheetName = '發行主檔',
  compact = false,
} = {}) {
  if (!rows?.length) {
    throw new Error('沒有符合條件的主檔可匯出')
  }
  const sorted = sortExportRows(rows)
  const mapper = compact ? rowToCompactSheetRow : rowToSheetRow
  const sheet = XLSX.utils.json_to_sheet(sorted.map(mapper))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  const method = await downloadExcelFile(workbook, `${filenamePrefix}_${todayStamp()}.xlsx`)
  return { count: sorted.length, method }
}

const EXPORT_PAGE_SIZE = 200
const EXPORT_FETCH_CONCURRENCY = 4

export async function fetchAllMasterRows(filters, numOrUndef, {
  onProgress,
  pageSize = EXPORT_PAGE_SIZE,
  concurrency = EXPORT_FETCH_CONCURRENCY,
  rowFilter,
} = {}) {
  const size = Math.min(200, Math.max(1, Number(pageSize) || EXPORT_PAGE_SIZE))
  const first = await fetchMasterSearch(buildSearchParams(filters, numOrUndef, 1, size))
  const total = Number(first.total) || 0
  const keep = (rows) => (typeof rowFilter === 'function' ? rows.filter(rowFilter) : rows)
  const allRows = keep(first.data || [])
  onProgress?.({ loaded: allRows.length, total })

  const totalPages = Math.max(1, Math.ceil(total / size))
  if (totalPages <= 1) return allRows

  const pages = []
  for (let page = 2; page <= totalPages; page += 1) pages.push(page)

  let cursor = 0
  async function worker() {
    while (cursor < pages.length) {
      const page = pages[cursor]
      cursor += 1
      const data = await fetchMasterSearch(buildSearchParams(filters, numOrUndef, page, size))
      allRows.push(...keep(data.data || []))
      onProgress?.({ loaded: allRows.length, total })
    }
  }

  const workers = Math.min(Math.max(1, Number(concurrency) || 1), pages.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return allRows
}

/** 主檔輪播：最多抓 maxRows 筆，避免一次載入過多 */
export async function fetchMasterRowsUpTo(filters, numOrUndef, maxRows = 200) {
  const cap = Math.max(1, Number(maxRows) || 200)
  const pageSize = Math.min(200, cap)
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

async function ensureRowsWithGrades(rows, onProgress) {
  if (!rows?.length || rows.every((row) => row.warrant_grade)) return rows
  onProgress?.({ phase: 'grade', done: 0, total: rows.length })
  return enrichMasterRowsWithGrades(rows, {
    onProgress: ({ done, total }) => onProgress?.({ phase: 'grade', done, total }),
  })
}

function buildExportRowFilter({ individualStockOnly, unexpiredOnly, q }) {
  return (row) => {
    if (individualStockOnly && !isIndividualStockWarrant(row)) return false
    if (unexpiredOnly && !isUnexpiredWarrant(row)) return false
    if (!rowMatchesMasterQuery(row, q)) return false
    return true
  }
}

function applyExportRowFilters(rows, { individualStockOnly, unexpiredOnly, q }) {
  const filter = buildExportRowFilter({ individualStockOnly, unexpiredOnly, q })
  return rows.filter(filter)
}

export async function exportMasterToExcel(filters, numOrUndef, {
  onProgress,
  rows: presetRows,
  includeGrade = false,
  compact = true,
  individualStockOnly = true,
  unexpiredOnly = true,
} = {}) {
  const rowFilter = buildExportRowFilter({
    individualStockOnly,
    unexpiredOnly,
    q: filters?.q,
  })

  let rows = presetRows?.length
    ? applyExportRowFilters(presetRows, {
      individualStockOnly,
      unexpiredOnly,
      q: filters?.q,
    })
    : await fetchAllMasterRows(filters, numOrUndef, {
      onProgress: ({ loaded, total }) => onProgress?.({ phase: 'load', loaded, total }),
      rowFilter,
    })

  if (!rows.length) {
    throw new Error('沒有符合條件的未到期個股權證可匯出')
  }

  if (includeGrade) {
    rows = await ensureRowsWithGrades(rows, onProgress)
  }

  return exportRowsToExcel(rows, {
    filenamePrefix: compact ? '個股權證代號_未到期' : '權證主檔_未到期',
    sheetName: compact ? '個股權證代號' : '發行主檔',
    compact,
  })
}
