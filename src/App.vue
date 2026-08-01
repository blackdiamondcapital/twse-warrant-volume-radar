<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import {
  fetchPortalStats,
  fetchMasterSearch,
  fetchMasterDetail,
  fetchDates,
  fetchRankings,
  importLatestWarrants,
} from './api'
import { buildOAuthStartUrl } from './lib/oauthStart'
import { useAuth } from './lib/auth'
import MasterScreener from './components/MasterScreener.vue'
import RankingPanel from './components/RankingPanel.vue'
import StockChartECharts from './components/StockChartECharts.vue'
import PwaInstallPrompt from './components/PwaInstallPrompt.vue'
import { exportMasterToExcel, fetchAllMasterRows, fetchMasterRowsUpTo } from './utils/exportMasterExcel.js'
import { exportHeatToExcel } from './utils/exportHeatExcel.js'
import { excelDownloadStatus } from './utils/downloadExcel.js'
import { filterMasterRowsClient, needsClientSideMasterFilter } from './utils/taScreenFilter.js'
import { hasActiveTaFilters } from './lib/taScreenRules.js'
import { WARRANT_GRADE_MATRIX, GRADE_DIMENSIONS, gradeApiPrefilters } from './lib/warrantGrade.js'

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

const gradeMatrix = WARRANT_GRADE_MATRIX
const gradeDimensions = GRADE_DIMENSIONS.filter((d) => d.key === 'expiry' || d.key === 'technical')

function sortRowsByGrade(rows) {
  const order = { A: 0, B: 1, C: 2 }
  return [...rows].sort((a, b) => {
    const ga = order[a.warrant_grade] ?? 9
    const gb = order[b.warrant_grade] ?? 9
    if (ga !== gb) return ga - gb
    return String(a.warrant_code || '').localeCompare(String(b.warrant_code || ''))
  })
}

const taFilters = reactive({
  reversalFirstRed: false,
  heikinFirstRed: false,
  ma5gtMa10: false,
  duoKongTrendFirstRed: false,
})

/** '' | 'A' | 'B' | 'C' — 評等選股（需逐檔日線計算） */
const gradeFilter = ref('')

const masterRows = ref([])
const masterTotal = ref(0)
const taFilteredRows = ref([])
const clientFilterActive = ref(false)

function usesClientSideMasterResults() {
  return clientFilterActive.value
}

function clientFilterStatusLabel(filteredCount, page) {
  const parts = []
  if (gradeFilter.value) parts.push(`${gradeFilter.value} 級`)
  if (hasActiveTaFilters(taFilters)) parts.push('技術')
  const tag = parts.length ? parts.join('＋') : '篩選'
  return `符合 ${filteredCount.toLocaleString()} 檔（${tag}）· 第 ${page} 頁`
}

function filtersForClientFetch() {
  if (!gradeFilter.value) return filters
  const pref = gradeApiPrefilters(gradeFilter.value)
  const merged = { ...filters }
  for (const [key, val] of Object.entries(pref)) {
    if (merged[key] === '' || merged[key] == null) merged[key] = String(val)
  }
  return merged
}

function paginateClientFilteredRows(page) {
  const start = (page - 1) * filters.pageSize
  masterRows.value = taFilteredRows.value.slice(start, start + filters.pageSize)
  statusText.value = clientFilterStatusLabel(masterTotal.value, page)
}
const loadingMaster = ref(false)
const masterScreenerOpen = ref(false)
const showMasterResults = ref(false)
const exportingMaster = ref(false)
const heatSectionOpen = ref(false)
const exportingHeat = ref(false)

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
  if (taFilters.reversalFirstRed) ta.push('小不點第一根紅')
  if (taFilters.heikinFirstRed) ta.push('神奇K線第一根紅')
  if (taFilters.ma5gtMa10) ta.push('5均>10均')
  if (taFilters.duoKongTrendFirstRed) ta.push('多空趨勢線第一根紅')
  if (ta.length) parts.push(ta.join('＋'))
  if (ta.length) parts.unshift('日線')
  if (gradeFilter.value) parts.push(`${gradeFilter.value} 級選股`)
  return parts.length ? parts.join(' · ') : '全部未到期主檔'
})

