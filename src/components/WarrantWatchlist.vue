<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { fetchMasterSearch } from '../api'
import { warrantTypeLabel, isPutWarrant } from '../utils/warrantDisplay.js'
import { getWatchlistLimitsForUser } from '../utils/planAccess.js'
import { toggleWarrantWatchlist } from '../utils/warrantWatchlist.js'

const props = defineProps({
  user: { type: Object, default: null },
  codes: { type: Array, default: () => [] },
  selectedCode: { type: String, default: '' },
})

const emit = defineEmits(['select', 'changed'])

const query = ref('')
const loading = ref(false)
const adding = ref(false)
const errorText = ref('')
const rows = ref([])

const limits = computed(() => getWatchlistLimitsForUser(props.user))
const countLabel = computed(() => `${props.codes.length} / ${limits.value.maxPerGroup} 檔`)

function sortNum(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function fmt(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits })
}

function fmtSigned(n, digits = 2) {
  const v = sortNum(n)
  if (v == null) return '—'
  const abs = fmt(Math.abs(v), digits)
  if (v > 0) return `+${abs}`
  if (v < 0) return `-${abs}`
  return abs
}

function fmtSignedPct(n) {
  const v = sortNum(n)
  if (v == null) return '—'
  const abs = fmt(Math.abs(v), 2)
  if (v > 0) return `+${abs}%`
  if (v < 0) return `-${abs}%`
  return `${abs}%`
}

function changeToneClass(n) {
  const v = sortNum(n)
  if (v == null || v === 0) return ''
  return v > 0 ? 'ch-up' : 'ch-down'
}

async function loadRows() {
  const codes = (props.codes || []).map((c) => String(c).trim()).filter(Boolean)
  if (!codes.length) {
    rows.value = []
    errorText.value = ''
    return
  }
  loading.value = true
  errorText.value = ''
  try {
    const found = []
    const missing = []
    for (const code of codes) {
      try {
        const data = await fetchMasterSearch({
          q: code,
          page: 1,
          pageSize: 8,
          sort: 'volume',
          sortDir: 'desc',
        })
        const list = data.rows || data.data || []
        const exact = list.find(
          (row) => String(row.warrant_code || '').toUpperCase() === code.toUpperCase(),
        )
        if (exact) found.push(exact)
        else missing.push(code)
      } catch {
        missing.push(code)
      }
    }
    const order = new Map(codes.map((c, i) => [c.toUpperCase(), i]))
    found.sort(
      (a, b) =>
        (order.get(String(a.warrant_code).toUpperCase()) ?? 0)
        - (order.get(String(b.warrant_code).toUpperCase()) ?? 0),
    )
    rows.value = found
    if (missing.length) {
      errorText.value = `有 ${missing.length} 檔暫找不到主檔：${missing.slice(0, 6).join('、')}`
    }
  } catch (err) {
    errorText.value = err.message || '載入自選股失敗'
  } finally {
    loading.value = false
  }
}

async function addFromQuery() {
  const q = query.value.trim()
  if (!q) return
  adding.value = true
  errorText.value = ''
  try {
    const data = await fetchMasterSearch({
      q,
      page: 1,
      pageSize: 12,
      sort: 'volume',
      sortDir: 'desc',
    })
    const list = data.rows || data.data || []
    const upper = q.toUpperCase()
    const exact = list.find((row) => String(row.warrant_code || '').toUpperCase() === upper)
      || list.find((row) => String(row.underlying_code || '') === q)
      || list[0]
    if (!exact?.warrant_code) {
      errorText.value = '找不到這檔權證'
      return
    }
    const res = toggleWarrantWatchlist(props.user, exact.warrant_code, limits.value.maxPerGroup)
    if (!res.ok) {
      errorText.value = res.error || '加入失敗'
      return
    }
    if (!res.added) {
      errorText.value = '這檔已在自選股'
      return
    }
    query.value = ''
    emit('changed', res.codes)
  } catch (err) {
    errorText.value = err.message || '加入失敗'
  } finally {
    adding.value = false
  }
}

function removeCode(code) {
  const res = toggleWarrantWatchlist(props.user, code, limits.value.maxPerGroup)
  emit('changed', res.codes)
}

watch(() => props.codes.join(','), () => {
  loadRows()
})

onMounted(loadRows)
</script>

<template>
  <section class="wl-section">
    <div class="wl-head panel">
      <div class="wl-title">
        <i class="fas fa-star" aria-hidden="true"></i>
        <h2>自選股</h2>
        <span class="muted">權證引擎 · {{ countLabel }}</span>
      </div>
      <form class="wl-add" @submit.prevent="addFromQuery">
        <input
          v-model="query"
          type="search"
          placeholder="權證代號或標的（703349、2330）"
          autocomplete="off"
        />
        <button type="submit" class="primary" :disabled="adding || !query.trim()">
          {{ adding ? '加入中…' : '加入' }}
        </button>
      </form>
    </div>
    <p v-if="errorText" class="wl-msg muted">{{ errorText }}</p>
    <div class="wl-body panel">
      <div v-if="loading" class="empty muted">載入自選股…</div>
      <div v-else-if="!codes.length" class="empty muted">尚未加入權證。從熱度／總覽點星號，或在上方輸入代號。</div>
      <div v-else-if="!rows.length" class="empty muted">自選股主檔載入中或暫時找不到資料。</div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th></th>
              <th>代號</th>
              <th>名稱</th>
              <th>標的</th>
              <th class="num">收盤</th>
              <th class="num">漲跌</th>
              <th class="num">漲跌幅</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="`${row.market}-${row.warrant_code}`"
              :class="{ selected: selectedCode === row.warrant_code }"
              @click="emit('select', row)"
            >
              <td class="star-cell">
                <button type="button" class="star-btn is-on" title="移出自選" @click.stop="removeCode(row.warrant_code)">★</button>
              </td>
              <td class="mono">{{ row.warrant_code }}</td>
              <td>{{ row.warrant_name }}</td>
              <td>
                <span v-if="row.underlying_code" class="mono">{{ row.underlying_code }}</span>
                <span
                  v-if="warrantTypeLabel(row)"
                  class="tag"
                  :class="isPutWarrant(row) ? 'put' : 'call'"
                >{{ warrantTypeLabel(row) }}</span>
              </td>
              <td class="num mono">{{ fmt(row.close_price, 2) }}</td>
              <td class="num mono" :class="changeToneClass(row.price_change)">{{ fmtSigned(row.price_change, 2) }}</td>
              <td class="num mono" :class="changeToneClass(row.change_pct)">{{ fmtSignedPct(row.change_pct) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wl-section { display: grid; gap: 0.75rem; margin-bottom: 1rem; }
.wl-head, .wl-body { padding: 0.85rem 1rem; }
.wl-title {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}
.wl-title i { color: #e8c98a; }
.wl-title h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f4e6c4;
}
.wl-add {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.wl-add input { flex: 1; min-width: 12rem; }
.wl-msg { margin: 0; font-size: 0.82rem; }
.empty { padding: 1.6rem 0.5rem; text-align: center; }
.star-cell { width: 2.2rem; }
.star-btn {
  border: 0;
  background: transparent;
  color: #e8c98a;
  font-size: 1.05rem;
  padding: 0.1rem 0.2rem;
  cursor: pointer;
}
.ch-up { color: #f87171; font-weight: 650; }
.ch-down { color: #4ade80; font-weight: 650; }
.tag { margin-left: 0.35rem; }
</style>
