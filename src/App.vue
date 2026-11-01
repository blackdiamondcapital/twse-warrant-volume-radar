<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import {
  fetchPortalStats,
  fetchMasterSearch,
  fetchMasterDetail,
  fetchDates,
  fetchRankings,
  fetchTimeseries,
  fetchTaScreen,
  importLatestWarrants,
} from './api'
import { fetchStockPriceHistory } from './services/api.js'
import { buildOAuthStartUrl } from './lib/oauthStart'
import { useAuth } from './lib/auth'
import MasterScreener from './components/MasterScreener.vue'
import RankingPanel from './components/RankingPanel.vue'
import WarrantWatchlist from './components/WarrantWatchlist.vue'
import WarrantReturnRanking from './components/WarrantReturnRanking.vue'
import StockChartECharts from './components/StockChartECharts.vue'
import PwaInstallPrompt from './components/PwaInstallPrompt.vue'
import { exportMasterToExcel, fetchMasterRowsUpTo } from './utils/exportMasterExcel.js'
import { exportHeatToExcel } from './utils/exportHeatExcel.js'
import { excelDownloadStatus } from './utils/downloadExcel.js'
import { buildMasterSearchParams } from './utils/masterSearchParams.js'
import { filterMasterRowsByQuery, isCodeLikeMasterQuery, buildStockCodeLookupFilters } from './utils/masterSearchMatch.js'
import { filterMasterRowsClient, TA_FULL_MARKET_SCAN_CAP, TA_SCOPED_SCAN_CAP, TA_BACKEND_CLIENT_CAP } from './utils/taScreenFilter.js'
import { isUnexpiredWarrant, computeChangeFromBars } from './utils/warrantDisplay.js'
import { hasActiveTaFilters, hasBackendTaFilters, hasClientOnlyTaFilters, pickClientOnlyTaFilters } from './lib/taScreenRules.js'
import { getCarouselLimitForUser, getWatchlistLimitsForUser } from './utils/planAccess.js'
import { readWarrantWatchlist, toggleWarrantWatchlist } from './utils/warrantWatchlist.js'

const {
  isAuthenticated,
  displayName,
  planLabel,
  isAdmin,
  user,
  setToken,
  fetchCurrentUser,
  logout,
  consumeOAuthCallbackFromUrl,
} = useAuth()

const authStatus = ref('')

function handleGoogleLogin() {
  const url = buildOAuthStartUrl('google')
  window.location.href = url
}

async function handleLogout() {
  try {
    // 登出後關閉技術分析全螢幕
    if (chartFullscreen.value) {
      document.exitFullscreen?.().catch?.(() => {})
      chartFullscreen.value = false
    }
  } catch {
    /* ignore */
  }
  await logout()
  authStatus.value = '已登出'
  statusText.value = '已登出，技術分析需重新登入後才能查看'
}

const stats = ref(null)
const statusText = ref('')
const importing = ref(false)

const filters = reactive({
  q: '',
  market: 'both',
  type: '',
  expiryFrom: '',
  expiryTo: '',
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
  sort: 'expiry',
  sortDir: 'asc',
  page: 1,
  pageSize: 50,
})

const MASTER_SORT_OPTIONS = [
  { key: 'expiry', label: '到期日' },
  { key: 'volume', label: '成交量' },
  { key: 'exercise', label: '履約價' },
  { key: 'days', label: '剩餘天數' },
  { key: 'close', label: '收盤' },
]

function sortNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function rowChangePctForSort(row) {
  const fromApi = sortNum(row?.change_pct)
  if (fromApi != null) return fromApi
  const chg = sortNum(row?.price_change)
  const close = sortNum(row?.close_price)
  if (chg == null || close == null) return null
  const ref = close - chg
  if (!ref) return null
  return (chg / ref) * 100
}

function applyMasterSort(rows) {
  if (!rows?.length) return rows
  const dir = filters.sortDir === 'desc' ? -1 : 1
  const key = filters.sort
  return [...rows].sort((a, b) => {
    if (key === 'code') {
      return String(a.warrant_code || '').localeCompare(String(b.warrant_code || '')) * dir
    }
    if (key === 'name') {
      return String(a.warrant_name || '').localeCompare(String(b.warrant_name || '')) * dir
    }
    if (key === 'underlying') {
      const ua = String(a.underlying_code || a.underlying_name || '')
      const ub = String(b.underlying_code || b.underlying_name || '')
      return ua.localeCompare(ub) * dir
    }
    if (key === 'volume') {
      return ((sortNum(a.volume) ?? -1) - (sortNum(b.volume) ?? -1)) * dir
    }
    if (key === 'days') {
      return ((sortNum(a.days_to_expiry) ?? 99999) - (sortNum(b.days_to_expiry) ?? 99999)) * dir
    }
    if (key === 'close') {
      return ((sortNum(a.close_price) ?? -1) - (sortNum(b.close_price) ?? -1)) * dir
    }
    if (key === 'price_change' || key === 'change') {
      return ((sortNum(a.price_change) ?? -1e18) - (sortNum(b.price_change) ?? -1e18)) * dir
    }
    if (key === 'change_pct') {
      return ((rowChangePctForSort(a) ?? -1e18) - (rowChangePctForSort(b) ?? -1e18)) * dir
    }
    if (key === 'exercise') {
      return ((sortNum(a.latest_exercise_price) ?? -1) - (sortNum(b.latest_exercise_price) ?? -1)) * dir
    }
    return String(a.expiry_date || '').localeCompare(String(b.expiry_date || '')) * dir
  })
}

function defaultMasterSortDir(key) {
  if (key === 'code' || key === 'name' || key === 'underlying' || key === 'expiry') return 'asc'
  return 'desc'
}

function setMasterSort(key) {
  const normalized = key === 'change' ? 'price_change' : key
  if (filters.sort === normalized) {
    filters.sortDir = filters.sortDir === 'asc' ? 'desc' : 'asc'
  } else {
    filters.sort = normalized
    filters.sortDir = defaultMasterSortDir(normalized)
  }
  filters.page = 1
  if (clientFilterActive.value) {
    stopCarouselTimer()
    carouselPlaying.value = false
    taFilteredRows.value = applyMasterSort(taFilteredRows.value)
    paginateClientFilteredRows(1)
    void syncMasterCarouselRows()
    return
  }
  loadMaster()
}

function sortDirLabel() {
  return filters.sortDir === 'asc' ? '升冪 ↑' : '降冪 ↓'
}

let masterLoadRequestId = 0

const taFilters = reactive({
  heikinFirstRed: false,
  ma5gtMa10: false,
  duoKongCrossUp: false,
})

const masterRows = ref([])
const masterTotal = ref(0)
const taFilteredRows = ref([])
const clientFilterActive = ref(false)

function usesClientSideMasterResults() {
  return clientFilterActive.value
}

function clientFilterStatusLabel(filteredCount, page) {
  const parts = []
  if (hasActiveTaFilters(taFilters)) parts.push('技術')
  const tag = parts.length ? parts.join('＋') : '篩選'
  return `符合 ${filteredCount.toLocaleString()} 檔（${tag}）· 第 ${page} 頁`
}

function paginateClientFilteredRows(page) {
  const start = (page - 1) * filters.pageSize
  masterRows.value = taFilteredRows.value.slice(start, start + filters.pageSize)
  statusText.value = clientFilterStatusLabel(masterTotal.value, page)
  scheduleMasterPriceEnrich()
}
const loadingMaster = ref(false)
const masterScreenerOpen = ref(true)
const showMasterResults = ref(false)
const exportingMaster = ref(false)
/** Excel 匯出：false=僅個股，true=含加權／台指等指數類 */
const masterExportIncludeIndex = ref(false)
const heatSectionOpen = ref(true)
/** 當日熱度：日期 chip 預設收合，避免大量交易日換行佔滿版面 */
const heatDatesOpen = ref(false)
const exportingHeat = ref(false)
/** 站內選單：heat／screener／watchlist／ranking 皆為權證引擎功能 */
const engineView = ref('heat')
const ENGINE_VIEWS = ['heat', 'screener', 'watchlist', 'ranking']
const watchlistTick = ref(0)
const watchlistCodes = computed(() => {
  watchlistTick.value
  return readWarrantWatchlist(user.value)
})

const dates = ref([])
const selectedDate = ref('')
const heatMarket = ref('both')
const heatType = ref('') // '' | '認購' | '認售'
const metric = ref('turnover')
const rankings = ref([])
const loadingRankings = ref(false)

const selected = ref(null)
const detail = ref(null)
const loadingDetail = ref(false)
const techChartRef = ref(null)
const chartFullscreen = ref(false)

const masterCarouselRows = ref([])
const carouselIndex = ref(0)
const carouselPlaying = ref(false)
const CAROUSEL_INTERVAL_MS = 8000
let carouselTimer = null

const masterCarouselEnabled = computed(() =>
  showMasterResults.value && masterCarouselRows.value.length > 1,
)

const carouselCurrentRow = computed(() =>
  masterCarouselRows.value[carouselIndex.value] || null,
)

function stopCarouselTimer() {
  if (carouselTimer) {
    clearInterval(carouselTimer)
    carouselTimer = null
  }
}

function startCarouselTimer() {
  stopCarouselTimer()
  if (masterCarouselRows.value.length <= 1) return
  carouselTimer = setInterval(() => {
    void goCarouselIndex(carouselIndex.value + 1, { openChart: chartFullscreen.value })
  }, CAROUSEL_INTERVAL_MS)
}

