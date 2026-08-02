/** 自訂權證 A/B/C 評等（成交量／行使比／到期日／技術面） */

export const GRADE_RATIO_MIN = 0.08
export const GRADE_RATIO_MAX = 0.85

export const GRADE_DIMENSIONS = [
  { key: 'volume', label: '成交量' },
  { key: 'ratio', label: '行使比' },
  { key: 'expiry', label: '到期日（剩餘天數）' },
  { key: 'technical', label: '技術面（日線）' },
]

/** 評等矩陣：供 UI 顯示 */
export const WARRANT_GRADE_MATRIX = {
  A: {
    label: 'A',
    title: 'A 級（佳）',
    volume: '達標（量能充足）',
    ratio: '達標（理想區間）',
    expiry: '剩餘 14～240 日',
    technical: '至少 1 項成立（小不點／神奇K／5均>10均）',
  },
  B: {
    label: 'B',
    title: 'B 級（可）',
    volume: '達標（有基本量能）',
    ratio: '達標（理想區間）',
    expiry: '剩餘 7～365 日',
    technical: '不要求，但其他三項須達標',
  },
  C: {
    label: 'C',
    title: 'C 級（觀察）',
    volume: '未達 B',
    ratio: '未達標',
    expiry: '剩餘天數過短或過長',
    technical: '技術面未達 A 標準',
  },
}

/** @deprecated 改用 GRADE_DIMENSIONS + WARRANT_GRADE_MATRIX */
export const WARRANT_GRADE_CRITERIA = {
  A: {
    label: 'A',
    title: WARRANT_GRADE_MATRIX.A.title,
    rules: GRADE_DIMENSIONS.map((d) => `${d.label}：${WARRANT_GRADE_MATRIX.A[d.key]}`),
  },
  B: {
    label: 'B',
    title: WARRANT_GRADE_MATRIX.B.title,
    rules: GRADE_DIMENSIONS.map((d) => `${d.label}：${WARRANT_GRADE_MATRIX.B[d.key]}`),
  },
  C: {
    label: 'C',
    title: WARRANT_GRADE_MATRIX.C.title,
    rules: GRADE_DIMENSIONS.map((d) => `${d.label}：${WARRANT_GRADE_MATRIX.C[d.key]}`),
  },
}

const TA_LABELS = {
  reversalFirstRed: '小不點第一根紅',
  heikinFirstRed: '神奇K線第一根紅',
  ma5gtMa10: '5均>10均',
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function inRange(n, min, max) {
  if (n == null) return false
  return n >= min && n <= max
}

function parseIsoDate(s) {
  if (!s || typeof s !== 'string') return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function resolveRemainingDays(row) {
  const fromField = num(row?.days_to_expiry)
  if (fromField != null) return fromField
  const exp = parseIsoDate(row?.expiry_date)
  if (!exp) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((exp.getTime() - today.getTime()) / 86400000)
}

export function ratioInGradeRange(row) {
  const ratio = num(row?.latest_exercise_ratio)
  if (ratio == null) return false
  return ratio >= GRADE_RATIO_MIN && ratio <= GRADE_RATIO_MAX
}

export function countTaSignals(signals) {
  if (!signals || typeof signals !== 'object') return 0
  return [
    signals.reversalFirstRed,
    signals.heikinFirstRed,
    signals.ma5gtMa10,
  ].filter(Boolean).length
}

export function hasAnyTaSignal(signals) {
  return countTaSignals(signals) > 0
}

export function listTaSignalLabels(signals) {
  if (!signals) return []
  return Object.entries(TA_LABELS)
    .filter(([key]) => signals[key])
    .map(([, label]) => label)
}

function dimChecks(row, taSignals) {
  const volume = num(row?.volume)
  const days = resolveRemainingDays(row)
  const taCount = countTaSignals(taSignals)
  const ratioOk = ratioInGradeRange(row)

  return {
    volume,
    days,
    taCount,
    ratioOk,
    volumeA: volume != null && volume >= 300,
    volumeB: volume != null && volume >= 100,
    expiryA: inRange(days, 14, 240),
    expiryB: inRange(days, 7, 365),
    technicalA: taCount >= 1,
  }
}

/**
 * @param {object} row
 * @param {{ taSignals?: object }} [opts]
 * @returns {'A'|'B'|'C'|null}
 */
export function gradeWarrant(row, { taSignals } = {}) {
  if (!row) return null

  const bars = num(row.bar_count)
  const d = dimChecks(row, taSignals)

  if (d.volumeA && d.ratioOk && d.expiryA && d.technicalA) {
    return 'A'
  }

  if (d.volumeB && d.ratioOk && d.expiryB) {
    return 'B'
  }

  if (bars != null && bars > 0) return 'C'
  if (d.volume != null || d.days != null) return 'C'
  return null
}

/** 供結果表 tooltip／詳情 */
export function buildGradeDetail(row, { taSignals } = {}) {
  const d = dimChecks(row, taSignals)
  const taHits = listTaSignalLabels(taSignals)
  return {
    volume: d.volumeA || d.volumeB ? '達標' : '未達標',
    volumeOk: d.volumeA || d.volumeB,
    volumeAOk: d.volumeA,
    ratio: d.ratioOk ? '達標' : '未達標',
    ratioOk: d.ratioOk,
    expiry: d.days != null ? `剩餘 ${d.days} 日` : (row?.expiry_date || '—'),
    expiryOk: d.expiryA || d.expiryB,
    expiryAOk: d.expiryA,
    days: d.days,
    technical: taHits.length ? taHits.join('、') : '未符合',
    technicalOk: d.technicalA,
    taHits,
  }
}

/** 評等選股時可套用的 API 預篩（使用者已填的條件優先） */
export function gradeApiPrefilters(gradeFilter) {
  if (gradeFilter === 'A') {
    return {
      volumeMin: 300,
      ratioMin: GRADE_RATIO_MIN,
      ratioMax: GRADE_RATIO_MAX,
      daysMin: 14,
      daysMax: 240,
    }
  }
  if (gradeFilter === 'B') {
    return {
      volumeMin: 100,
      ratioMin: GRADE_RATIO_MIN,
      ratioMax: GRADE_RATIO_MAX,
      daysMin: 7,
      daysMax: 365,
    }
  }
  return {}
}

export function gradeLabel(grade) {
  if (grade === 'A') return 'A 級'
  if (grade === 'B') return 'B 級'
  if (grade === 'C') return 'C 級'
  return '—'
}
