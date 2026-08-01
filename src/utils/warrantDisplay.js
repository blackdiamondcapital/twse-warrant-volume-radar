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

/** 剩餘天數：優先用欄位，否則由到期日計算（避免 API 回 null） */
export function resolveDaysToExpiry(row) {
  const fromField = row?.days_to_expiry
  if (fromField != null && fromField !== '') {
    const n = Number(fromField)
    if (Number.isFinite(n)) return n
  }
  const exp = row?.expiry_date
  if (!exp) return null
  const m = String(exp).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const expiry = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  expiry.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((expiry.getTime() - today.getTime()) / 86400000)
}
