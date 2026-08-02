/** 主檔關鍵字：代號類查詢避免「5274」誤中「055274」「052747」 */

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

/** 4 位數字 → 現股標的代號（如 5274 信驊、2368 金像電） */
export function isUnderlyingStockCodeQuery(q) {
  const code = normalizeStockCodeQuery(q).replace(/\./g, '')
  return /^\d{4}$/.test(code)
}

/** 權證代號：5 碼以上純數字，或含英文字母（如 703349、03002T） */
export function isWarrantCodeQuery(q) {
  const code = normalizeStockCodeQuery(q).replace(/\./g, '')
  if (!/^[A-Z0-9]+$/i.test(code)) return false
  return code.length >= 5 || /[A-Z]/i.test(code)
}

/**
 * 代號查詢：
 * - 4 位數字 → 標的代號（5274 信驊；排除 055274 子字串誤中）
 * - 5 碼以上／含英文 → 權證代號精確或前綴（703349、03002T、03002…）
 * - 名稱（中文）→ 後端模糊比對
 */
export function rowMatchesMasterQuery(row, q) {
  const raw = String(q || '').trim()
  if (!raw) return true
  if (!isCodeLikeMasterQuery(raw)) return true

  const code = normalizeStockCodeQuery(raw)
  const warrant = normalizeStockCodeQuery(row?.warrant_code)
  const underlying = normalizeStockCodeQuery(row?.underlying_code)

  if (isUnderlyingStockCodeQuery(raw)) {
    return underlying === code
  }

  if (isWarrantCodeQuery(raw)) {
    return warrant === code || warrant.startsWith(code)
  }

  return warrant === code || warrant.startsWith(code) || underlying === code
}

export function filterMasterRowsByQuery(rows, q) {
  if (!isCodeLikeMasterQuery(q)) return rows || []
  return (rows || []).filter((row) => rowMatchesMasterQuery(row, q))
}

/** 標的／權證代號查詢：忽略基本面條件，避免殘留篩選導致 0 筆 */
export function buildStockCodeLookupFilters(filters) {
  if (!filters || typeof filters !== 'object') return filters
  return {
    ...filters,
    closeMin: '',
    closeMax: '',
    exerciseMin: '',
    exerciseMax: '',
    ratioMin: '',
    ratioMax: '',
    volumeMin: '',
    volumeMax: '',
    daysMin: '',
    daysMax: '',
    expiryFrom: '',
    expiryTo: '',
  }
}
