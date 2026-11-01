const PREFIX = 'quantgems_warrant_watchlist_v1'

function userKey(user) {
  const id = user?.id || user?.user_id || user?.email || user?.username || 'guest'
  return `${PREFIX}:${String(id).trim() || 'guest'}`
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase()
}

export function readWarrantWatchlist(user) {
  try {
    const raw = localStorage.getItem(userKey(user))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.map(normalizeCode).filter(Boolean))]
  } catch {
    return []
  }
}

export function writeWarrantWatchlist(user, codes) {
  const next = [...new Set((codes || []).map(normalizeCode).filter(Boolean))]
  try {
    localStorage.setItem(userKey(user), JSON.stringify(next))
  } catch {
    /* quota / private mode */
  }
  return next
}

export function isWarrantWatchlisted(user, code) {
  const needle = normalizeCode(code)
  if (!needle) return false
  return readWarrantWatchlist(user).includes(needle)
}

export function toggleWarrantWatchlist(user, code, maxPerGroup = 20) {
  const needle = normalizeCode(code)
  if (!needle) return { ok: false, codes: readWarrantWatchlist(user), error: '沒有權證代號' }
  const current = readWarrantWatchlist(user)
  const exists = current.includes(needle)
  if (exists) {
    const codes = writeWarrantWatchlist(user, current.filter((c) => c !== needle))
    return { ok: true, added: false, codes }
  }
  const cap = Number(maxPerGroup)
  const limit = Number.isFinite(cap) && cap > 0 ? cap : 20
  if (current.length >= limit) {
    return {
      ok: false,
      added: false,
      codes: current,
      error: `自選股已達上限 ${limit} 檔`,
    }
  }
  const codes = writeWarrantWatchlist(user, [...current, needle])
  return { ok: true, added: true, codes }
}