async function syncMasterCarouselRows() {
  stopCarouselTimer()
  carouselPlaying.value = false

  if (!masterTotal.value) {
    masterCarouselRows.value = []
    carouselIndex.value = 0
    return
  }

  const limit = Math.max(getCarouselLimitForUser(user.value, 'watchlist'), 2)
  let rows = []

  if (clientFilterActive.value && taFilteredRows.value.length) {
    rows = taFilteredRows.value
  } else if (masterTotal.value <= filters.pageSize) {
    rows = masterRows.value
  } else {
    try {
      rows = await fetchMasterRowsUpTo(filters, numOrUndef, limit)
    } catch {
      rows = masterRows.value
    }
  }

  masterCarouselRows.value = rows.slice(0, limit)

  if (selected.value?.warrant_code) {
    const idx = masterCarouselRows.value.findIndex(
      (r) => r.warrant_code === selected.value.warrant_code,
    )
    carouselIndex.value = idx >= 0 ? idx : 0
  } else {
    carouselIndex.value = 0
  }
}

async function goCarouselIndex(nextIndex, { openChart = false } = {}) {
  const len = masterCarouselRows.value.length
  if (!len) return
  const idx = ((nextIndex % len) + len) % len
  carouselIndex.value = idx
  await selectWarrant(masterCarouselRows.value[idx], { openChart })
}

function onCarouselPrev() {
  void goCarouselIndex(carouselIndex.value - 1, { openChart: chartFullscreen.value })
}

function onCarouselNext() {
  void goCarouselIndex(carouselIndex.value + 1, { openChart: chartFullscreen.value })
}

function onCarouselToggle() {
  carouselPlaying.value = !carouselPlaying.value
  if (carouselPlaying.value) startCarouselTimer()
  else stopCarouselTimer()
}

async function startMasterCarousel() {
  if (!masterCarouselRows.value.length) return
  if (!requireLoginForChart()) return
  carouselIndex.value = 0
  await selectWarrant(masterCarouselRows.value[0], { openChart: true })
  carouselPlaying.value = true
  startCarouselTimer()
}

async function openCarouselChart() {
  if (!carouselCurrentRow.value) return
  if (!requireLoginForChart()) return
  await selectWarrant(carouselCurrentRow.value, { openChart: true })
}

async function loadStats() {
  try {
    stats.value = await fetchPortalStats()
  } catch (err) {
    console.error(err)
    statusText.value = `統計載入失敗：${err.message}`
  }
}

/** 全市場最新成交日：取上市／上櫃兩者較新者（勿只用 TWSE，否則上櫃較新時會顯示過舊） */
const latestTradeDate = computed(() => {
  const a = stats.value?.twse?.latest_trade_date
  const b = stats.value?.tpex?.latest_trade_date
  if (a && b) return a >= b ? a : b
  return a || b || '—'
})

const heatSummaryLabel = computed(() => {
  if (loadingRankings.value) return '載入中…'
  const parts = []
  if (selectedDate.value) parts.push(selectedDate.value)
  if (rankings.value.length) parts.push(`${rankings.value.length} 檔`)
  else if (rankingsError.value) parts.push('無資料')
  return parts.join(' · ') || '—'
})

const masterSearchSummary = computed(() => {
  const parts = []
  if (filters.q?.trim()) parts.push(`關鍵字「${filters.q.trim()}」`)
  if (filters.type) parts.push(filters.type)
  const ratioMin = numOrUndef(filters.ratioMin)
  const ratioMax = numOrUndef(filters.ratioMax)
  if (ratioMin != null || ratioMax != null) {
    const lo = ratioMin ?? '—'
    const hi = ratioMax ?? '—'
    parts.push(`行使比例 ${lo}–${hi}`)
  }
  const ta = []
  if (taFilters.heikinFirstRed) ta.push('神奇K線第一根紅')
  if (taFilters.ma5gtMa10) ta.push('5均>10均')
  if (taFilters.duoKongCrossUp) ta.push('剛站上多空線')
  if (ta.length) parts.push(ta.join('＋'))
  if (ta.length) parts.unshift('日線')
  return parts.length ? parts.join(' · ') : '全部未到期權證'
})

const resultsMetaLabel = computed(() => {
  if (exportingMaster.value) return statusText.value || '匯出 Excel 中…'
  if (loadingMaster.value) return '載入中…'
  if (masterTotal.value > 0) return `符合 ${masterTotal.value.toLocaleString()} 檔 · ${masterSearchSummary.value}`
  if (statusText.value) return statusText.value
  return masterSearchSummary.value
})

const canExportMasterResults = computed(() => masterTotal.value > 0)

function numOrUndef(v) {
  if (v === '' || v == null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function keepUnexpiredRows(rows) {
  return (rows || []).filter(isUnexpiredWarrant)
}

function hasSearchScope() {
  return !!(
    filters.q?.trim()
    || filters.type
    || filters.expiryFrom
    || filters.expiryTo
    || filters.closeMin
    || filters.closeMax
    || filters.exerciseMin
    || filters.exerciseMax
    || filters.ratioMin
    || filters.ratioMax
    || filters.volumeMin
    || filters.volumeMax
    || filters.daysMin
    || filters.daysMax
  )
}

async function loadMaster() {
  const loadRequestId = ++masterLoadRequestId
  loadingMaster.value = true
  try {
    const scoped = hasSearchScope()
    const wantClientFilter = hasActiveTaFilters(taFilters)
    const codeQuery = isCodeLikeMasterQuery(filters.q)

    // 標的／權證代號：優先精確比對（不受技術面篩選路徑影響）
    if (codeQuery) {
      statusText.value = '載入當頁代號結果…'
      const lookupFilters = buildStockCodeLookupFilters(filters)
      const data = await fetchMasterSearch(buildMasterSearchParams(lookupFilters, numOrUndef, {
        page: filters.page,
        pageSize: filters.pageSize,
        sort: filters.sort,
        sortDir: filters.sortDir,
      }))
      if (loadRequestId !== masterLoadRequestId) return
      const rows = filterMasterRowsByQuery(keepUnexpiredRows(data.data || []), filters.q)
      taFilteredRows.value = []
      masterRows.value = rows
      masterTotal.value = Number(data.total) || rows.length
      clientFilterActive.value = false
      scheduleMasterPriceEnrich()
      const qLabel = String(filters.q).trim()
      const doneLabel = rows.length
        ? `標的／代號「${qLabel}」符合 ${masterTotal.value.toLocaleString()} 檔 · 第 ${filters.page} 頁`
        : `標的／代號「${qLabel}」沒有符合的未到期權證（可先按「清除基本面條件」再搜）`
      statusText.value = doneLabel
      return
    }

    if (wantClientFilter) {
      const fullMarket = wantClientFilter && !scoped
      const sortKey = filters.sort || 'volume'
      let rows = []
      let candidates = 0
      let elapsedMs = null

      if (hasBackendTaFilters(taFilters)) {
        statusText.value = fullMarket ? '後端全市場技術掃描中…' : '後端技術面篩選中…'
        const taScreenCap = hasClientOnlyTaFilters(taFilters) ? TA_BACKEND_CLIENT_CAP : 5000
        const data = await fetchTaScreen({
          ...buildMasterSearchParams(filters, numOrUndef, {
            page: 1,
            pageSize: taScreenCap,
            sort: sortKey,
            sortDir: filters.sortDir || 'desc',
          }),
          ma5gtMa10: taFilters.ma5gtMa10 ? 1 : undefined,
          heikinFirstRed: taFilters.heikinFirstRed ? 1 : undefined,
        })
        rows = applyMasterSort(
          filterMasterRowsByQuery(keepUnexpiredRows(data.data || []), filters.q),
        )
        candidates = Number(data.candidates || rows.length)
        elapsedMs = data.elapsedMs
      } else {
        const scanCap = fullMarket ? TA_FULL_MARKET_SCAN_CAP : TA_SCOPED_SCAN_CAP
        statusText.value = fullMarket
          ? `載入成交量前 ${scanCap.toLocaleString()} 檔…`
          : '載入候選主檔…'
        const raw = await fetchMasterRowsUpTo(
          { ...filters, sort: sortKey, sortDir: filters.sortDir || 'desc' },
          numOrUndef,
          scanCap,
        )
        rows = applyMasterSort(filterMasterRowsByQuery(keepUnexpiredRows(raw), filters.q))
        candidates = rows.length
      }

      if (hasClientOnlyTaFilters(taFilters)) {
        const clientTa = pickClientOnlyTaFilters(taFilters)
        statusText.value = '技術面逐檔比對中…'
        rows = await filterMasterRowsClient(rows, {
          taFilters: clientTa,
          onProgress: ({ done, total, matched }) => {
            statusText.value = `技術面比對… ${done.toLocaleString()} / ${total.toLocaleString()} 檔（符合 ${matched.toLocaleString()}）`
          },
        })
      }
      if (loadRequestId !== masterLoadRequestId) return
      taFilteredRows.value = rows
      masterTotal.value = rows.length
      clientFilterActive.value = true
      const page = Math.max(1, filters.page)
      paginateClientFilteredRows(page)
      const sec = elapsedMs != null ? ` · ${(Number(elapsedMs) / 1000).toFixed(1)}s` : ''
      const scopeLabel = fullMarket ? `全市場（成交量前 ${TA_FULL_MARKET_SCAN_CAP.toLocaleString()} 檔）` : '條件範圍'
      statusText.value = `${scopeLabel}技術篩選完成：符合 ${masterTotal.value.toLocaleString()} 檔（候選 ${candidates.toLocaleString()}）${sec}`
      return
    }

    taFilteredRows.value = []
    clientFilterActive.value = false
    const data = await fetchMasterSearch(buildMasterSearchParams(filters, numOrUndef, {
      page: filters.page,
      pageSize: filters.pageSize,
      sort: filters.sort,
      sortDir: filters.sortDir,
    }))
    if (loadRequestId !== masterLoadRequestId) return
    masterRows.value = keepUnexpiredRows(data.data || [])
    masterTotal.value = data.total || 0
    statusText.value = `未到期主檔 ${data.total?.toLocaleString?.() || 0} 檔 · 顯示第 ${data.page} 頁`
    scheduleMasterPriceEnrich()
  } catch (err) {
    if (loadRequestId !== masterLoadRequestId) return
    console.error(err)
    masterRows.value = []
    masterTotal.value = 0
    statusText.value = `主檔查詢失敗：${err.message}`
  } finally {
    if (loadRequestId === masterLoadRequestId) {
      loadingMaster.value = false
      if (masterTotal.value > 0) void syncMasterCarouselRows()
      else {
        masterCarouselRows.value = []
        carouselIndex.value = 0
        stopCarouselTimer()
        carouselPlaying.value = false
      }
    }
  }
}

async function loadDates() {
  try {
    const list = await fetchDates(120, heatMarket.value)
    dates.value = list
    if (list.length && !selectedDate.value) selectedDate.value = list[0]
  } catch (err) {
    console.error(err)
  }
}

let rankingsReqId = 0
const rankingsMeta = ref({ kind: 'all', type: null })
const rankingsError = ref('')

function heatTypeToKind(v) {
  if (v === '認購') return 'call'
  if (v === '認售') return 'put'
  return 'all'
}

function setHeatType(next) {
  heatType.value = next
  loadRankings()
}

function setHeatMarket(next) {
  heatMarket.value = next
}

function setHeatDate(next) {
  selectedDate.value = next
  heatDatesOpen.value = false
  loadRankings()
}

function toggleHeatDates() {
  heatDatesOpen.value = !heatDatesOpen.value
}

function setMetric(next) {
  metric.value = next
  loadRankings()
}

function rankingHasChange(row) {
  return row?.price_change != null || row?.change_pct != null
}

function shiftIsoDate(iso, days) {
  const raw = String(iso || '').slice(0, 10)
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  dt.setUTCDate(dt.getUTCDate() + days)
  const y = dt.getUTCFullYear()
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

async function mapPool(items, limit, fn) {
  if (!items.length) return
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++
      await fn(items[idx], idx)
    }
  }
  const n = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: n }, () => worker()))
}

