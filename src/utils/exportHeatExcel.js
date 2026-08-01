import * as XLSX from 'xlsx'
import { rowToDetailSheetRow } from './exportMasterExcel.js'
import { downloadExcelFile } from './downloadExcel.js'
import { enrichMasterRowsWithGrades } from './taScreenFilter.js'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function todayStamp() {
  const d = new Date()
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
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

  onProgress?.({ phase: 'grade', done: 0, total: rows.length })
  const enriched = await enrichMasterRowsWithGrades(rows, {
    onProgress: ({ done, total }) => onProgress?.({ phase: 'grade', done, total }),
  })

  const sheet = XLSX.utils.json_to_sheet(enriched.map(rowToHeatDetailSheetRow))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '當日熱度')
  const datePart = tradeDate ? String(tradeDate).replace(/-/g, '') : todayStamp()
  const method = await downloadExcelFile(workbook, `當日熱度_詳細_${datePart}.xlsx`)
  return { count: enriched.length, method }
}
