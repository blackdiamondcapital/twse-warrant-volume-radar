<script setup>
import { computed } from 'vue'
import { warrantTypeLabel, isPutWarrant, resolveDaysToExpiry } from '../utils/warrantDisplay.js'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  statsTotal: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 50 },
  loading: { type: Boolean, default: false },
  exporting: { type: Boolean, default: false },
  selectedCode: { type: String, default: '' },
  open: { type: Boolean, default: false },
  /** 搜尋結果頁：固定展開、不可收合 */
  resultsMode: { type: Boolean, default: false },
  /** 日線篩選結果：顯示 A/B/C 評等 */
  showGrade: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'page', 'toggle', 'export'])

const displayTotal = computed(() => {
  if (props.total > 0) return props.total
  return props.statsTotal
})

const countLabel = computed(() => {
  if (props.loading) return '載入中…'
  if (props.resultsMode && props.total === 0 && !props.loading) return '沒有符合條件'
  if (props.total > 0) return `符合 ${displayTotal.value.toLocaleString()} 檔`
  if (props.statsTotal > 0 && !props.resultsMode) return `未到期權證 · 查詢後顯示`
  return '—'
})

const panelOpen = computed(() => props.resultsMode || props.open)

const columns = computed(() => {
  const base = [
    { key: 'code', label: '代號' },
  ]
  if (props.showGrade) {
    base.push({ key: 'grade', label: '評等', align: 'num' })
  }
  base.push(
    { key: 'name', label: '名稱' },
    { key: 'underlying', label: '標的' },
  )
  base.push(
    { key: 'close', label: '收盤', align: 'num' },
    { key: 'volume', label: '成交量', shortLabel: '成交量', align: 'num' },
    { key: 'exercise', label: '履約價', shortLabel: '履約價', align: 'num' },
    { key: 'days', label: '剩餘天數', shortLabelLines: ['剩餘', '天數'], align: 'num' },
    { key: 'expiry', label: '到期日', shortLabel: '到期' },
  )
  return base
})

const pageCount = computed(() => Math.max(1, Math.ceil((props.total || 0) / props.pageSize)))

const canExportExcel = computed(() => {
  if (props.total > 0) return true
  if (!props.resultsMode && props.statsTotal > 0) return true
  return false
})

const exportBtnTitle = computed(() => {
  if (canExportExcel.value) {
    if (props.total > 0) {
      return `匯出未到期個股權證代號（${props.total.toLocaleString()} 檔，不含評等）`
    }
    return `匯出未到期個股權證代號（排除指數類與已到期，不含評等）`
  }
  return '沒有可匯出的資料'
})

function fmt(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits })
}

function fmtExpiryShort(date) {
  if (!date) return '—'
  const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return date
  return `${Number(m[2])}/${Number(m[3])}`
}

function fmtDays(row) {
  const days = resolveDaysToExpiry(row)
  return days == null ? '—' : days
}

function daysClass(row) {
  const days = resolveDaysToExpiry(row)
  if (days == null) return ''
  if (days <= 7) return 'days-urgent'
  if (days <= 30) return 'days-soon'
  return ''
}

function gradeClass(grade) {
  if (grade === 'A') return 'grade-badge grade-badge--a'
  if (grade === 'B') return 'grade-badge grade-badge--b'
  if (grade === 'C') return 'grade-badge grade-badge--c'
  return 'grade-badge grade-badge--none'
}
</script>