function scheduleMasterPriceEnrich() {
  const rows = masterRows.value
  if (!rows?.length) return
  void enrichMasterPriceChange(rows, masterLoadRequestId)
}

async function enrichMasterPriceChange(rows, loadRequestId) {
  const need = (rows || []).filter((row) => {
    if (!row?.warrant_code) return false
    if (!rankingHasChange(row)) return true
    const chg = Number(row.price_change)
    const pct = Number(row.change_pct)
    return (row.price_change == null || chg === 0) && (row.change_pct == null || pct === 0)
  })
  if (!need.length) return
  await mapPool(need, 8, async (row) => {
    if (loadRequestId !== masterLoadRequestId) return
    const end = String(row.latest_trade_date || '').slice(0, 10)
    if (!end) return
    const start = shiftIsoDate(end, -21)
    try {
      const data = await fetchTimeseries({
        code: row.warrant_code,
        start: start || undefined,
        end: end || undefined,
        limitDays: 12,
      })
      const next = computeChangeFromBars(data?.data || data?.rows || [], end)
      if (next.price_change == null && next.change_pct == null) return
      if (loadRequestId !== masterLoadRequestId) return
      const idx = masterRows.value.findIndex(
        (item) => item.warrant_code === row.warrant_code && item.market === row.market,
      )
      if (idx < 0) return
      const current = masterRows.value[idx]
      if (rankingHasChange(current) && Number(current.price_change) !== 0) return
      masterRows.value[idx] = { ...current, ...next }
    } catch {
      /* 單檔失敗不擋整表 */
    }
  })
}

async function enrichRankingPriceChange(rows, tradeDate, reqId) {
  const need = (rows || []).filter((row) => {
    if (!row?.warrant_code) return false
    if (!rankingHasChange(row)) return true
    const chg = Number(row.price_change)
    const pct = Number(row.change_pct)
    return (row.price_change == null || chg === 0) && (row.change_pct == null || pct === 0)
  })
  if (!need.length) return
  const end = String(tradeDate || '').slice(0, 10)
  const start = shiftIsoDate(end, -21)
  await mapPool(need, 8, async (row) => {
    if (reqId !== rankingsReqId) return
    try {
      const data = await fetchTimeseries({
        code: row.warrant_code,
        start: start || undefined,
        end: end || undefined,
        limitDays: 12,
      })
      const next = computeChangeFromBars(data?.data || data?.rows || [], end)
      if (next.price_change == null && next.change_pct == null) return
      if (reqId !== rankingsReqId) return
      const idx = rankings.value.findIndex(
        (item) => item.warrant_code === row.warrant_code && item.market === row.market,
      )
      if (idx < 0) return
      const current = rankings.value[idx]
      if (rankingHasChange(current)) return
      rankings.value[idx] = { ...current, ...next }
    } catch {
      /* 單檔失敗不擋整表 */
    }
  })
}

async function loadRankings() {
  const reqId = ++rankingsReqId
  const expectedKind = heatTypeToKind(heatType.value)
  const expectedType = heatType.value || null
  loadingRankings.value = true
  rankingsError.value = ''
  try {
    const requestOnce = async (dateOverride) =>
      fetchRankings({
        date: dateOverride,
        metric: metric.value,
        market: heatMarket.value,
        type: expectedKind === 'all' ? '' : expectedKind,
        limit: 100,
      })

    let data = await requestOnce(selectedDate.value || undefined)
    if (reqId === rankingsReqId && !(data.rows || []).length && selectedDate.value) {
      data = await requestOnce(undefined)
      if (data.date) selectedDate.value = data.date
    }
    if (reqId !== rankingsReqId) return

    const rows = (data.rows || []).map((r, i) => ({ ...r, rank: r.rank ?? i + 1 }))
    rankings.value = rows
    rankingsMeta.value = { kind: data.kind || expectedKind, type: data.type || expectedType }
    if (data.date) selectedDate.value = data.date
    if (!rows.length) {
      rankingsError.value = expectedType
        ? `沒有「${expectedType}」成交熱度（${data.date || selectedDate.value || '—'}）`
        : `沒有成交資料（日期 ${data.date || selectedDate.value || '—'}）`
    } else {
      const missingChange = rows.some((row) => !rankingHasChange(row))
      const allFlatZero = rows.every((row) => {
        const chg = Number(row.price_change)
        const pct = Number(row.change_pct)
        return (row.price_change == null || chg === 0) && (row.change_pct == null || pct === 0)
      })
      if (missingChange || allFlatZero) {
        void enrichRankingPriceChange(rows, data.date || selectedDate.value, reqId)
      }
    }
  } catch (err) {
    if (reqId !== rankingsReqId) return
    console.error(err)
    rankings.value = []
    rankingsError.value = err.message || '排行查詢失敗'
    statusText.value = `排行失敗：${err.message}`
  } finally {
    if (reqId === rankingsReqId) loadingRankings.value = false
  }
}

function requireLoginForChart() {
  if (isAuthenticated.value) return true
  authStatus.value = '技術分析需先登入（Google）'
  statusText.value = '技術分析需先登入後才能查看'
  return false
}

async function selectWarrant(row, { openChart = true } = {}) {
  if (!row?.warrant_code) return
  const idx = masterCarouselRows.value.findIndex((r) => r.warrant_code === row.warrant_code)
  if (idx >= 0) carouselIndex.value = idx
  selected.value = row
  loadingDetail.value = true
  try {
    const detailResp = await fetchMasterDetail(row.warrant_code).catch(() => null)
    detail.value = detailResp?.data || {
      market: row.market,
      warrant_code: row.warrant_code,
      warrant_name: row.warrant_name,
      warrant_type: row.warrant_type,
      underlying_name: row.underlying_name,
      underlying_code: row.underlying_code,
      latest_exercise_price: row.latest_exercise_price,
      latest_exercise_ratio: row.latest_exercise_ratio,
      expiry_date: row.expiry_date,
      days_to_expiry: row.days_to_expiry,
      issuance: row.issuance,
      close_price: row.close_price,
      latest_close_price: row.close_price,
      volume: row.volume,
    }
    // 主檔列表已有的行情欄位併入詳情，供全螢幕基本資料列顯示
    if (detail.value && row) {
      detail.value = {
        ...detail.value,
        close_price: detail.value.close_price ?? row.close_price,
        latest_close_price: detail.value.latest_close_price ?? row.close_price,
        days_to_expiry: detail.value.days_to_expiry ?? row.days_to_expiry,
        volume: detail.value.volume ?? row.volume,
      }
    }
    // 主檔 API 常回 null 收盤價；改以日線最後一根有效 K 補齊
    if (detail.value?.latest_close_price == null && detail.value?.close_price == null) {
      try {
        const hist = await fetchStockPriceHistory(row.warrant_code, '1D')
        const last = hist.length ? hist[hist.length - 1] : null
        if (last?.close != null) {
          detail.value = {
            ...detail.value,
            close_price: last.close,
            latest_close_price: last.close,
            latest_trade_date: detail.value.latest_trade_date || last.time,
          }
        }
      } catch {
        /* ignore */
      }
    }
    await nextTick()
    if (openChart) openTechChartOrLogin()
  } catch (err) {
    console.error(err)
    statusText.value = `載入詳情失敗：${err.message}`
  } finally {
    loadingDetail.value = false
  }
}

function onChartFullscreenChange(active) {
  chartFullscreen.value = !!active
  if (!active) {
    stopCarouselTimer()
    carouselPlaying.value = false
  }
}

function openTechChart() {
  if (!requireLoginForChart()) return
  techChartRef.value?.enterFullscreen?.()
}

