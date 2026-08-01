<script setup>
import { computed } from 'vue'
import { warrantTypeLabel, isPutWarrant } from '../utils/warrantDisplay.js'

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
  /** 日線篩選結果：顯示 K 棒數欄 */
  showBarCount: { type: Boolean, default: false },
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
  if (props.statsTotal > 0 && !props.resultsMode) return `未到期 ${props.statsTotal.toLocaleString()} 檔`
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
  if (props.showBarCount) {
    base.push({ key: 'bars', label: 'K棒數', align: 'num' })
  }
  base.push(
    { key: 'close', label: '收盤', align: 'num' },
    { key: 'volume', label: '成交量', align: 'num' },
    { key: 'exercise', label: '履約價', align: 'num' },
    { key: 'days', label: '剩餘天數', align: 'num' },
    { key: 'ratio', label: '行使比', align: 'num' },
    { key: 'expiry', label: '到期日' },
  )
  return base
})

const pageCount = computed(() => Math.max(1, Math.ceil((props.total || 0) / props.pageSize)))

function fmt(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits })
}

function daysClass(days) {
  if (days == null) return ''
  if (days <= 7) return 'days-urgent'
  if (days <= 30) return 'days-soon'
  return ''
}

function gradeTitle(row) {
  const d = row?.grade_detail
  if (!d) return ''
  return `成交量 ${d.volume} · 行使比 ${d.ratio} · ${d.expiry} · 技術面 ${d.technical}`
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
      <button v-if="!resultsMode" type="button" class="head toggle" @click="emit('toggle')">
        <div class="head-main">
          <h2>發行主檔</h2>
          <span class="muted">{{ countLabel }}</span>
        </div>
        <span class="chev" aria-hidden="true">{{ panelOpen ? '▾' : '▸' }}</span>
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
        :disabled="exporting || loading || !total"
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
                :class="col.align"
              >
                {{ col.label }}
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
              <td v-if="showGrade" class="num">
                <span
                  v-if="row.warrant_grade"
                  :class="gradeClass(row.warrant_grade)"
                  :title="gradeTitle(row)"
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
                <span class="underlying-name">{{ row.underlying_name || '—' }}</span>
              </td>
              <td v-if="showBarCount" class="num mono bars-cell">{{ row.bar_count ?? '—' }}</td>
              <td class="num mono">{{ fmt(row.close_price, 2) }}</td>
              <td class="num mono">{{ fmt(row.volume, 0) }}</td>
              <td class="num mono">{{ fmt(row.latest_exercise_price) }}</td>
              <td class="num mono" :class="daysClass(row.days_to_expiry)">
                {{ row.days_to_expiry == null ? '—' : row.days_to_expiry }}
              </td>
              <td class="num mono">{{ fmt(row.latest_exercise_ratio, 4) }}</td>
              <td class="mono">{{ row.expiry_date || '—' }}</td>
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
.screener { padding: 0.65rem 1.1rem 1.1rem; }
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
  color: var(--text-dim);
  font-size: 0.9rem;
  flex-shrink: 0;
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
.bars-cell {
  color: var(--cyan-bright, #38bdf8);
  font-weight: 650;
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
.underlying-name {
  font-size: 0.82rem;
  color: var(--text-muted);
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
</style>
