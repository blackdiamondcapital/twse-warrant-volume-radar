<script setup>
const props = defineProps({
  rows: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['select']);

function onRowClick(row) {
  emit('select', row);
}
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">
        <i class="fas fa-list-ol"></i>
        <span>權證排行榜</span>
      </div>
    </div>
    <div class="panel-body">
      <div v-if="loading" class="panel-placeholder">載入中...</div>
      <div v-else-if="!rows.length" class="panel-placeholder">尚無資料，請先選擇日期並查詢。</div>
      <div v-else class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>權證代號</th>
              <th>權證名稱</th>
              <th class="text-right">成交金額</th>
              <th class="text-right">成交張數</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.warrant_code + '-' + row.rank"
              class="clickable-row"
              @click="onRowClick(row)"
            >
              <td>{{ row.rank }}</td>
              <td>{{ row.warrant_code }}</td>
              <td>{{ row.warrant_name }}</td>
              <td class="text-right">{{ row.turnover?.toLocaleString?.() ?? '' }}</td>
              <td class="text-right">{{ row.volume?.toLocaleString?.() ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
