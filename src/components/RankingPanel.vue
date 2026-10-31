<script setup>
import { computed, ref, watch } from 'vue'
import {
  warrantTypeLabel,
  isPutWarrant,
  formatVolumeLots,
  resolveVolumeLots,
} from '../utils/warrantDisplay.js'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  selectedCode: { type: String, default: '' },
  metric: { type: String, default: 'turnover' },
  heatType: { type: String, default: '' },
  apiType: { type: String, default: null },
  errorText: { type: String, default: '' },
  tradeDate: { type: String, default: '' },
})

const emit = defineEmits(['select'])

const SORT_LABELS = {
  rank: '排名',
  warrant_code: '代號',
  warrant_name: '名稱',
  underlying: '標的',
  close_price: '收盤',
  volume: '張數',
  turnover: '金額',
}

const sortKey = ref('turnover')
const sortDir = ref('desc')

watch(
  () => props.metric,
  (m) => {
    sortKey.value = m === 'volume' ? 'volume' : 'turnover'
    sortDir.value = 'desc'
  },
  { immediate: true },
)

function defaultDirForKey(key) {
  if (key === 'warrant_name' || key === 'underlying' || key === 'warrant_code') return 'asc'
  return 'desc'
}

function toggleSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = defaultDirForKey(key)
  }
}

function sortClass(key) {
  return sortKey.value === key ? 'is-active' : ''
}

function sortIcon(key) {
  if (sortKey.value !== key) return '↕'
  return sortDir.value === 'asc' ? '↑' : '↓'
}

function sortNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function compareRows(a, b) {
  const dir = sortDir.value === 'asc' ? 1 : -1
  const key = sortKey.value

  if (key === 'rank') {
    return ((sortNum(a.rank) ?? 99999) - (sortNum(b.rank) ?? 99999)) * dir
  }
  if (key === 'volume') {
    const la = resolveVolumeLots(a.volume, a.close_price, a.turnover) ?? -1
    const lb = resolveVolumeLots(b.volume, b.close_price, b.turnover) ?? -1
    return (la - lb) * dir
  }
  if (key === 'close_price' || key === 'turnover') {
    return ((sortNum(a[key]) ?? -1) - (sortNum(b[key]) ?? -1)) * dir
  }
  if (key === 'warrant_code') {
    return String(a.warrant_code || '').localeCompare(String(b.warrant_code || ''), 'zh-Hant') * dir
  }
  if (key === 'warrant_name') {
    return String(a.warrant_name || '').localeCompare(String(b.warrant_name || ''), 'zh-Hant') * dir
  }
  if (key === 'underlying') {
    const ac = String(a.underlying_code || '').localeCompare(String(b.underlying_code || ''), 'zh-Hant')
    if (ac !== 0) return ac * dir
    return String(a.underlying_name || '').localeCompare(String(b.underlying_name || ''), 'zh-Hant') * dir
  }
  return 0
}

const sortedRows = computed(() => {
  if (!props.rows?.length) return []
  return [...props.rows].sort(compareRows)
})

const subtitle = computed(() => {
  const parts = []
  if (props.tradeDate) parts.push(props.tradeDate)
  if (props.rows.length) parts.push(`共 ${props.rows.length} 檔`)
  const col = SORT_LABELS[sortKey.value] || sortKey.value
  const dirLabel = sortDir.value === 'asc' ? '升冪' : '降冪'
  parts.push(`依${col}${dirLabel}`)
  return parts.join(' · ')
})

function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits > 0 ? 0 : undefined,
  })
}

const sortableHeaders = [
  { key: 'rank', label: '#', class: '' },
  { key: 'warrant_code', label: '代號', class: '' },
  { key: 'warrant_name', label: '名稱', class: '' },
  { key: 'underlying', label: '標的', class: '' },
  { key: 'close_price', label: '收盤', class: 'num' },
  { key: 'volume', label: '張數', class: 'num' },
  { key: 'turnover', label: '金額', class: 'num' },
]
</script>

<template>
  <div class="rank panel">
    <div v-if="subtitle" class="rank-meta muted">{{ subtitle }}</div>
    <div v-if="loading" class="empty muted">載入排行…</div>
    <div v-else-if="!rows.length" class="empty muted">
      {{ errorText || (heatType ? `目前沒有符合「${heatType}」的成交熱度` : '尚無成交資料，請先更新資料') }}
    </div>
    <div v-else class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th
              v-for="col in sortableHeaders"
              :key="col.key"
              :class="[col.class, { 'sortable-th': true, sorted: sortClass(col.key) === 'is-active' }]"
            >
              <button
                type="button"
                class="th-sort"
                :class="sortClass(col.key)"
                @click.stop="toggleSort(col.key)"
              >
                {{ col.label }}
                <span class="th-sort-icon" aria-hidden="true">{{ sortIcon(col.key) }}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, idx) in sortedRows"
            :key="`${row.market}-${row.warrant_code}`"
            :class="{ selected: selectedCode === row.warrant_code }"
            @click="emit('select', row)"
          >
            <td class="mono">{{ idx + 1 }}</td>
            <td class="code-cell">
              <span class="mono code">{{ row.warrant_code }}</span>
              <span
                v-if="warrantTypeLabel(row)"
                class="tag type-sub"
                :class="isPutWarrant(row) ? 'put' : 'call'"
              >{{ warrantTypeLabel(row) }}</span>
            </td>
            <td>{{ row.warrant_name }}</td>
            <td class="underlying">
              <span v-if="row.underlying_code" class="mono code">{{ row.underlying_code }}</span>
              <span class="underlying-name">{{ row.underlying_name || '—' }}</span>
            </td>
            <td class="num mono">{{ fmt(row.close_price, 2) }}</td>
            <td
              class="num mono"
              :class="{ 'metric-em': metric === 'volume' && sortKey === 'volume' }"
            >{{ formatVolumeLots(row.volume, row.close_price, row.turnover) }}</td>
            <td
              class="num mono"
              :class="{ 'metric-em': metric === 'turnover' && sortKey === 'turnover' }"
            >{{ fmt(row.turnover) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.rank { padding: 0.85rem 1rem 1rem; }
.rank-meta {
  margin: 0 0 0.55rem;
  font-size: 0.8rem;
}
.empty {
  padding: 2rem 1rem;
  text-align: center;
}
.code-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.18rem;
  line-height: 1.2;
}
.code-cell .code {
  font-weight: 600;
}
.type-sub {
  font-size: 0.68rem;
  padding: 0.06rem 0.38rem;
}
.underlying {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.12rem;
  line-height: 1.2;
  max-width: 9rem;
}
.underlying .code {
  font-size: 0.82rem;
  font-weight: 600;
}
.underlying-name {
  font-size: 0.78rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.table-wrap { max-height: min(48vh, 480px); }
.metric-em {
  color: var(--cyan-bright, #38bdf8);
  font-weight: 650;
}
.sortable-th {
  padding: 0;
  vertical-align: middle;
}
.th-sort {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  width: 100%;
  margin: 0;
  padding: 0.65rem 0.75rem;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  line-height: 1.2;
}
.sortable-th.num .th-sort {
  justify-content: flex-end;
}
.th-sort:hover {
  color: #e0f2fe;
}
.th-sort.is-active {
  color: var(--cyan-bright, #38bdf8);
}
.th-sort-icon {
  font-size: 0.72rem;
  opacity: 0.45;
  font-weight: 500;
}
.th-sort.is-active .th-sort-icon {
  opacity: 1;
}
</style>
