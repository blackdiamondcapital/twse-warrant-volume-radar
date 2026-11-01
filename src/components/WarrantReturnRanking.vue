<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { fetchDates, fetchRankings, fetchTimeseries } from '../api'
import RankingPanel from './RankingPanel.vue'
import { computeChangeFromBars } from '../utils/warrantDisplay.js'

const props = defineProps({
  selectedCode: { type: String, default: '' },
  starredCodes: { type: Array, default: () => [] },
})

const emit = defineEmits(['select', 'toggle-star'])

const dates = ref([])
const selectedDate = ref('')
const datesOpen = ref(false)
const market = ref('both')
const heatType = ref('')
const rankingType = ref('gainers')
const rows = ref([])
const loading = ref(false)
const errorText = ref('')
let reqId = 0

const summary = computed(() => {
  const side = rankingType.value === 'losers' ? '跌幅' : '漲幅'
  const n = rows.value.length
  return `${selectedDate.value || '—'} · ${side} · ${n} 檔`
})

function hasChange(row) {
  return row?.price_change != null || row?.change_pct != null
}

function shiftIsoDate(iso, days) {
  const raw = String(iso || '').slice(0, 10)
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
}

async function loadDateList() {
  try {
    const list = await fetchDates(120, market.value)
    dates.value = list
    if (list.length && !selectedDate.value) selectedDate.value = list[0]
  } catch {
    dates.value = []
  }
}

async function enrichChange(list, tradeDate, id) {
  const need = (list || []).filter((row) => {
    if (!row?.warrant_code) return false
    if (!hasChange(row)) return true
    const chg = Number(row.price_change)
    const pct = Number(row.change_pct)
    return (row.price_change == null || chg === 0) && (row.change_pct == null || pct === 0)
  })
  if (!need.length) return
  const end = String(tradeDate || '').slice(0, 10)
  const start = shiftIsoDate(end, -21)
  await mapPool(need, 8, async (row) => {
    if (id !== reqId) return
    try {
      const data = await fetchTimeseries({
        code: row.warrant_code,
        start: start || undefined,
        end: end || undefined,
        limitDays: 12,
      })
      const next = computeChangeFromBars(data?.data || data?.rows || [], end)
      if (next.price_change == null && next.change_pct == null) return
      if (id !== reqId) return
      const idx = rows.value.findIndex(
        (item) => item.warrant_code === row.warrant_code && item.market === row.market,
      )
      if (idx < 0) return
      rows.value[idx] = { ...rows.value[idx], ...next }
    } catch {
      /* ignore */
    }
  })
}

function sortByReturn(list) {
  const dir = rankingType.value === 'losers' ? 1 : -1
  return [...list].sort((a, b) => {
    const pa = Number(a.change_pct)
    const pb = Number(b.change_pct)
    const aOk = Number.isFinite(pa)
    const bOk = Number.isFinite(pb)
    if (aOk && bOk) return (pa - pb) * dir
    if (aOk) return -1
    if (bOk) return 1
    return 0
  })
}

async function loadRanking() {
  const id = ++reqId
  loading.value = true
  errorText.value = ''
  try {
    const kind = heatType.value === '認購' ? 'call' : heatType.value === '認售' ? 'put' : ''
    const data = await fetchRankings({
      date: selectedDate.value || undefined,
      metric: 'turnover',
      market: market.value,
      type: kind,
      limit: 100,
    })
    if (id !== reqId) return
    if (data.date) selectedDate.value = data.date
    const mapped = (data.rows || []).map((r, i) => ({ ...r, rank: r.rank ?? i + 1 }))
    rows.value = sortByReturn(mapped)
    if (!mapped.length) {
      errorText.value = '目前沒有可排行的權證成交資料'
    } else {
      void enrichChange(mapped, data.date || selectedDate.value, id).then(() => {
        if (id !== reqId) return
        rows.value = sortByReturn(rows.value)
      })
    }
  } catch (err) {
    if (id !== reqId) return
    rows.value = []
    errorText.value = err.message || '報酬排行載入失敗'
  } finally {
    if (id === reqId) loading.value = false
  }
}

function setDate(d) {
  selectedDate.value = d
  datesOpen.value = false
  loadRanking()
}

watch(market, async () => {
  selectedDate.value = ''
  await loadDateList()
  await loadRanking()
})

watch(heatType, () => {
  loadRanking()
})

watch(rankingType, () => {
  rows.value = sortByReturn(rows.value)
})

onMounted(async () => {
  await loadDateList()
  await loadRanking()
})
</script>