function numOrUndef(v) {
  if (v === '' || v == null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** 有縮小範圍時才做逐檔評等（不掃描全市場） */
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
  loadingMaster.value = true
  try {
    const scoped = hasSearchScope()
    const wantClientFilter = hasActiveTaFilters(taFilters) || gradeFilter.value

    if (needsClientSideMasterFilter(taFilters, gradeFilter.value, { scopedSearch: scoped })) {
      statusText.value = gradeFilter.value
        ? `搜尋結果評等中（${gradeFilter.value} 級）…`
        : '搜尋結果技術分析中…'
      const allRows = await fetchAllMasterRows(
        gradeFilter.value ? filtersForClientFetch() : filters,
        numOrUndef,
        {
          onProgress: ({ loaded, total }) => {
            statusText.value = `載入搜尋結果 ${loaded.toLocaleString()} / ${total.toLocaleString()}…`
          },
        },
      )
      statusText.value = gradeFilter.value
        ? `${gradeFilter.value} 級評分中… 0 / ${allRows.length}`
        : `技術分析篩選中… 0 / ${allRows.length}`
      const filtered = sortRowsByGrade(await filterMasterRowsClient(allRows, {
        taFilters,
        gradeFilter: gradeFilter.value,
        onProgress: ({ done, total }) => {
          statusText.value = gradeFilter.value
            ? `${gradeFilter.value} 級評分 ${done} / ${total}…`
            : `技術分析篩選 ${done} / ${total}…`
        },
      }))
      taFilteredRows.value = filtered
      masterTotal.value = filtered.length
      clientFilterActive.value = true
      const page = Math.max(1, filters.page)
      paginateClientFilteredRows(page)
      return
    }

    if (wantClientFilter && !scoped) {
      statusText.value = '請先輸入標的／關鍵字或篩選條件（評等僅針對搜尋結果，不掃全市場）'
    }

    taFilteredRows.value = []
    clientFilterActive.value = false
    const data = await fetchMasterSearch({
      q: filters.q || undefined,
      market: filters.market,
      type: filters.type || undefined,
      expiryFrom: filters.expiryFrom || undefined,
      expiryTo: filters.expiryTo || undefined,
      closeMin: numOrUndef(filters.closeMin),
      closeMax: numOrUndef(filters.closeMax),
      exerciseMin: numOrUndef(filters.exerciseMin),
      exerciseMax: numOrUndef(filters.exerciseMax),
      ratioMin: numOrUndef(filters.ratioMin),
      ratioMax: numOrUndef(filters.ratioMax),
      volumeMin: numOrUndef(filters.volumeMin),
      volumeMax: numOrUndef(filters.volumeMax),
      daysMin: numOrUndef(filters.daysMin),
      daysMax: numOrUndef(filters.daysMax),
      sort: filters.sort,
      sortDir: filters.sortDir,
      page: filters.page,
      pageSize: filters.pageSize,
    })
    masterRows.value = data.data || []
    masterTotal.value = data.total || 0
    statusText.value = `主檔 ${data.total?.toLocaleString?.() || 0} 檔 · 顯示第 ${data.page} 頁`
  } catch (err) {
    console.error(err)
    masterRows.value = []
    masterTotal.value = 0
    statusText.value = `主檔查詢失敗：${err.message}`
  } finally {
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
  loadRankings()
}

function setMetric(next) {
  metric.value = next
  loadRankings()
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

async function onSearch() {
  filters.page = 1
  masterScreenerOpen.value = true
  await loadMaster()
  showMasterResults.value = true
  await nextTick()
  window.scrollTo({ top: 0, behavior: 'smooth' })
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
  onSearch()
}

async function onExportMaster() {
  exportingMaster.value = true
  statusText.value = '正在準備 Excel…'
  try {
    let presetRows = null
    if (clientFilterActive.value && taFilteredRows.value.length) {
      presetRows = taFilteredRows.value
    } else if (masterTotal.value > 0 && masterTotal.value <= filters.pageSize) {
      presetRows = masterRows.value
    }
    const { count, method } = await exportMasterToExcel(filters, numOrUndef, {
      rows: presetRows || undefined,
      onProgress: ({ loaded, total }) => {
        statusText.value = `匯出中… ${loaded.toLocaleString()} / ${total.toLocaleString()} 檔`
      },
    })
    statusText.value = excelDownloadStatus(method, count)
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
  statusText.value = '正在準備 Excel…'
  try {
    const { count, method } = await exportHeatToExcel(rankings.value, { tradeDate: selectedDate.value })
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

function setGradeFilter(grade) {
  gradeFilter.value = gradeFilter.value === grade ? '' : grade
  filters.page = 1
  if (showMasterResults.value) onSearch()
}

function clearTaFilters() {
  taFilters.reversalFirstRed = false
  taFilters.heikinFirstRed = false
  taFilters.ma5gtMa10 = false
  taFilters.duoKongTrendFirstRed = false
  filters.page = 1
  if (showMasterResults.value) loadMaster()
}

function clearGradeFilterOnly() {
  gradeFilter.value = ''
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
})

onUnmounted(() => {
  stopCarouselTimer()
})
</script>

<template>
  <div class="app">
    <PwaInstallPrompt />
    <div class="topbar">
      <a class="home-link" href="https://www.quantgems.com/" target="_blank" rel="noopener">
        QuantGems® 主站
      </a>
      <div class="auth-box">
        <template v-if="isAuthenticated">
          <span class="auth-user">
            <span class="auth-name">{{ displayName }}</span>
            <span class="plan-pill">{{ planLabel }}</span>
          </span>
          <button type="button" class="btn-auth ghost" @click="handleLogout">登出</button>
        </template>
        <button v-else type="button" class="btn-auth google" @click="handleGoogleLogin">
          <svg class="g-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Google 登入
        </button>
      </div>
    </div>
    <p v-if="authStatus" class="auth-status muted">{{ authStatus }}</p>

    <template v-if="!showMasterResults">
    <header class="hero">
      <div class="hero-copy">
        <div class="brand-row">
          <img class="brand-mark" src="/favicon.svg" alt="QuantGems Warrant Radar" width="44" height="44" />
          <div>
            <p class="eyebrow">QuantGems · Warrant Radar</p>
            <h1>權證雷達</h1>
          </div>
        </div>
        <p class="lede">篩選全市場發行主檔，追蹤當日成交熱度，並以全螢幕技術分析檢視單檔走勢。</p>
        <p v-if="stats" class="hero-stats">
          <span class="stat"><span class="label">主檔總數</span><strong>{{ stats.total_master?.toLocaleString?.() }}</strong></span>
          <span class="stat-sep" aria-hidden="true">·</span>
          <span class="stat"><span class="label">上市</span><strong>{{ stats.twse?.master_total?.toLocaleString?.() }}</strong></span>
          <span class="stat-sep" aria-hidden="true">·</span>
          <span class="stat"><span class="label">上櫃</span><strong>{{ stats.tpex?.master_total?.toLocaleString?.() }}</strong></span>
          <span class="stat-sep" aria-hidden="true">·</span>
          <span class="stat"><span class="label">最新成交日</span><strong>{{ latestTradeDate }}</strong></span>
        </p>
      </div>
    </header>

    <section class="search-bar panel">
      <div class="search-main">
        <label>搜尋標的／股票代號／權證代號／名稱</label>
        <input
          v-model="filters.q"
          placeholder="例如：2330、台積電、03002T、群益"
          @keyup.enter="onSearch"
        />
        <div class="type-toggle">
          <div class="btns">
            <button type="button" :class="{ active: filters.type === '' }" @click="setMasterType('')">全部</button>
            <button type="button" :class="{ active: filters.type === '認購' }" @click="setMasterType('認購')">認購</button>
            <button type="button" :class="{ active: filters.type === '認售' }" @click="setMasterType('認售')">認售</button>
          </div>
        </div>
      </div>

      <div class="fund-block">
        <div class="fund-head">
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
          <div class="range-field">
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
        <div class="fund-head ta-head">
          <h3>技術分析</h3>
          <span class="ta-period-badge">日線</span>
        </div>
        <p class="ta-hint muted">權證日線篩選；評等／技術面僅針對<strong>目前搜尋結果</strong>，請先輸入標的或條件。</p>
        <div class="grade-filter-row">
          <span class="grade-filter-label">評等選股</span>
          <button
            type="button"
            class="chip-btn grade-chip grade-chip--a"
            :class="{ active: gradeFilter === 'A' }"
            @click="setGradeFilter('A')"
          >A 級</button>
          <button
            type="button"
            class="chip-btn grade-chip grade-chip--b"
            :class="{ active: gradeFilter === 'B' }"
            @click="setGradeFilter('B')"
          >B 級</button>
          <button
            type="button"
            class="chip-btn grade-chip grade-chip--c"
            :class="{ active: gradeFilter === 'C' }"
            @click="setGradeFilter('C')"
          >C 級</button>
          <span v-if="gradeFilter" class="grade-filter-hint muted">
            已選 {{ gradeFilter }} 級 · 僅篩選搜尋結果
          </span>
          <button
            v-if="gradeFilter"
            type="button"
            class="btn-clear-sm"
            @click="clearGradeFilterOnly"
          >清除評等</button>
        </div>
        <div class="ta-chip-row">
          <button
            type="button"
            class="chip-btn"
            :class="{ active: taFilters.reversalFirstRed }"
            @click="toggleTaFilter('reversalFirstRed')"
          >小不點第一根紅</button>
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
          <button
            type="button"
            class="chip-btn"
            :class="{ active: taFilters.duoKongTrendFirstRed }"
            @click="toggleTaFilter('duoKongTrendFirstRed')"
          >多空趨勢線第一根紅</button>
        </div>
        <details class="grade-criteria">
          <summary>A / B / C 評等標準（到期日 · 技術面；量能／行使比納入評分但不顯示數值）</summary>
          <div class="grade-matrix-wrap">
            <table class="grade-matrix">
              <thead>
                <tr>
                  <th>項目</th>
                  <th>A 級</th>
                  <th>B 級</th>
                  <th>C 級</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="dim in gradeDimensions" :key="dim.key">
                  <th>{{ dim.label }}</th>
                  <td>{{ gradeMatrix.A[dim.key] }}</td>
                  <td>{{ gradeMatrix.B[dim.key] }}</td>
                  <td>{{ gradeMatrix.C[dim.key] }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </div>

      <div class="actions">
        <button class="primary" :disabled="loadingMaster" @click="onSearch">
          {{ loadingMaster ? '搜尋中…' : '搜尋主檔' }}
        </button>
        <button type="button" class="btn-clear-sm" @click="clearFundamentalFilters">清除基本面條件</button>
        <button
          type="button"
          class="btn-clear-sm"
          @click="clearTaFilters"
        >清除技術面</button>
        <button
          type="button"
          class="btn-clear-sm"
          :disabled="importing"
          @click="onImportLatest"
        >
          {{ importing ? '更新中…' : '更新資料' }}
        </button>
      </div>
    </section>

    <div class="workspace">
      <MasterScreener
        :rows="masterRows"
        :total="masterTotal"
        :stats-total="stats?.total_master || 0"
        :page="filters.page"
        :page-size="filters.pageSize"
        :loading="loadingMaster"
        :exporting="exportingMaster"
        :selected-code="selected?.warrant_code || ''"
        :open="masterScreenerOpen"
        :show-grade="usesClientSideMasterResults()"
        @select="selectMasterWarrant"
        @page="onPage"
        @toggle="toggleMasterScreener"
        @export="onExportMaster"
      />
    </div>

    <section class="heat-section">
      <div class="heat-head-row panel">
        <button type="button" class="heat-head toggle" @click="toggleHeatSection">
          <div class="heat-head-main">
            <h2>當日熱度</h2>
            <span class="muted">{{ heatSummaryLabel }}</span>
          </div>
          <span class="chev" aria-hidden="true">{{ heatSectionOpen ? '▾' : '▸' }}</span>
        </button>
        <button
          type="button"
          class="export-btn"
          :disabled="exportingHeat || loadingRankings || !rankings.length"
          @click.stop="onExportHeat"
        >
          {{ exportingHeat ? '匯出中…' : '下載 Excel' }}
        </button>
      </div>

      <div v-show="heatSectionOpen">
        <div class="heat-toolbar panel">
          <div class="heat-rows">
            <div class="heat-row">
              <span class="heat-row-label">日期</span>
              <div class="chip-scroll">
                <button
                  v-for="d in dates"
                  :key="d"
                  type="button"
                  class="chip-btn"
                  :class="{ active: selectedDate === d }"
                  @click="setHeatDate(d)"
                >{{ d }}</button>
              </div>
            </div>
            <div class="heat-row heat-row--controls">
              <span class="heat-row-label">市場</span>
              <div class="chip-btns">
                <button type="button" class="chip-btn" :class="{ active: heatMarket === 'both' }" @click="setHeatMarket('both')">全市場</button>
                <button type="button" class="chip-btn" :class="{ active: heatMarket === 'twse' }" @click="setHeatMarket('twse')">上市</button>
                <button type="button" class="chip-btn" :class="{ active: heatMarket === 'tpex' }" @click="setHeatMarket('tpex')">上櫃</button>
              </div>
              <span class="heat-row-label">類型</span>
              <div class="chip-btns">
                <button type="button" class="chip-btn" :class="{ active: heatType === '' }" @click="setHeatType('')">全部</button>
                <button type="button" class="chip-btn" :class="{ active: heatType === '認購' }" @click="setHeatType('認購')">認購</button>
                <button type="button" class="chip-btn" :class="{ active: heatType === '認售' }" @click="setHeatType('認售')">認售</button>
              </div>
              <span class="heat-row-label">指標</span>
              <div class="chip-btns">
                <button type="button" class="chip-btn" :class="{ active: metric === 'turnover' }" @click="setMetric('turnover')">成交金額</button>
                <button type="button" class="chip-btn" :class="{ active: metric === 'volume' }" @click="setMetric('volume')">成交張數</button>
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
          @select="selectWarrant"
        />
      </div>
    </section>
    </template>

    <template v-else>
      <section class="results-page">
        <div class="results-nav panel">
          <button type="button" class="back-btn" @click="backToSearch">
            ← 返回搜尋條件
          </button>
          <div class="results-copy">
            <h1 class="results-title">主檔搜尋結果</h1>
            <p class="results-summary muted">{{ masterSearchSummary }}</p>
          </div>
        </div>

        <p class="status muted">{{ statusText }}</p>

        <div v-if="masterCarouselEnabled" class="carousel-bar panel">
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

        <MasterScreener
          results-mode
          :rows="masterRows"
          :total="masterTotal"
          :stats-total="stats?.total_master || 0"
          :page="filters.page"
          :page-size="filters.pageSize"
          :loading="loadingMaster"
          :exporting="exportingMaster"
          :selected-code="selected?.warrant_code || ''"
          :open="true"
          :show-grade="usesClientSideMasterResults()"
          @select="selectMasterWarrant"
          @page="onPage"
          @export="onExportMaster"
        />
      </section>
    </template>

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
  padding: 0.75rem 0 3rem;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}
.home-link {
  color: var(--text-muted);
  font-size: 0.86rem;
  text-decoration: none;
}
.home-link:hover { color: var(--cyan-bright, #38bdf8); }
.auth-box {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}
.auth-user {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.88rem;
}
.auth-name { color: var(--text); }
.plan-pill {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  color: #0f172a;
  background: var(--btn-gradient, linear-gradient(135deg, #38bdf8, #818cf8));
}
.btn-auth {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  font-size: 0.86rem;
  font-weight: 600;
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
.g-icon { width: 16px; height: 16px; }
.auth-status {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 1.15rem;
  margin-bottom: 1.25rem;
  animation: rise 0.7s ease both;
}
.eyebrow {
  margin: 0 0 0.2rem;
  color: var(--cyan-bright);
  letter-spacing: 0.06em;
  text-transform: none;
  font-size: 0.78rem;
  font-weight: 600;
}
.brand-row {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}
.brand-mark {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  box-shadow: 0 0 24px rgba(0, 212, 255, 0.35), 0 0 0 1px rgba(0, 212, 255, 0.25);
  flex-shrink: 0;
}
.hero h1 {
  margin: 0;
  font-family: inherit;
  font-size: clamp(1.85rem, 3.6vw, 2.55rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  background: var(--brand-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: rise 0.85s ease both;
}
.lede {
  margin: 0.7rem 0 0;
  color: var(--text-dim);
  max-width: 36rem;
  font-size: 0.98rem;
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
  color: var(--cyan-bright);
}
.heat-head-main {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
}
.heat-head-main h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 650;
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
  color: var(--text-dim);
  font-size: 0.9rem;
  flex-shrink: 0;
}
.export-btn {
  flex-shrink: 0;
  border: 1px solid rgba(0, 212, 255, 0.35);
  background: rgba(0, 212, 255, 0.08);
  color: var(--cyan-bright);
  border-radius: 8px;
  padding: 0.38rem 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.export-btn:hover:not(:disabled) {
  border-color: rgba(0, 212, 255, 0.55);
  background: rgba(0, 212, 255, 0.14);
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
.chip-scroll {
  display: flex;
  gap: 0.35rem;
  overflow-x: auto;
  padding-bottom: 0.1rem;
  min-width: 0;
  flex: 1;
  scrollbar-width: thin;
}
.chip-scroll::-webkit-scrollbar {
  height: 4px;
}
.chip-btns {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip-btn {
  border: 1px solid var(--line);
  background: rgba(7, 11, 20, 0.55);
  color: var(--text-muted);
  border-radius: 999px;
  padding: 0.24rem 0.62rem;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.chip-btn:hover {
  border-color: rgba(0, 212, 255, 0.35);
  color: var(--text);
}
.chip-btn.active {
  color: var(--cyan-bright);
  border-color: rgba(0, 212, 255, 0.45);
  background: rgba(0, 212, 255, 0.1);
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
  border: 1px solid var(--line);
  background: rgba(7, 11, 20, 0.55);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 0.28rem 0.75rem;
  font-size: 0.8rem;
  cursor: pointer;
}
.type-toggle .btns button.active {
  color: var(--cyan-bright);
  border-color: rgba(0, 212, 255, 0.45);
  background: rgba(0, 212, 255, 0.1);
}
.filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}
.fund-block {
  border-top: 1px solid rgba(148, 183, 205, 0.14);
  padding-top: 0.55rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.75rem;
}
.fund-head h3 {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 650;
  color: #e8f4ff;
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
.ta-block {
  border-top: 1px solid rgba(148, 183, 205, 0.14);
  padding-top: 0.55rem;
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
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  color: var(--cyan-bright, #38bdf8);
  border: 1px solid rgba(56, 189, 248, 0.35);
  background: rgba(56, 189, 248, 0.1);
}
.ta-hint {
  flex: 1 1 100%;
  margin: -0.15rem 0 0.1rem;
  font-size: 0.76rem;
}
.grade-filter-row {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem 0.55rem;
  margin: 0.05rem 0 0.1rem;
}
.grade-filter-label {
  font-size: 0.82rem;
  color: var(--text-muted);
  white-space: nowrap;
}
.grade-filter-hint {
  font-size: 0.74rem;
}
.grade-chip.active.grade-chip--a {
  color: #fcd34d;
  border-color: rgba(245, 158, 11, 0.55);
  background: rgba(245, 158, 11, 0.16);
}
.grade-chip.active.grade-chip--b {
  color: #7dd3fc;
  border-color: rgba(56, 189, 248, 0.5);
  background: rgba(56, 189, 248, 0.14);
}
.grade-chip.active.grade-chip--c {
  color: rgba(226, 232, 240, 0.9);
  border-color: rgba(148, 163, 184, 0.45);
  background: rgba(148, 163, 184, 0.12);
}
.grade-criteria {
  flex: 1 1 100%;
  margin: 0.15rem 0 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}
.grade-criteria summary {
  cursor: pointer;
  color: var(--text-dim);
  user-select: none;
}
.grade-criteria summary:hover {
  color: var(--cyan-bright, #38bdf8);
}
.grade-matrix-wrap {
  overflow-x: auto;
  margin-top: 0.55rem;
}
.grade-matrix {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.76rem;
  line-height: 1.4;
}
.grade-matrix th,
.grade-matrix td {
  border: 1px solid rgba(148, 183, 205, 0.16);
  padding: 0.42rem 0.55rem;
  text-align: left;
  vertical-align: top;
}
.grade-matrix thead th {
  background: rgba(7, 11, 20, 0.65);
  color: var(--text);
  font-weight: 650;
}
.grade-matrix tbody th {
  background: rgba(7, 11, 20, 0.45);
  color: var(--text-dim);
  white-space: nowrap;
  width: 7.5rem;
}
.grade-matrix tbody td:nth-child(2) { color: #fcd34d; }
.grade-matrix tbody td:nth-child(3) { color: #7dd3fc; }
.grade-matrix tbody td:nth-child(4) { color: rgba(226, 232, 240, 0.75); }
.ta-chip-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.55rem;
  flex: 1;
  min-width: 0;
}
.ta-chip-row .chip-btn {
  border: 1px solid var(--line);
  background: rgba(7, 11, 20, 0.55);
  color: var(--text-muted);
  border-radius: 999px;
  padding: 0.28rem 0.72rem;
  font-size: 0.82rem;
  cursor: pointer;
  white-space: nowrap;
}
.ta-chip-row .chip-btn:hover {
  border-color: rgba(0, 212, 255, 0.35);
  color: var(--text);
}
.ta-chip-row .chip-btn.active {
  color: var(--cyan-bright);
  border-color: rgba(0, 212, 255, 0.45);
  background: rgba(0, 212, 255, 0.1);
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
  color: var(--cyan-bright);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
}
.btn-clear-sm {
  font-size: 0.76rem;
  padding: 0.28rem 0.55rem;
  border-radius: 6px;
  color: var(--text);
  background: rgba(0, 212, 255, 0.04);
  border-color: rgba(0, 212, 255, 0.22);
  white-space: nowrap;
}
.btn-clear-sm:hover:not(:disabled) {
  color: var(--cyan-bright);
  border-color: rgba(0, 212, 255, 0.4);
  background: rgba(0, 212, 255, 0.08);
  transform: none;
  box-shadow: none;
}
.status {
  margin: 0 0 1rem;
  min-height: 1.25rem;
  font-size: 0.9rem;
}
.results-page {
  display: grid;
  gap: 0.85rem;
  animation: rise 0.85s ease both;
}
.carousel-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem 1rem;
  padding: 0.75rem 1rem;
}
.carousel-bar-main {
  min-width: 0;
  flex: 1;
}
.carousel-indicator {
  font-size: 0.88rem;
  font-weight: 650;
  color: var(--cyan-bright);
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
  border-radius: 7px;
  border: 1px solid rgba(0, 212, 255, 0.28);
  background: rgba(0, 212, 255, 0.06);
  color: var(--text);
  white-space: nowrap;
}
.carousel-btn:hover {
  border-color: rgba(0, 212, 255, 0.45);
  color: var(--cyan-bright);
  background: rgba(0, 212, 255, 0.1);
}
.carousel-btn--play.active {
  color: #fcd34d;
  border-color: rgba(245, 158, 11, 0.45);
  background: rgba(245, 158, 11, 0.12);
}
.carousel-btn--start {
  color: var(--cyan-bright);
  font-weight: 650;
}
@media (max-width: 640px) {
  .carousel-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .carousel-btns {
    justify-content: center;
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
}
.results-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  padding: 0.85rem 1rem;
}
.back-btn {
  flex-shrink: 0;
  border: 1px solid rgba(148, 183, 205, 0.35);
  background: rgba(7, 11, 20, 0.55);
  color: var(--text-dim);
  border-radius: 8px;
  padding: 0.42rem 0.85rem;
  font-size: 0.84rem;
  cursor: pointer;
}
.back-btn:hover {
  border-color: rgba(0, 212, 255, 0.45);
  color: var(--cyan-bright);
}
.results-copy {
  min-width: 0;
  flex: 1;
}
.results-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 650;
}
.results-summary {
  margin: 0.25rem 0 0;
  font-size: 0.84rem;
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
