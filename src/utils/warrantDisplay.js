export function warrantTypeLabel(row) {
  const t = String(row?.warrant_type || '')
  if (t.includes('認售') || t.toLowerCase() === 'put') return '認售'
  if (t.includes('認購') || t.toLowerCase() === 'call') return '認購'
  const name = String(row?.warrant_name || '')
  if (name.includes('認售') || name.includes('售')) return '認售'
  if (name.includes('認購') || name.includes('購')) return '認購'
  return t || null
}

export function isPutWarrant(row) {
  return warrantTypeLabel(row) === '認售'
}

/** 指數／類股權證標的（非單一個股） */
const INDEX_UNDERLYING_PATTERN = /指數|加權|台指|櫃買|道瓊|那斯達克|標普|費城|恒生|日經|NASDAQ|S&P|Dow/i

export function isIndividualStockWarrant(row) {
  const code = String(row?.underlying_code || '').trim()
  const name = String(row?.underlying_name || '')
  if (!code) return false
  if (INDEX_UNDERLYING_PATTERN.test(name)) return false
  return /^\d{4}$/.test(code)
}

export function isUnexpiredWarrant(row) {
  const days = resolveDaysToExpiry(row)
  if (days != null) return days >= 0
  if (row?.expiry_date) {
    const t = Date.parse(String(row.expiry_date))
    if (Number.isFinite(t)) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return t >= today.getTime()
    }
  }
  return true
}

function parseExpiryDateParts(value) {
  if (value == null || value === '') return null
  const s = String(value).trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.parse(s)
  if (Number.isFinite(t)) {
    const d = new Date(t)
    return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
  }
  return null
}

/** 到期日：相容 expiry_date / expiryDate，回傳 YYYY-MM-DD 或 null */
export function resolveExpiryDate(row) {
  const raw = row?.expiry_date ?? row?.expiryDate ?? row?.end_date ?? ''
  const parts = parseExpiryDateParts(raw)
  if (!parts) return null
  const [y, mo, d] = parts
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 剩餘天數：優先用欄位，否則由到期日計算（避免 API 回 null） */
export function resolveDaysToExpiry(row) {
  const fromField = row?.days_to_expiry ?? row?.daysToExpiry
  if (fromField != null && fromField !== '') {
    const n = Number(fromField)
    if (Number.isFinite(n)) return n
  }
  const parts = parseExpiryDateParts(resolveExpiryDate(row) ?? row?.expiry_date ?? row?.expiryDate ?? '')
  if (!parts) return null
  const [y, mo, d] = parts
  const expiry = new Date(y, mo - 1, d)
  expiry.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((expiry.getTime() - today.getTime()) / 86400000)
}

/** 匯出／合併前：正規化 expiry_date 與 days_to_expiry */
export function normalizeWarrantExpiryFields(row) {
  if (!row || typeof row !== 'object') return row
  const expiry_date = resolveExpiryDate(row) ?? (row.expiry_date || '')
  const days = resolveDaysToExpiry({ ...row, expiry_date })
  return {
    ...row,
    expiry_date,
    days_to_expiry: days ?? row.days_to_expiry ?? null,
  }
}

/** 台股 1 張 = 1000 股；權證 API 混用「張／股」，需對成交金額推斷 */
const SHARES_PER_LOT = 1000

function toFiniteNum(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** @returns {'lots'|'shares'|null} */
export function detectWarrantVolumeUnit(volume, close, turnover) {
  const v = toFiniteNum(volume)
  if (v == null || v <= 0) return null
  const c = toFiniteNum(close)
  const t = toFiniteNum(turnover)
  if (c != null && c > 0 && t != null && t > 0) {
    const errLots = Math.abs(t - v * c * SHARES_PER_LOT) / t
    const errShares = Math.abs(t - v * c) / t
    if (errShares + 0.02 < errLots) return 'shares'
    return 'lots'
  }
  if (v >= 500_000) return 'shares'
  return 'lots'
}

/** 將 API 原始 volume 換算為張數 */
export function resolveVolumeLots(volume, close, turnover) {
  const v = toFiniteNum(volume)
  if (v == null || v <= 0) return null
  const unit = detectWarrantVolumeUnit(v, close, turnover)
  if (unit === 'shares') return Math.round(v / SHARES_PER_LOT)
  return Math.round(v)
}

/** StockChartECharts 個股邏輯以「股」計量 */
export function resolveVolumeChartShares(volume, close, turnover) {
  const lots = resolveVolumeLots(volume, close, turnover)
  if (lots == null) return 0
  return lots * SHARES_PER_LOT
}

export function formatVolumeLots(volume, close, turnover, digits = 0) {
  const lots = resolveVolumeLots(volume, close, turnover)
  if (lots == null) return '—'
  return lots.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits > 0 ? 0 : undefined,
  })
}
