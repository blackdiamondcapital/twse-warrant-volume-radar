import * as XLSX from 'xlsx'
import { warrantTypeLabel } from './warrantDisplay'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function todayStamp() {
  const d = new Date()
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
}

function rowToSheetRow(row) {
  return {
    排名: row.rank ?? '',
    權證代號: row.warrant_code ?? '',
    權證名稱: row.warrant_name ?? '',
    類型: warrantTypeLabel(row) ?? '',
    標的代號: row.underlying_code ?? '',
    標的名稱: row.underlying_name ?? '',
    市場: row.market ?? '',
    收盤: row.close_price ?? '',
    成交張數: row.volume ?? '',
    成交金額: row.turnover ?? '',
  }
}

export function exportHeatToExcel(rows, { tradeDate } = {}) {
  if (!rows?.length) {
    throw new Error('沒有熱度排行可匯出')
  }

  const sheet = XLSX.utils.json_to_sheet(rows.map(rowToSheetRow))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '當日熱度')
  const datePart = tradeDate ? String(tradeDate).replace(/-/g, '') : todayStamp()
  XLSX.writeFile(workbook, `當日熱度_${datePart}.xlsx`)
  return rows.length
}
