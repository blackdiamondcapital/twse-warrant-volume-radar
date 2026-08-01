<script setup>
import { computed } from 'vue'
import { warrantTypeLabel, isPutWarrant } from '../utils/warrantDisplay.js'

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

const subtitle = computed(() => {
  const parts = []
  if (props.tradeDate) parts.push(props.tradeDate)
  if (props.rows.length) parts.push(`共 ${props.rows.length} 檔`)
  const metricLabel = props.metric === 'volume' ? '依張數排序' : '依金額排序'
  parts.push(metricLabel)
  return parts.join(' · ')
})

function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits > 0 ? 0 : undefined,
  })
}
</script>

<template>
  <div class="rank panel">
    <div v-if="subtitle" class="rank-meta muted">{{ subtitle }}</div>
    <div v-if="loading" class="empty muted">載入排行…</div>
    <div v-else-if="!rows.length" class="empty muted">
      {{ errorText || (heatType ? `目前沒有符合「${heatType}」的成交熱度` : '尚無成交資料，請先同步最新成交') }}
    </div>
    <div v-else class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>#</th>
            <th>代號</th>
            <th>名稱</th>
            <th>標的</th>
            <th>收盤</th>
            <th class="num">張數</th>
            <th class="num">金額</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="`${row.market}-${row.warrant_code}`"
            :class="{ selected: selectedCode === row.warrant_code }"
            @click="emit('select', row)"
          >
            <td class="mono">{{ row.rank }}</td>
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
            <td class="num mono" :class="{ 'metric-em': metric === 'volume' }">{{ fmt(row.volume) }}</td>
            <td class="num mono" :class="{ 'metric-em': metric === 'turnover' }">{{ fmt(row.turnover) }}</td>
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
</style>