function openTechChartOrLogin() {
  if (!requireLoginForChart()) return
  nextTick(() => {
    techChartRef.value?.enterFullscreen?.()
  })
}

function setEngineView(view) {
  if (!ENGINE_VIEWS.includes(view)) return
  engineView.value = view
  window.scrollTo({ top: 0, behavior: 'smooth' })
  if (view === 'screener' && !showMasterResults.value && masterScreenerOpen.value) {
    loadMaster()
  }
}

function onToggleWatchlist(row) {
  const code = row?.warrant_code
  if (!code) return
  const limits = getWatchlistLimitsForUser(user.value)
  const res = toggleWarrantWatchlist(user.value, code, limits.maxPerGroup)
  if (!res.ok) {
    statusText.value = res.error || '自選股更新失敗'
    return
  }
  watchlistTick.value += 1
}

async function onSearch() {
  filters.page = 1
  masterScreenerOpen.value = true
  engineView.value = 'screener'
  showMasterResults.value = true
  await nextTick()
  window.scrollTo({ top: 0, behavior: 'smooth' })
  await loadMaster()
}

function backToSearch() {
  showMasterResults.value = false
  stopCarouselTimer()
  carouselPlaying.value = false
  masterCarouselRows.value = []
  carouselIndex.value = 0
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function selectMasterWarrant(row) {
  masterScreenerOpen.value = true
  await selectWarrant(row)
}

function setMasterType(type) {
  filters.type = type
}

async function setMasterTypeAndSearch(type) {
  filters.type = type
  if (showMasterResults.value) {
    await onSearch()
  }
}

async function onExportMaster() {
  exportingMaster.value = true
  const includeIndex = masterExportIncludeIndex.value
  const scopeLabel = includeIndex ? '未到期權證（含指數類）' : '未到期個股權證'
  statusText.value = '請選擇儲存位置（預設桌面）…'
  try {
    let presetRows = null
    if (clientFilterActive.value && taFilteredRows.value.length) {
      presetRows = taFilteredRows.value
    } else if (masterTotal.value > 0 && masterTotal.value <= filters.pageSize) {
      presetRows = masterRows.value
    }
    const { count, method } = await exportMasterToExcel(filters, numOrUndef, {
      rows: presetRows || undefined,
      compact: true,
      individualStockOnly: !includeIndex,
      unexpiredOnly: true,
      onProgress: ({ phase, loaded, scanned }) => {
        if (phase === 'load') {
          const excluded = !includeIndex ? Math.max(0, (scanned || 0) - (loaded || 0)) : 0
          const suffix = excluded > 0
            ? `（已排除指數類 ${excluded.toLocaleString()} 檔）`
            : ''
          statusText.value = `已選位置，載入${scopeLabel}… ${loaded.toLocaleString()} 檔${suffix}`
        }
      },
    })
    statusText.value = excelDownloadStatus(method, count, includeIndex ? 'all' : 'individual')
  } catch (err) {
    console.error(err)
    if (err?.name === 'AbortError') {
      statusText.value = '已取消匯出'
    } else {
      statusText.value = `Excel 匯出失敗：${err.message}`
    }
  } finally {
    exportingMaster.value = false
  }
}

function toggleMasterScreener() {
  const opening = !masterScreenerOpen.value
  masterScreenerOpen.value = opening
  if (opening) loadMaster()
}

function toggleHeatSection() {
  heatSectionOpen.value = !heatSectionOpen.value
}

async function onExportHeat() {
  exportingHeat.value = true
  statusText.value = '請選擇儲存位置（預設桌面）…'
  try {
    const { count, method } = await exportHeatToExcel(rankings.value, {
      tradeDate: selectedDate.value,
      onProgress: ({ phase, done, total }) => {
        if (phase === 'master') {
          statusText.value = `熱度 Excel：補齊主檔… ${done.toLocaleString()} / ${total.toLocaleString()} 檔`
        }
      },
    })
    statusText.value = excelDownloadStatus(method, count)
  } catch (err) {
    if (err?.name === 'AbortError') {
      statusText.value = '已取消匯出'
    } else {
      statusText.value = err.message || '熱度匯出失敗'
    }
  } finally {
    exportingHeat.value = false
  }
}

function toggleTaFilter(key) {
  taFilters[key] = !taFilters[key]
}

function clearTaFilters() {
  taFilters.heikinFirstRed = false
  taFilters.ma5gtMa10 = false
  taFilters.duoKongCrossUp = false
  filters.page = 1
  if (showMasterResults.value) loadMaster()
}

function clearFundamentalFilters() {
  filters.expiryFrom = ''
  filters.expiryTo = ''
  filters.closeMin = ''
  filters.closeMax = ''
  filters.exerciseMin = ''
  filters.exerciseMax = ''
  filters.ratioMin = ''
  filters.ratioMax = ''
  filters.volumeMin = ''
  filters.volumeMax = ''
  filters.daysMin = ''
  filters.daysMax = ''
  filters.page = 1
  if (showMasterResults.value) loadMaster()
}

function onPage(p) {
  filters.page = p
  if (usesClientSideMasterResults()) {
    paginateClientFilteredRows(p)
    return
  }
  loadMaster()
}

async function onImportLatest() {
  if (!isAdmin.value) {
    statusText.value = '更新資料僅限管理員'
    return
  }
  importing.value = true
  statusText.value = '正在同步上市 MI_INDEX 與上櫃日行情…'
  try {
    const resp = await importLatestWarrants()
    statusText.value = `${resp.message || '匯入完成'}`
    await loadDates()
    await loadRankings()
    await loadStats()
  } catch (err) {
    statusText.value = `匯入失敗：${err.message}`
  } finally {
    importing.value = false
  }
}

watch(heatMarket, async () => {
  selectedDate.value = ''
  await loadDates()
  await loadRankings()
})

onMounted(async () => {
  const oauth = consumeOAuthCallbackFromUrl()
  if (oauth.error) {
    authStatus.value = `登入失敗：${oauth.error}`
  } else if (oauth.token) {
    setToken(oauth.token)
    const me = await fetchCurrentUser()
    authStatus.value = me.success ? `已用 Google 登入（${planLabel.value}）` : (me.error || '登入狀態同步失敗')
  } else if (isAuthenticated.value && !user.value) {
    await fetchCurrentUser()
  }

  await Promise.all([loadStats(), loadDates()])
  await loadRankings()
  if (engineView.value === 'screener' && masterScreenerOpen.value && !showMasterResults.value) {
    await loadMaster()
  }
})

onUnmounted(() => {
  stopCarouselTimer()
})
</script>

<template>
  <div class="app" :class="{ 'app--results': engineView === 'screener' && showMasterResults }">
    <PwaInstallPrompt />
    <div class="topbar">
      <div class="home-link" aria-label="QuantGems 權證引擎">
        <span class="home-link-brand">QuantGems®</span>
        <span class="home-link-tag">
          <span class="home-link-site">權證引擎</span>
        </span>
      </div>
      <div class="auth-box">
        <template v-if="isAuthenticated">
          <span class="auth-user">
            <span class="auth-name" :title="displayName">{{ displayName }}</span>
            <span class="plan-pill">{{ planLabel }}</span>
          </span>
          <a
            class="btn-auth subscribe"
            href="https://www.quantgems.com/pricing"
            target="_blank"
            rel="noopener noreferrer"
          >訂閱</a>
          <button type="button" class="btn-auth ghost" @click="handleLogout">登出</button>
        </template>
        <template v-else>
          <a
            class="btn-auth subscribe"
            href="https://www.quantgems.com/pricing"
            target="_blank"
            rel="noopener noreferrer"
          >訂閱</a>
          <button type="button" class="btn-auth google" @click="handleGoogleLogin">
            <svg class="g-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Google 登入
          </button>
        </template>
      </div>
    </div>
    <p v-if="authStatus && !(engineView === 'screener' && showMasterResults)" class="auth-status muted">{{ authStatus }}</p>

    <nav class="engine-nav" aria-label="權證引擎選單">
      <div class="engine-nav-inner">
        <button
          type="button"
          class="nav-item"
          :class="{ active: engineView === 'heat' }"
          @click="setEngineView('heat')"
        >
          <i class="fas fa-fire-alt" aria-hidden="true"></i>
          當日熱度
        </button>
        <button
          type="button"
          class="nav-item"
          :class="{ active: engineView === 'screener' }"
          @click="setEngineView('screener')"
        >
          <i class="fas fa-filter" aria-hidden="true"></i>
          權證總覽
        </button>
        <button
          type="button"
          class="nav-item"
          :class="{ active: engineView === 'watchlist' }"
          @click="setEngineView('watchlist')"
        >
          <i class="fas fa-star" aria-hidden="true"></i>
          自選股
        </button>
        <button
          type="button"
          class="nav-item"
          :class="{ active: engineView === 'ranking' }"
          @click="setEngineView('ranking')"
        >
          <i class="fas fa-trophy" aria-hidden="true"></i>
          報酬排行
        </button>
      </div>
    </nav>

    <template v-if="engineView === 'heat' || (engineView === 'screener' && !showMasterResults)">
    <header class="hero">
      <p class="lede">從權證總覽篩選全市場標的，追蹤當日成交熱度，並以全螢幕技術分析檢視單檔走勢。</p>
      <p v-if="stats" class="hero-stats">
        <span class="stat"><span class="label">主檔歷史總數</span><strong>{{ stats.total_master?.toLocaleString?.() }}</strong></span>
        <span class="stat-sep" aria-hidden="true">·</span>
        <span class="stat"><span class="label">上市</span><strong>{{ stats.twse?.master_total?.toLocaleString?.() }}</strong></span>
        <span class="stat-sep" aria-hidden="true">·</span>
        <span class="stat"><span class="label">上櫃</span><strong>{{ stats.tpex?.master_total?.toLocaleString?.() }}</strong></span>
        <span class="stat-sep" aria-hidden="true">·</span>
        <span class="stat"><span class="label">最新成交日</span><strong>{{ latestTradeDate }}</strong></span>
      </p>
    </header>
    </template>

    <section v-if="engineView === 'heat'" class="heat-section">
      <div class="heat-head-row panel">
        <button
          type="button"
          class="heat-head toggle"
          :aria-expanded="heatSectionOpen"
          :aria-label="heatSectionOpen ? '收合當日熱度' : '展開當日熱度'"
          @click="toggleHeatSection"
        >
          <div class="heat-head-main">
            <i class="fas fa-fire-alt heat-head-icon" aria-hidden="true"></i>
            <h2>當日熱度</h2>
            <span class="muted">{{ heatSummaryLabel }}</span>
          </div>
          <span class="chev" aria-hidden="true">
            <span class="chev-label">{{ heatSectionOpen ? '收合' : '展開' }}</span>
            <span class="chev-icon">{{ heatSectionOpen ? '▾' : '▸' }}</span>
          </span>
        </button>
        <button
          type="button"
          class="export-btn"
          title="匯出目前熱度排行（最多 100 檔）含完整欄位，可另存至桌面"
          :disabled="exportingHeat || loadingRankings || !rankings.length"
          @click.stop="onExportHeat"
        >
          {{ exportingHeat ? '匯出中…' : '下載 Excel' }}
        </button>
      </div>

      <div v-show="heatSectionOpen">
        <div class="heat-toolbar panel">
          <div class="heat-rows">
            <div class="heat-row heat-row--dates" :class="{ 'is-dates-open': heatDatesOpen }">
              <span class="heat-row-label">日期</span>
              <div class="heat-dates-wrap">
                <button
                  type="button"
                  class="heat-dates-toggle"
                  :aria-expanded="heatDatesOpen"
                  :aria-label="heatDatesOpen ? '收合日期選單' : '展開日期選單'"
                  @click="toggleHeatDates"
                >
                  <span class="heat-dates-current mono">{{ selectedDate || '—' }}</span>
                  <span class="chev" aria-hidden="true">
                    <span class="chev-label">{{ heatDatesOpen ? '收合' : '選擇' }}</span>
                    <span class="chev-icon">{{ heatDatesOpen ? '▾' : '▸' }}</span>
                  </span>
                </button>
                <div
                  v-show="heatDatesOpen"
                  class="chip-scroll heat-date-scroll ranking-period-toggle"
                >
                  <button
                    v-for="d in dates"
                    :key="d"
                    type="button"
                    class="chip-btn period-chip"
                    :class="{ active: selectedDate === d }"
                    @click="setHeatDate(d)"
                  >{{ d }}</button>
                </div>
              </div>
            </div>
            <div class="heat-row heat-row--controls">
              <span class="heat-row-label">市場</span>
              <div class="chip-btns ranking-period-toggle">
                <button type="button" class="chip-btn period-chip" :class="{ active: heatMarket === 'both' }" @click="setHeatMarket('both')">全市場</button>
                <button type="button" class="chip-btn period-chip" :class="{ active: heatMarket === 'twse' }" @click="setHeatMarket('twse')">上市</button>
                <button type="button" class="chip-btn period-chip" :class="{ active: heatMarket === 'tpex' }" @click="setHeatMarket('tpex')">上櫃</button>
              </div>
              <span class="heat-row-label">類型</span>
              <div class="chip-btns ranking-type-toggle">
                <button type="button" class="chip-btn ranking-type-chip" :class="{ active: heatType === '' }" @click="setHeatType('')">全部</button>
                <button type="button" class="chip-btn ranking-type-chip" :class="{ active: heatType === '認購' }" @click="setHeatType('認購')">認購</button>
                <button type="button" class="chip-btn ranking-type-chip" :class="{ active: heatType === '認售' }" @click="setHeatType('認售')">認售</button>
              </div>
              <span class="heat-row-label">指標</span>
              <div class="chip-btns ranking-period-toggle">
                <button type="button" class="chip-btn period-chip" :class="{ active: metric === 'turnover' }" @click="setMetric('turnover')">成交金額</button>
                <button type="button" class="chip-btn period-chip" :class="{ active: metric === 'volume' }" @click="setMetric('volume')">成交張數</button>
              </div>
            </div>
          </div>
        </div>

        <RankingPanel
          :rows="rankings"
          :loading="loadingRankings"
          :selected-code="selected?.warrant_code || ''"
          :metric="metric"
          :heat-type="heatType"
          :api-type="rankingsMeta.type"
          :error-text="rankingsError"
          :trade-date="selectedDate"
          :starred-codes="watchlistCodes"
          @select="selectWarrant"
          @toggle-star="onToggleWatchlist"
        />
      </div>
    </section>

    <template v-if="engineView === 'screener' && !showMasterResults">
    <section class="search-bar panel">
      <div class="search-main">
        <div class="step-head">
          <span class="step-num">01</span>
          <h3>搜尋標的</h3>
        </div>
        <label>股票代號／權證代號／名稱</label>
        <input
          v-model="filters.q"
          placeholder="標的 4 碼：2330、5274｜權證：703349、03002T｜名稱：金像電"
          @keyup.enter="onSearch"
        />
        <div class="type-toggle ranking-type-toggle">
          <div class="btns">
            <button type="button" class="ranking-type-chip" :class="{ active: filters.type === '' }" @click="setMasterType('')">全部</button>
            <button type="button" class="ranking-type-chip" :class="{ active: filters.type === '認購' }" @click="setMasterType('認購')">認購</button>
            <button type="button" class="ranking-type-chip" :class="{ active: filters.type === '認售' }" @click="setMasterType('認售')">認售</button>
          </div>
        </div>
      </div>

      <div class="fund-block">
        <div class="fund-head step-head">
          <span class="step-num">02</span>
          <h3>基本面</h3>
        </div>
        <div class="fund-grid">
          <div class="range-field">
            <label>收盤</label>
            <input v-model="filters.closeMin" type="number" step="any" min="0" placeholder="低" />
            <span class="sep">–</span>
            <input v-model="filters.closeMax" type="number" step="any" min="0" placeholder="高" />
          </div>
          <div class="range-field range-field--exercise">
            <label>履約價</label>
            <input v-model="filters.exerciseMin" type="number" step="any" min="0" placeholder="低" />
            <span class="sep">–</span>
            <input v-model="filters.exerciseMax" type="number" step="any" min="0" placeholder="高" />
          </div>
          <div class="range-field range-field--ratio">
            <label>行使比例</label>
            <input v-model="filters.ratioMin" type="number" step="any" min="0" placeholder="低" />
            <span class="sep">–</span>
            <input v-model="filters.ratioMax" type="number" step="any" min="0" placeholder="高" />
          </div>
          <div class="range-field range-field--days">
            <label>剩餘天數</label>
            <input v-model="filters.daysMin" type="number" step="1" min="0" placeholder="低" />
            <span class="sep">–</span>
            <input v-model="filters.daysMax" type="number" step="1" min="0" placeholder="高" />
          </div>
          <div class="range-field range-field--date">
            <label>到期日</label>
            <input v-model="filters.expiryFrom" type="date" />
            <span class="sep">–</span>
            <input v-model="filters.expiryTo" type="date" />
          </div>
        </div>
      </div>

      <div class="fund-block ta-block">
        <div class="fund-head ta-head step-head">
          <span class="step-num">03</span>
          <h3>技術面</h3>
          <span class="ta-period-badge">日線</span>
        </div>
        <p class="ta-hint muted">未填標的時掃成交量前 600 檔。剛站上多空線：Hull 週期 45；神奇K／5均&gt;10均由後端篩選。</p>
        <div class="ta-chip-row ranking-period-toggle">
          <button
            type="button"
            class="chip-btn"
            :class="{ active: taFilters.duoKongCrossUp }"
            title="最新收盤站上多空線（週期 45），且前一日收在線下或貼線"
            @click="toggleTaFilter('duoKongCrossUp')"
          >剛站上多空線</button>
          <button
            type="button"
            class="chip-btn"
            :class="{ active: taFilters.heikinFirstRed }"
            @click="toggleTaFilter('heikinFirstRed')"
          >神奇K線第一根紅</button>
          <button
            type="button"
            class="chip-btn"
            :class="{ active: taFilters.ma5gtMa10 }"
            @click="toggleTaFilter('ma5gtMa10')"
          >5均 &gt; 10均</button>
        </div>
      </div>

      <div class="actions">
        <button type="button" class="primary" :disabled="loadingMaster" @click="onSearch">
          {{ loadingMaster ? '搜尋中…' : '搜尋權證' }}
        </button>
        <button
          v-if="isAdmin"
          type="button"
          class="primary btn-update-data"
          :disabled="importing"
          @click="onImportLatest"
        >
          {{ importing ? '更新中…' : '更新資料' }}
        </button>
        <button type="button" class="btn-clear-sm" @click="clearFundamentalFilters">清除基本面條件</button>
        <button
          type="button"
          class="btn-clear-sm"
          @click="clearTaFilters"
        >清除技術面</button>
      </div>
    </section>

    <p v-if="statusText" class="status muted">{{ statusText }}</p>

    <div class="workspace">
      <MasterScreener
        :rows="masterRows"
        :total="masterTotal"
        :stats-total="stats?.total_master || 0"
        :page="filters.page"
        :page-size="filters.pageSize"
        :loading="loadingMaster"
        :exporting="exportingMaster"
        :export-include-index="masterExportIncludeIndex"
        :selected-code="selected?.warrant_code || ''"
        :sort="filters.sort"
        :sort-dir="filters.sortDir"
        :open="masterScreenerOpen"
        :starred-codes="watchlistCodes"
        @select="selectMasterWarrant"
        @sort="setMasterSort"
        @page="onPage"
        @toggle="toggleMasterScreener"
        @export="onExportMaster"
        @update:export-include-index="masterExportIncludeIndex = $event"
        @toggle-star="onToggleWatchlist"
      />
    </div>
    </template>

    <template v-else-if="engineView === 'screener'">
      <section class="results-page">
        <div class="results-toolbar panel">
          <div class="results-toolbar-row results-toolbar-row--main">
            <button type="button" class="back-btn" @click="backToSearch">← 返回</button>
            <span class="results-meta muted" :title="resultsMetaLabel">{{ resultsMetaLabel }}</span>
            <div class="results-export-scope">
              <button
                type="button"
                :class="{ active: !masterExportIncludeIndex }"
                @click="masterExportIncludeIndex = false"
              >個股</button>
              <button
                type="button"
                :class="{ active: masterExportIncludeIndex }"
                @click="masterExportIncludeIndex = true"
              >含指數</button>
            </div>
            <button
              type="button"
              class="results-export-btn"
              :class="{ 'results-export-btn--ready': canExportMasterResults && !exportingMaster && !loadingMaster }"
              :disabled="exportingMaster || loadingMaster || !canExportMasterResults"
              :title="masterExportIncludeIndex ? '匯出未到期權證（含加權／台指等指數類）' : '匯出未到期個股權證'"
              @click="onExportMaster"
            >
              {{ exportingMaster ? '匯出中…' : 'Excel' }}
            </button>
          </div>
          <div class="results-toolbar-row results-toolbar-row--search">
            <input
              v-model="filters.q"
              class="results-search-input"
              placeholder="2330、5274、703349、金像電"
              @keyup.enter="onSearch"
            />
            <button type="button" class="primary results-search-btn" :disabled="loadingMaster" @click="onSearch">
              {{ loadingMaster ? '…' : '搜尋' }}
            </button>
            <div class="results-type-chips ranking-type-toggle">
              <button type="button" :class="{ active: filters.type === '' }" @click="setMasterTypeAndSearch('')">全部</button>
              <button type="button" :class="{ active: filters.type === '認購' }" @click="setMasterTypeAndSearch('認購')">認購</button>
              <button type="button" :class="{ active: filters.type === '認售' }" @click="setMasterTypeAndSearch('認售')">認售</button>
            </div>
          </div>
          <div v-if="masterTotal > 0" class="results-toolbar-row results-toolbar-row--sort">
            <span class="results-sort-label">排序</span>
            <div class="results-sort-chips ranking-period-toggle">
              <button
                v-for="opt in MASTER_SORT_OPTIONS"
                :key="opt.key"
                type="button"
                class="chip-btn"
                :class="{ active: filters.sort === opt.key }"
                @click="setMasterSort(opt.key)"
              >{{ opt.label }}</button>
              <button type="button" class="chip-btn sort-dir-btn" @click="setMasterSort(filters.sort)">
                {{ sortDirLabel() }}
              </button>
            </div>
          </div>
        </div>

        <MasterScreener
          results-mode
          :rows="masterRows"
          :total="masterTotal"
          :stats-total="stats?.total_master || 0"
          :page="filters.page"
          :page-size="filters.pageSize"
          :loading="loadingMaster"
          :exporting="exportingMaster"
          :export-include-index="masterExportIncludeIndex"
          :selected-code="selected?.warrant_code || ''"
          :sort="filters.sort"
          :sort-dir="filters.sortDir"
          :open="true"
          :starred-codes="watchlistCodes"
          @select="selectMasterWarrant"
          @sort="setMasterSort"
          @page="onPage"
          @export="onExportMaster"
          @update:export-include-index="masterExportIncludeIndex = $event"
          @toggle-star="onToggleWatchlist"
        />

        <div v-if="masterCarouselEnabled" class="carousel-bar panel carousel-bar--mobile">
          <div class="carousel-bar-main">
            <span class="carousel-indicator">
              輪播 {{ carouselIndex + 1 }} / {{ masterCarouselRows.length }}
            </span>
            <p v-if="carouselCurrentRow" class="carousel-current">
              <span class="mono">{{ carouselCurrentRow.warrant_code }}</span>
              {{ carouselCurrentRow.warrant_name }}
            </p>
          </div>
          <div class="carousel-btns">
            <button type="button" class="carousel-btn" @click="onCarouselPrev">上一檔</button>
            <button
              type="button"
              class="carousel-btn carousel-btn--play"
              :class="{ active: carouselPlaying }"
              @click="onCarouselToggle"
            >{{ carouselPlaying ? '暫停' : '播放' }}</button>
            <button type="button" class="carousel-btn" @click="onCarouselNext">下一檔</button>
            <button type="button" class="carousel-btn carousel-btn--chart" @click="openCarouselChart">
              全螢幕圖
            </button>
            <button type="button" class="carousel-btn carousel-btn--start" @click="startMasterCarousel">
              開始輪播
            </button>
          </div>
        </div>
      </section>
    </template>

    <WarrantWatchlist
      v-if="engineView === 'watchlist'"
      :user="user"
      :codes="watchlistCodes"
      :selected-code="selected?.warrant_code || ''"
      @select="selectWarrant"
      @changed="watchlistTick += 1"
    />

    <WarrantReturnRanking
      v-if="engineView === 'ranking'"
      :selected-code="selected?.warrant_code || ''"
      :starred-codes="watchlistCodes"
      @select="selectWarrant"
      @toggle-star="onToggleWatchlist"
    />

    <div class="chart-host" aria-hidden="true">
      <StockChartECharts
        v-if="isAuthenticated"
        ref="techChartRef"
        class="warrant-stock-chart"
        :symbol="selected?.warrant_code || ''"
        :stock-name="selected?.warrant_name || ''"
        :warrant-info="detail"
        period="1D"
        :fullscreen-search-enabled="false"
        :carousel-enabled="masterCarouselEnabled"
        :carousel-index="carouselIndex"
        :carousel-length="masterCarouselRows.length"
        :carousel-playing="carouselPlaying"
        @carousel-prev="onCarouselPrev"
        @carousel-next="onCarouselNext"
        @carousel-toggle="onCarouselToggle"
        @fullscreen-change="onChartFullscreenChange"
      />
    </div>
  </div>
</template>

<style scoped>
.app {
  width: min(1280px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 0 0 3rem;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0 -1rem 0.95rem;
  padding: 0.65rem 1rem;
  min-width: 0;
  position: sticky;
  top: 0;
  z-index: 50;
  background: linear-gradient(180deg, rgba(6, 12, 22, 0.96) 0%, rgba(8, 12, 24, 0.92) 100%);
  border-bottom: 1px solid rgba(212, 175, 110, 0.16);
  backdrop-filter: blur(16px);
}
.home-link {
  display: inline-flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 10px;
  flex-shrink: 0;
  min-width: 0;
  font-size: 1.42rem;
  line-height: 1;
  color: #f7edd4;
}
.home-link-brand {
  font-size: inherit;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #f7edd4;
  text-shadow: 0 1px 0 rgba(255, 248, 230, 0.18);
  white-space: nowrap;
}
.home-link-tag {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: inherit;
  line-height: 1;
}
.home-link-tag::before {
  content: '';
  width: 1px;
  height: 0.85em;
  background: linear-gradient(180deg, rgba(232, 201, 138, 0), #e8c98a 40%, rgba(232, 201, 138, 0));
}
.home-link-site {
  font-size: 0.72em;
  font-weight: 650;
  letter-spacing: 0.22em;
  color: #e8c98a;
  white-space: nowrap;
}

.engine-nav {
  margin: -0.35rem -1rem 1rem;
  padding: 0 1rem;
  position: sticky;
  top: 52px;
  z-index: 45;
  background: linear-gradient(180deg, rgba(8, 12, 24, 0.94) 0%, rgba(6, 12, 22, 0.88) 100%);
  border-bottom: 1px solid rgba(212, 175, 110, 0.14);
  backdrop-filter: blur(14px);
}
.engine-nav-inner {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.engine-nav-inner::-webkit-scrollbar {
  display: none;
}
.engine-nav .nav-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
  padding: 0.55rem 0.9rem;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: rgba(232, 201, 138, 0.68);
  font-size: 0.88rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  box-shadow: none;
  white-space: nowrap;
  text-decoration: none;
}
.engine-nav .nav-item i {
  font-size: 0.9rem;
  color: inherit;
}
.engine-nav .nav-item::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(135deg, #e8c98a, #b08a4a);
  transform: translateX(-50%);
  transition: width 0.2s ease;
}
.engine-nav .nav-item:hover {
  color: #f7edd4;
  background: rgba(212, 175, 110, 0.08);
  border-color: transparent;
}
.engine-nav .nav-item.active {
  color: #f4e6c4;
  background: transparent;
  border-color: transparent;
}
.engine-nav .nav-item.active::after {
  width: calc(100% - 1.4rem);
}
.engine-nav .nav-item.active i {
  color: #e8c98a;
}
.auth-box {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  min-width: 0;
  flex: 1;
}
.auth-user {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.88rem;
  min-width: 0;
  max-width: 12rem;
}
.auth-name {
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.plan-pill {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  color: #1a140c;
  background: linear-gradient(180deg, #e8c98a, #b08a4a);
}
.btn-auth {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  font-size: 0.86rem;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-auth.google {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(66, 133, 244, 0.45);
  color: #e2e8f0;
}
.btn-auth.google:hover {
  border-color: #4285F4;
  background: rgba(66, 133, 244, 0.12);
}
.btn-auth.ghost {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--text-dim);
}
a.btn-auth {
  text-decoration: none;
}
.btn-auth.subscribe {
  background: rgba(212, 175, 110, 0.12);
  border: 1px solid rgba(212, 175, 110, 0.55);
  color: #f4e6c4;
}
.btn-auth.subscribe:hover {
  border-color: #e8c98a;
  background: rgba(212, 175, 110, 0.22);
  color: #fff8e8;
}
.g-icon { width: 16px; height: 16px; }
.auth-status {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.75rem;
  margin-bottom: 1.15rem;
  padding: 0.15rem 0 0.1rem;
  animation: rise 0.7s ease both;
}
.page-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.7rem 0.85rem;
}
.page-title i {
  font-size: 1.7rem;
  color: #e8c98a;
  filter: drop-shadow(0 0 8px rgba(212, 175, 110, 0.45));
}
.page-title h1 {
  margin: 0;
  font-size: clamp(1.45rem, 2.6vw, 1.75rem);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #f4e6c4;
  text-shadow: 0 0 16px rgba(212, 175, 110, 0.22);
}
.period-badge {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid rgba(212, 175, 110, 0.4);
  background: rgba(8, 15, 28, 0.55);
  color: #e8c98a;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.lede {
  margin: 0;
  color: var(--text-dim);
  max-width: 38rem;
  font-size: 0.95rem;
  line-height: 1.55;
}
.hero-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.55rem;
  margin: 0.65rem 0 0;
  color: var(--text-dim);
  font-size: 0.82rem;
  line-height: 1.5;
}
.stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
}
.stat-sep {
  color: rgba(148, 163, 184, 0.45);
  user-select: none;
}
.stat .label {
  color: var(--text-dim);
  font-size: 0.78rem;
}
.stat .label::after {
  content: '\00a0';
}
.stat strong {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.search-bar {
  display: grid;
  gap: 0.9rem;
  padding: 1rem 1.1rem 1.15rem;
  margin-bottom: 0.75rem;
  animation: rise 1s ease both;
}
.search-main label,
.filters label {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--text-muted);
  font-size: 0.82rem;
}
.search-main input {
  width: 100%;
  box-sizing: border-box;
}
.heat-section {
  display: grid;
  gap: 0.85rem;
  margin-bottom: 1rem;
  animation: rise 0.85s ease both;
}
.heat-head-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.65rem 1.1rem;
}
.heat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.heat-head.toggle:hover h2 {
  color: #f7edd4;
}
.heat-head-main {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
}
.heat-head-icon {
  color: #e8c98a;
  filter: drop-shadow(0 0 8px rgba(212, 175, 110, 0.4));
  font-size: 1.05rem;
}
.heat-head-main h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #f4e6c4;
  white-space: nowrap;
  flex-shrink: 0;
}
.heat-head-main .muted {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.heat-head .chev {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  color: var(--text-dim);
  font-size: 0.82rem;
  font-weight: 600;
  flex-shrink: 0;
  white-space: nowrap;
}
.heat-head .chev-label {
  letter-spacing: 0.02em;
}
.heat-head .chev-icon {
  font-size: 0.9rem;
  line-height: 1;
}
.export-btn {
  flex-shrink: 0;
  border: 1.5px solid rgba(212, 175, 110, 0.45);
  background:
    radial-gradient(circle at top left, rgba(212, 175, 110, 0.22), transparent 60%),
    linear-gradient(135deg, rgba(18, 27, 44, 0.95), rgba(8, 12, 22, 0.9));
  color: #f4e6c4;
  border-radius: 999px;
  padding: 0.4rem 0.85rem;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.export-btn:hover:not(:disabled) {
  border-color: rgba(232, 201, 138, 0.85);
  background:
    radial-gradient(circle at top left, rgba(212, 175, 110, 0.32), transparent 60%),
    linear-gradient(135deg, rgba(22, 32, 52, 0.98), rgba(8, 12, 22, 0.95));
  box-shadow: 0 0 18px rgba(212, 175, 110, 0.28);
}
.export-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.heat-toolbar {
  padding: 0.85rem 1rem 0.95rem;
}
.heat-rows {
  display: grid;
  gap: 0.55rem;
}
.heat-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}
.heat-row--controls {
  flex-wrap: wrap;
  row-gap: 0.45rem;
}
.heat-row-label {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 0.8rem;
  min-width: 2rem;
}
.heat-dates-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.4rem;
}
.heat-dates-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
  width: fit-content;
  max-width: 100%;
  padding: 0.28rem 0.65rem;
  border-radius: 12px;
  border: 1px solid rgba(212, 175, 110, 0.22);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.42) 0%, rgba(8, 15, 28, 0.88) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 248, 230, 0.08);
  cursor: pointer;
  text-align: left;
}
.heat-dates-toggle:hover {
  border-color: rgba(232, 201, 138, 0.45);
}
.heat-dates-current {
  color: #f4e6c4;
  font-size: 0.84rem;
  font-weight: 650;
  letter-spacing: 0.02em;
}
.heat-dates-toggle .chev {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  color: var(--text-dim);
  font-size: 0.78rem;
  font-weight: 600;
}
.heat-row--dates.is-dates-open {
  align-items: flex-start;
}
.chip-scroll {
  display: flex;
  gap: 0.35rem;
  overflow-x: auto;
  padding-bottom: 0.1rem;
  min-width: 0;
  flex: 1;
  scrollbar-width: thin;
}
.chip-scroll.heat-date-scroll.ranking-period-toggle {
  flex-wrap: nowrap;
  width: 100%;
}
.chip-scroll::-webkit-scrollbar {
  height: 4px;
}
.chip-btns {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip-btn,
.period-chip,
.ranking-type-chip {
  border: 1px solid transparent;
  background: transparent;
  color: rgba(232, 201, 138, 0.68);
  border-radius: 999px;
  padding: 0.28rem 0.72rem;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.chip-btn:hover,
.period-chip:hover,
.ranking-type-chip:hover {
  color: #f7edd4;
  background: rgba(212, 175, 110, 0.12);
}
.chip-btn.active,
.period-chip.active,
.ranking-type-chip.active {
  color: #1a140c;
  border-color: rgba(232, 201, 138, 0.9);
  background:
    radial-gradient(circle at top, rgba(232, 201, 138, 0.4), transparent 60%),
    linear-gradient(180deg, #e8c98a, #b08a4a);
  box-shadow: 0 6px 16px rgba(212, 175, 110, 0.28), inset 0 1px 0 rgba(255, 248, 230, 0.35);
}
.ranking-period-toggle,
.ranking-type-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 4px;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 110, 0.22);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.42) 0%, rgba(8, 15, 28, 0.88) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 248, 230, 0.08), 0 8px 22px rgba(0, 0, 0, 0.28);
}
.ranking-type-toggle .btns {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.type-toggle {
  margin-top: 0.55rem;
}
.type-toggle .btns {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.type-toggle .btns button {
  border: 1px solid transparent;
  background: transparent;
  color: rgba(232, 201, 138, 0.72);
  border-radius: 999px;
  padding: 0.28rem 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.type-toggle .btns button.active {
  color: #1a140c;
  border-color: rgba(232, 201, 138, 0.9);
  background: linear-gradient(180deg, #e8c98a, #b08a4a);
}
.filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}
.fund-block {
  border-top: 1px solid rgba(212, 175, 110, 0.14);
  padding-top: 0.7rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.75rem;
}
.step-head {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.step-num {
  font-family: Inter, "SF Pro Text", "PingFang TC", "Noto Sans TC", sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #1a140c;
  background: linear-gradient(180deg, #e8c98a, #b08a4a);
  border-radius: 999px;
  padding: 0.12rem 0.42rem;
  line-height: 1.2;
}
.fund-head h3,
.step-head h3 {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 650;
  color: #f3d9a4;
  white-space: nowrap;
}
.fund-grid {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.85rem;
  flex: 1;
  min-width: 0;
}
.range-field {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  flex: 0 0 auto;
}
.range-field label {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.84rem;
  white-space: nowrap;
}
.range-field .sep {
  color: var(--text-dim);
  font-size: 0.82rem;
  line-height: 1;
  user-select: none;
}
.range-field input {
  width: 4.25rem;
  min-width: 0;
  padding: 0.32rem 0.42rem;
  font-size: 0.86rem;
  border-radius: 6px;
  color: var(--text);
}
.range-field--exercise input {
  width: 5.85rem;
}
.range-field--ratio input {
  width: 3.6rem;
  padding: 0.32rem 0.35rem;
}
.range-field--volume input {
  width: 5.2rem;
}
.range-field--date input {
  width: 8.1rem;
  padding: 0.3rem 0.38rem;
  font-size: 0.84rem;
}
@media (max-width: 768px) {
  .fund-grid {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .fund-grid .range-field {
    width: 100%;
    flex-wrap: nowrap;
  }
}
@media (max-width: 980px) {
  .fund-grid .range-field--days {
    flex: 1 1 100%;
    width: 100%;
  }
}
.ta-block {
  border-top: 1px solid rgba(212, 175, 110, 0.14);
  padding-top: 0.7rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.75rem;
}
.ta-head {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.ta-period-badge {
  flex-shrink: 0;
  white-space: nowrap;
  writing-mode: horizontal-tb;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  color: #e8c98a;
  border: 1px solid rgba(212, 175, 110, 0.4);
  background: rgba(8, 15, 28, 0.55);
}
.ta-hint {
  flex: 1 1 100%;
  margin: -0.15rem 0 0.1rem;
  font-size: 0.76rem;
}
.ta-chip-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.55rem;
  flex: 1;
  min-width: 0;
}
.ta-chip-row .chip-btn {
  padding: 0.28rem 0.72rem;
  font-size: 0.82rem;
}
.ta-chip-row .chip-label-short {
  display: none;
}
.chip-clear {
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-size: 0.78rem;
  cursor: pointer;
  padding: 0.2rem 0.35rem;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.chip-clear:hover {
  color: #e8c98a;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
}
.actions .primary {
  min-height: 2.55rem;
  padding: 0.55rem 1.15rem;
  font-size: 0.95rem;
  font-weight: 650;
}
.btn-update-data {
  background: rgba(212, 175, 110, 0.12);
  color: #f4e6c4;
  border: 1px solid rgba(212, 175, 110, 0.45);
  box-shadow: none;
}
.btn-update-data:hover:not(:disabled) {
  border-color: rgba(232, 201, 138, 0.75);
  background: rgba(212, 175, 110, 0.2);
  color: #fff8e8;
}
.btn-clear-sm {
  font-size: 0.76rem;
  padding: 0.28rem 0.55rem;
  border-radius: 999px;
  color: var(--text);
  background: rgba(212, 175, 110, 0.06);
  border-color: rgba(212, 175, 110, 0.22);
  white-space: nowrap;
}
.btn-clear-sm:hover:not(:disabled) {
  color: #e8c98a;
  border-color: rgba(212, 175, 110, 0.45);
  background: rgba(212, 175, 110, 0.12);
  transform: none;
  box-shadow: none;
}
.status {
  margin: 0 0 1rem;
  min-height: 1.25rem;
  font-size: 0.9rem;
}
.app--results {
  padding-top: 0.35rem;
}
.app--results .topbar {
  margin-bottom: 0.4rem;
}
.results-page {
  display: grid;
  gap: 0.35rem;
  animation: rise 0.85s ease both;
}
.results-toolbar {
  position: sticky;
  top: 0;
  z-index: 40;
  display: grid;
  gap: 0.4rem;
  padding: 0.45rem 0.65rem;
  background: rgba(8, 12, 22, 0.94);
  backdrop-filter: blur(10px);
}
.results-toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
  min-width: 0;
}
.results-toolbar-row--main {
  gap: 0.45rem;
}
.results-meta {
  flex: 1;
  min-width: 0;
  font-size: 0.78rem;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.results-export-btn {
  flex-shrink: 0;
  border: 1.5px solid rgba(212, 175, 110, 0.45);
  background:
    radial-gradient(circle at top left, rgba(212, 175, 110, 0.22), transparent 60%),
    linear-gradient(135deg, rgba(18, 27, 44, 0.95), rgba(8, 12, 22, 0.9));
  color: #f4e6c4;
  border-radius: 999px;
  padding: 0.3rem 0.72rem;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.results-export-btn--ready {
  border-color: rgba(232, 201, 138, 0.75);
}
.results-export-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.results-export-scope {
  display: flex;
  gap: 0.28rem;
  flex-shrink: 0;
}
.results-export-scope button {
  border: 1px solid rgba(148, 183, 205, 0.28);
  background: rgba(7, 11, 20, 0.45);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 0.22rem 0.52rem;
  font-size: 0.72rem;
  cursor: pointer;
}
.results-export-scope button.active {
  color: #1a140c;
  border-color: rgba(232, 201, 138, 0.9);
  background: linear-gradient(180deg, #e8c98a, #b08a4a);
}
.results-toolbar-row--search {
  gap: 0.35rem;
}
.results-search-input {
  flex: 1 1 8rem;
  min-width: 0;
  padding: 0.36rem 0.55rem;
  border-radius: 7px;
  border: 1px solid rgba(0, 212, 255, 0.22);
  background: rgba(7, 11, 20, 0.55);
  color: var(--text);
  font-size: 0.84rem;
}
.results-search-btn {
  flex-shrink: 0;
  min-width: 3.2rem;
  padding: 0.36rem 0.7rem;
  font-size: 0.82rem;
}
.results-type-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.28rem;
}
.results-type-chips button {
  border: 1px solid rgba(148, 183, 205, 0.28);
  background: rgba(7, 11, 20, 0.45);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 0.22rem 0.58rem;
  font-size: 0.74rem;
  cursor: pointer;
}
.results-type-chips button.active {
  color: #1a140c;
  border-color: rgba(232, 201, 138, 0.9);
  background: linear-gradient(180deg, #e8c98a, #b08a4a);
}
.results-toolbar-row--sort {
  gap: 0.35rem 0.45rem;
}
.carousel-bar--mobile {
  position: relative;
}
.carousel-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem 1rem;
  padding: 0.75rem 1rem;
}
.results-sort {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.45rem;
  padding: 0;
}
.results-sort-label {
  font-size: 0.74rem;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.results-sort-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.28rem;
  flex: 1;
  min-width: 0;
}
.results-sort-chips .chip-btn {
  font-size: 0.74rem;
  padding: 0.22rem 0.52rem;
}
.sort-dir-btn {
  color: #e8c98a;
}
.carousel-bar-main {
  min-width: 0;
  flex: 1;
}
.carousel-indicator {
  font-size: 0.88rem;
  font-weight: 650;
  color: #e8c98a;
}
.carousel-current {
  margin: 0.25rem 0 0;
  font-size: 0.84rem;
  color: var(--text-muted);
  line-height: 1.35;
}
.carousel-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.carousel-btn {
  font-size: 0.78rem;
  padding: 0.32rem 0.62rem;
  border-radius: 999px;
  border: 1px solid rgba(212, 175, 110, 0.28);
  background: rgba(212, 175, 110, 0.06);
  color: var(--text);
  white-space: nowrap;
}
.carousel-btn:hover {
  border-color: rgba(232, 201, 138, 0.55);
  color: #f7edd4;
  background: rgba(212, 175, 110, 0.12);
}
.carousel-btn--play.active {
  color: #1a140c;
  border-color: rgba(232, 201, 138, 0.9);
  background: linear-gradient(180deg, #e8c98a, #b08a4a);
}
.carousel-btn--start {
  color: #e8c98a;
  font-weight: 650;
}
@media (max-width: 640px) {
  .home-link {
    font-size: 1.18rem;
    gap: 8px;
  }
  .home-link-site {
    letter-spacing: 0.14em;
  }
  .auth-box {
    gap: 0.35rem;
  }
  .auth-user {
    max-width: 6.5rem;
  }
  .auth-name {
    font-size: 0.8rem;
  }
  .btn-auth {
    padding: 0.38rem 0.62rem;
    font-size: 0.78rem;
  }
  .engine-nav {
    top: 48px;
    margin-bottom: 0.75rem;
  }
  .engine-nav .nav-item {
    padding: 0.48rem 0.75rem;
    font-size: 0.82rem;
  }
  .page-title h1 {
    letter-spacing: 0.06em;
  }
  .carousel-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .carousel-bar--mobile {
    position: relative;
    margin-top: 0.15rem;
    margin-bottom: 0.5rem;
  }
  .carousel-btns {
    justify-content: center;
  }
  .carousel-btn--chart,
  .carousel-btn--start {
    display: none;
  }
  .results-sort {
    flex-direction: column;
    align-items: stretch;
  }
  .results-sort-chips {
    justify-content: flex-start;
  }
  .heat-head-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.55rem;
  }
  .heat-head {
    width: 100%;
  }
  .heat-head-row > .export-btn {
    align-self: flex-end;
  }
  .heat-row--controls {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .heat-row--controls .chip-btns {
    width: 100%;
  }
  .ta-head {
    flex: 1 1 100%;
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
  }
  .ta-period-badge {
    order: -1;
  }
  .ta-chip-row {
    flex: 1 1 100%;
    flex-wrap: wrap;
    overflow-x: visible;
    padding-bottom: 0;
  }
  .ta-chip-row .chip-label-full {
    display: none;
  }
  .ta-chip-row .chip-label-short {
    display: inline;
  }
  .search-bar {
    padding: 0.75rem 0.65rem 0.85rem;
    gap: 0.65rem;
  }
  .search-main label {
    font-size: 0.76rem;
    margin-bottom: 0.22rem;
  }
  .search-main input {
    padding: 0.4rem 0.55rem;
    font-size: 0.82rem;
    border-radius: 6px;
  }
}
.back-btn {
  flex-shrink: 0;
  border: 1px solid rgba(148, 183, 205, 0.35);
  background: rgba(7, 11, 20, 0.85);
  color: var(--text-dim);
  border-radius: 7px;
  padding: 0.32rem 0.62rem;
  font-size: 0.78rem;
  cursor: pointer;
  position: relative;
  z-index: 1;
}
.back-btn:hover {
  border-color: rgba(232, 201, 138, 0.55);
  color: #e8c98a;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}
.col-main {
  display: grid;
  gap: 1rem;
}
.heat-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.65rem;
  align-items: stretch;
}
.chart-host {
  position: fixed;
  width: 0;
  height: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
.chart-host:has(.stock-chart.is-fullscreen) {
  opacity: 1;
  pointer-events: auto;
  width: 100vw;
  height: 100vh;
  overflow: visible;
}
.warrant-stock-chart {
  width: 1px;
  height: 1px;
}
:global(body.warrant-ta-fs),
:global(html.warrant-ta-fs) {
  overflow: hidden;
}

@keyframes rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes brand-spin {
  to { transform: rotate(360deg); }
}
@keyframes brand-pulse {
  0%, 100% { opacity: 0.45; transform: scale(0.96); }
  50% { opacity: 1; transform: scale(1.04); }
}
@keyframes brand-shine {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
@keyframes brand-accent-in {
  from { opacity: 0; transform: scaleX(0.35); }
  to { opacity: 1; transform: scaleX(1); }
}

@media (max-width: 980px) {
  .workspace,
  .filters {
    grid-template-columns: 1fr;
  }
  .heat-row--controls {
    gap: 0.35rem 0.55rem;
  }
}
</style>