<template>
  <section class="ret-section">
    <div class="ret-head panel">
      <div class="ret-title">
        <i class="fas fa-trophy" aria-hidden="true"></i>
        <h2>報酬排行</h2>
        <span class="muted">{{ summary }}</span>
      </div>
    </div>
    <div class="heat-toolbar panel">
      <div class="heat-rows">
        <div class="heat-row" :class="{ 'is-dates-open': datesOpen }">
          <span class="heat-row-label">日期</span>
          <div class="heat-dates-wrap">
            <button type="button" class="heat-dates-toggle" @click="datesOpen = !datesOpen">
              <span class="heat-dates-current mono">{{ selectedDate || '—' }}</span>
              <span class="chev">{{ datesOpen ? '收合 ▾' : '選擇 ▸' }}</span>
            </button>
            <div v-show="datesOpen" class="chip-scroll heat-date-scroll ranking-period-toggle">
              <button
                v-for="d in dates"
                :key="d"
                type="button"
                class="chip-btn period-chip"
                :class="{ active: selectedDate === d }"
                @click="setDate(d)"
              >{{ d }}</button>
            </div>
          </div>
        </div>
        <div class="heat-row heat-row--controls">
          <span class="heat-row-label">榜別</span>
          <div class="chip-btns ranking-type-toggle">
            <button type="button" class="chip-btn ranking-type-chip" :class="{ active: rankingType === 'gainers' }" @click="rankingType = 'gainers'">漲幅</button>
            <button type="button" class="chip-btn ranking-type-chip" :class="{ active: rankingType === 'losers' }" @click="rankingType = 'losers'">跌幅</button>
          </div>
          <span class="heat-row-label">市場</span>
          <div class="chip-btns ranking-period-toggle">
            <button type="button" class="chip-btn period-chip" :class="{ active: market === 'both' }" @click="market = 'both'">全市場</button>
            <button type="button" class="chip-btn period-chip" :class="{ active: market === 'twse' }" @click="market = 'twse'">上市</button>
            <button type="button" class="chip-btn period-chip" :class="{ active: market === 'tpex' }" @click="market = 'tpex'">上櫃</button>
          </div>
          <span class="heat-row-label">類型</span>
          <div class="chip-btns ranking-type-toggle">
            <button type="button" class="chip-btn ranking-type-chip" :class="{ active: heatType === '' }" @click="heatType = ''">全部</button>
            <button type="button" class="chip-btn ranking-type-chip" :class="{ active: heatType === '認購' }" @click="heatType = '認購'">認購</button>
            <button type="button" class="chip-btn ranking-type-chip" :class="{ active: heatType === '認售' }" @click="heatType = '認售'">認售</button>
          </div>
        </div>
      </div>
    </div>
    <RankingPanel
      :key="rankingType"
      :rows="rows"
      :loading="loading"
      :selected-code="selectedCode"
      metric="turnover"
      :heat-type="heatType"
      :error-text="errorText"
      :trade-date="selectedDate"
      default-sort="change_pct"
      :default-dir="rankingType === 'losers' ? 'asc' : 'desc'"
      :starred-codes="starredCodes"
      @select="emit('select', $event)"
      @toggle-star="emit('toggle-star', $event)"
    />
  </section>
</template>

<style scoped>
.ret-section { display: grid; gap: 0.75rem; margin-bottom: 1rem; }
.ret-head { padding: 0.75rem 1.1rem; }
.ret-title {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}
.ret-title i { color: #e8c98a; }
.ret-title h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f4e6c4;
}
.heat-toolbar { padding: 0.85rem 1rem 0.95rem; }
.heat-rows { display: grid; gap: 0.55rem; }
.heat-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}
.heat-row--controls { flex-wrap: wrap; row-gap: 0.45rem; }
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
  gap: 0.4rem;
}
.heat-dates-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  width: fit-content;
  max-width: 100%;
  padding: 0.28rem 0.65rem;
  border-radius: 12px;
  border: 1px solid rgba(212, 175, 110, 0.22);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.42) 0%, rgba(8, 15, 28, 0.88) 100%);
  cursor: pointer;
}
.heat-dates-current { color: #f4e6c4; font-weight: 650; }
.heat-dates-toggle .chev { color: var(--text-dim); font-size: 0.78rem; }
.chip-scroll {
  display: flex;
  gap: 0.35rem;
  overflow-x: auto;
  min-width: 0;
  flex: 1;
}
.chip-scroll.ranking-period-toggle { flex-wrap: nowrap; width: 100%; }
.chip-btns { display: inline-flex; flex-wrap: wrap; gap: 0.35rem; }
.chip-btn {
  border: 1px solid transparent;
  background: transparent;
  color: rgba(232, 201, 138, 0.68);
  border-radius: 999px;
  padding: 0.28rem 0.72rem;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.chip-btn.active {
  color: #1a140c;
  border-color: rgba(232, 201, 138, 0.9);
  background: linear-gradient(180deg, #e8c98a, #b08a4a);
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
}
</style>
