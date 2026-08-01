/** 主檔查詢：預設只含未到期（剩餘天數 ≥ 0），除非使用者已設到期相關條件 */

export function hasExplicitExpiryFilter(filters) {
  return (filters?.daysMin !== '' && filters?.daysMin != null)
    || (filters?.daysMax !== '' && filters?.daysMax != null)
    || !!filters?.expiryFrom
    || !!filters?.expiryTo
}

export function resolveUnexpiredMasterFilters(filters) {
  if (!filters || hasExplicitExpiryFilter(filters)) return filters
  return { ...filters, daysMin: '0' }
}

export function buildMasterSearchParams(filters, numOrUndef, {
  page = 1,
  pageSize = 50,
  sort,
  sortDir,
} = {}) {
  const f = resolveUnexpiredMasterFilters(filters)
  const sortKey = sort ?? f.sort ?? 'expiry'
  return {
    q: f.q || undefined,
    market: f.market,
    type: f.type || undefined,
    expiryFrom: f.expiryFrom || undefined,
    expiryTo: f.expiryTo || undefined,
    closeMin: numOrUndef(f.closeMin),
    closeMax: numOrUndef(f.closeMax),
    exerciseMin: numOrUndef(f.exerciseMin),
    exerciseMax: numOrUndef(f.exerciseMax),
    ratioMin: numOrUndef(f.ratioMin),
    ratioMax: numOrUndef(f.ratioMax),
    volumeMin: numOrUndef(f.volumeMin),
    volumeMax: numOrUndef(f.volumeMax),
    daysMin: numOrUndef(f.daysMin),
    daysMax: numOrUndef(f.daysMax),
    sort: sortKey === 'grade' ? 'expiry' : sortKey,
    sortDir: sortDir ?? f.sortDir ?? 'asc',
    page,
    pageSize,
  }
}