<template>
  <div class="screener panel" :class="{ 'screener--results': resultsMode }">
    <div class="head-row">
      <button
        v-if="!resultsMode"
        type="button"
        class="head toggle"
        :aria-expanded="panelOpen"
        :aria-label="panelOpen ? '收合權證總覽' : '展開權證總覽'"
        @click="emit('toggle')"
      >
        <div class="head-main">
          <h2>權證總覽</h2>
          <span class="muted">{{ countLabel }}</span>
        </div>
        <span class="chev" aria-hidden="true">
          <span class="chev-label">{{ panelOpen ? '收合' : '展開' }}</span>
          <span class="chev-icon">{{ panelOpen ? '▾' : '▸' }}</span>
        </span>
      </button>
      <div v-else class="head head-static">
        <div class="head-main">
          <h2>搜尋結果</h2>
          <span class="muted">{{ countLabel }}</span>
        </div>
      </div>
      <button
        type="button"
        class="export-btn"
        :class="{ 'export-btn--ready': canExportExcel && !exporting && !loading }"
        :disabled="exporting || loading || !canExportExcel"
        :title="exportBtnTitle"
        @click.stop="emit('export')"
      >
        {{ exporting ? '匯出中…' : '下載 Excel' }}
      </button>
    </div>

    <div v-show="panelOpen">
      <div v-if="loading" class="empty muted">查詢中…</div>
      <div v-else-if="!rows.length" class="empty muted">沒有符合條件的權證</div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th
                v-for="col in columns"
                :key="col.key"
                :class="[col.align, col.key === 'expiry' ? 'cell-expiry' : '', col.key === 'days' ? 'cell-days' : '']"
              >
                <span class="col-label-full">{{ col.label }}</span>
                <span v-if="col.shortLabelLines" class="col-label-short col-label-short--stacked">
                  <span v-for="(line, i) in col.shortLabelLines" :key="i">{{ line }}</span>
                </span>
                <span v-else class="col-label-short">{{ col.shortLabel || col.label }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="`${row.market}-${row.warrant_code}`"
              :class="{ selected: selectedCode === row.warrant_code }"
              @click="emit('select', row)"
            >
              <td class="mono">{{ row.warrant_code }}</td>
              <td v-if="showGrade" class="num grade-cell">
                <span
                  v-if="row.warrant_grade"
                  :class="gradeClass(row.warrant_grade)"
                >{{ row.warrant_grade }}</span>
                <span v-else class="grade-badge grade-badge--none">—</span>
              </td>
              <td>{{ row.warrant_name }}</td>
              <td class="underlying">
                <span v-if="row.underlying_code" class="mono code">{{ row.underlying_code }}</span>
                <span
                  v-if="warrantTypeLabel(row)"
                  class="tag type-sub"
                  :class="isPutWarrant(row) ? 'put' : 'call'"
                >{{ warrantTypeLabel(row) }}</span>
              </td>
              <td class="num mono">{{ fmt(row.close_price, 2) }}</td>
              <td class="num mono">{{ fmt(row.volume, 0) }}</td>
              <td class="num mono">{{ fmt(row.latest_exercise_price) }}</td>
              <td class="num mono cell-days" :class="daysClass(row)">
                {{ fmtDays(row) }}
              </td>
              <td class="mono cell-expiry" :title="row.expiry_date || ''">
                <span class="expiry-full">{{ row.expiry_date || '—' }}</span>
                <span class="expiry-short">{{ fmtExpiryShort(row.expiry_date) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pager" v-if="total > pageSize">
        <button :disabled="page <= 1" @click="emit('page', page - 1)">上一頁</button>
        <span class="muted">{{ page }} / {{ pageCount }}</span>
        <button :disabled="page >= pageCount" @click="emit('page', page + 1)">下一頁</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.screener { padding: 0.65rem 1.1rem 1.1rem; min-width: 0; overflow: hidden; }
.col-label-short { display: none; }
.table-wrap {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.screener table.data th.cell-expiry,
.screener table.data td.cell-expiry {
  width: 1%;
  max-width: 3.25rem;
  padding-left: 0.28rem;
  padding-right: 0.28rem;
}
.screener table.data th.cell-days,
.screener table.data td.cell-days {
  width: 1%;
  padding-left: 0.2rem;
  padding-right: 0.2rem;
}
.screener table.data th.cell-days {
  white-space: normal;
}
.col-label-short--stacked {
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 0.05rem;
  line-height: 1.1;
}
.screener table.data td.cell-days {
  white-space: nowrap;
}
.expiry-short { display: none; }
.head-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.75rem;
}
.head {
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
  transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
}
.export-btn--ready {
  border-color: rgba(0, 212, 255, 0.55);
  background: rgba(0, 212, 255, 0.14);
  box-shadow: 0 0 12px rgba(0, 212, 255, 0.18);
}
.export-btn:hover:not(:disabled) {
  border-color: rgba(0, 212, 255, 0.55);
  background: rgba(0, 212, 255, 0.14);
}
.export-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.head.toggle:hover h2 {
  color: var(--cyan-bright);
}
.head-static {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  padding: 0;
}
.screener--results {
  margin-top: 0;
}
.head-main {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  min-width: 0;
}
.head h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
}
.chev {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  color: var(--text-dim);
  font-size: 0.82rem;
  font-weight: 600;
  flex-shrink: 0;
  white-space: nowrap;
}
.chev-label {
  letter-spacing: 0.02em;
}
.chev-icon {
  font-size: 0.9rem;
  line-height: 1;
}
.empty {
  padding: 2.5rem 1rem;
  text-align: center;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.85rem;
  margin-top: 0.85rem;
}
.grade-cell {
  min-width: 2.5rem;
}
.grade-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.65rem;
  padding: 0.1rem 0.42rem;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1.2;
}
.grade-badge--a {
  color: #fef3c7;
  background: rgba(245, 158, 11, 0.22);
  border: 1px solid rgba(245, 158, 11, 0.45);
}
.grade-badge--b {
  color: #bae6fd;
  background: rgba(56, 189, 248, 0.16);
  border: 1px solid rgba(56, 189, 248, 0.38);
}
.grade-badge--c {
  color: rgba(226, 232, 240, 0.82);
  background: rgba(148, 163, 184, 0.14);
  border: 1px solid rgba(148, 163, 184, 0.28);
}
.grade-badge--none {
  color: var(--text-muted);
  background: transparent;
  border: 1px solid transparent;
  font-weight: 600;
}
.days-soon { color: #38bdf8; font-weight: 600; }
.days-urgent { color: #ff6b6b; font-weight: 700; }
.underlying {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  line-height: 1.25;
}
.underlying .code {
  font-size: 0.84rem;
  font-weight: 600;
}
.type-sub {
  font-size: 0.68rem;
  padding: 0.06rem 0.38rem;
}
.screener table.data tbody tr {
  cursor: pointer;
}
.screener table.data tbody tr:hover {
  background: rgba(0, 212, 255, 0.04);
}
.screener table.data tbody tr.selected {
  background: rgba(0, 212, 255, 0.08);
}
@media (max-width: 640px) {
  .screener {
    padding-left: 0.45rem;
    padding-right: 0.45rem;
  }
  .col-label-full { display: none; }
  .col-label-short { display: inline; }
  .screener table.data th,
  .screener table.data td {
    padding: 0.38rem 0.22rem;
    font-size: 0.74rem;
  }
  .screener table.data th.cell-expiry,
  .screener table.data td.cell-expiry {
    max-width: 2.35rem;
    padding-left: 0.1rem;
    padding-right: 0.1rem;
    font-size: 0.62rem;
    letter-spacing: -0.03em;
  }
  .screener table.data th.cell-days,
  .screener table.data td.cell-days {
    max-width: 2.4rem;
    padding-left: 0.08rem;
    padding-right: 0.08rem;
  }
  .screener table.data th.cell-days .col-label-short--stacked {
    display: flex;
    font-size: 0.58rem;
    letter-spacing: -0.04em;
  }
  .screener table.data td.cell-days {
    font-size: 0.72rem;
  }
  .expiry-full { display: none; }
  .expiry-short { display: inline; }
}
</style>
