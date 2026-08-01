/** 主檔關鍵字：代號類查詢避免「5274」誤中「052745」 */

export function normalizeStockCodeQuery(q) {
  let s = String(q || '').trim().toUpperCase()
  for (const suffix of ['.TW', '.TWO', '.TAI']) {
    if (s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length)
      break
    }
  }
  return s.trim()
}

export function isCodeLikeMasterQuery(q) {
  const raw = String(q || '').trim()
  if (!raw) return false
  if (/[\u4e00-\u9fff]/.test(raw)) return false
  const code = normalizeStockCodeQuery(raw).replace(/\./g, '')
  return !!code && /^[A-Z0-9]+$/i.test(code) && /\d/.test(code)
}

/**
 * 代號查詢：權證代號精確或前綴；標的代號精確。
 * 名稱查詢：交由後端模糊比對，前端不另篩。
 */
export function rowMatchesMasterQuery(row, q) {
  const raw = String(q || '').trim()
  if (!raw) return true
  if (!isCodeLikeMasterQuery(raw)) return true

  const code = normalizeStockCodeQuery(raw)
  const warrant = normalizeStockCodeQuery(row?.warrant_code)
  const underlying = normalizeStockCodeQuery(row?.underlying_code)
  return warrant === code || warrant.startsWith(code) || underlying === code
}

export function filterMasterRowsByQuery(rows, q) {
  if (!isCodeLikeMasterQuery(q)) return rows || []
  return (rows || []).filter((row) => rowMatchesMasterQuery(row, q))
}
