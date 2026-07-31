<script setup>
import { ref, onMounted } from 'vue';
import { fetchDates, fetchRankings, fetchTimeseries, importLatestWarrants } from './api';
import RankingTable from './components/RankingTable.vue';
import WarrantChart from './components/WarrantChart.vue';

const dates = ref([]);
const selectedDate = ref('');
const metric = ref('turnover');
const rankings = ref([]);
const loadingRankings = ref(false);

const selectedWarrant = ref(null);
const timeseries = ref([]);
const loadingSeries = ref(false);
const statusText = ref('');
const importing = ref(false);
const importProgress = ref('');

async function loadDates() {
  try {
    statusText.value = '載入日期中...';
    const list = await fetchDates(120);
    dates.value = list;
    if (list.length && !selectedDate.value) {
      selectedDate.value = list[0];
    }
  } catch (err) {
    console.error('loadDates error', err);
    statusText.value = `載入日期失敗：${err.message}`;
  }
}

async function loadRankings() {
  try {
    loadingRankings.value = true;
    statusText.value = '載入排行榜中...';
    const { date, metric: m, rows } = await fetchRankings({
      date: selectedDate.value,
      metric: metric.value,
      limit: 100,
    });
    rankings.value = rows || [];
    statusText.value = `日期 ${date || selectedDate.value} · 指標=${m} · 共 ${rows?.length || 0} 檔`;
    if (rows && rows.length) {
      onSelectWarrant(rows[0]);
    }
  } catch (err) {
    console.error('loadRankings error', err);
    statusText.value = `排行榜查詢失敗：${err.message}`;
  } finally {
    loadingRankings.value = false;
  }
}

async function onSelectWarrant(row) {
  if (!row) return;
  selectedWarrant.value = row;
  loadingSeries.value = true;
  try {
    const resp = await fetchTimeseries({ code: row.warrant_code, limitDays: 90 });
    timeseries.value = resp.data || [];
  } catch (err) {
    console.error('fetchTimeseries error', err);
    timeseries.value = [];
  } finally {
    loadingSeries.value = false;
  }
}

function onChangeMetric(value) {
  metric.value = value;
  loadRankings();
}

function onChangeDate(event) {
  selectedDate.value = event.target.value;
  loadRankings();
}

async function onImportLatest() {
  try {
    importing.value = true;
    statusText.value = '正在從 TWSE 抓取最新權證資料並匯入，請稍候...';
    importProgress.value = '連線資料源中';
    const resp = await importLatestWarrants();
    importProgress.value = '寫入資料庫中';
    const msg = resp.message || '匯入完成';
    const tdate = resp.tradeDate || '';
    statusText.value = `${msg}${tdate ? `（交易日期：${tdate}）` : ''}`;
    await loadDates();
    await loadRankings();
  } catch (err) {
    console.error('onImportLatest error', err);
    statusText.value = `匯入失敗：${err.message}`;
    importProgress.value = '';
  } finally {
    importing.value = false;
    importProgress.value = '';
  }
}

onMounted(async () => {
  await loadDates();
  await loadRankings();
});
</script>

<template>
  <div class="app-root">
    <header class="app-header">
      <div class="title-group">
        <h1>權證量能雷達</h1>
        <p class="subtitle">Warrant Volume Radar · 依成交金額 / 張數追蹤熱門權證</p>
      </div>
      <div class="controls">
        <div class="control-item">
          <label>交易日期</label>
          <select v-model="selectedDate" @change="onChangeDate" class="control-select">
            <option v-for="d in dates" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
        <div class="control-item">
          <label>排行榜指標</label>
          <div class="metric-toggle">
            <button
              :class="['metric-btn', metric==='turnover' ? 'active' : '']"
              @click="onChangeMetric('turnover')"
            >成交金額</button>
            <button
              :class="['metric-btn', metric==='volume' ? 'active' : '']"
              @click="onChangeMetric('volume')"
            >成交張數</button>
          </div>
        </div>
        <div class="control-item">
          <label>&nbsp;</label>
          <button class="import-btn" :disabled="importing" @click="onImportLatest">
            <i class="fas fa-download"></i>
            <span v-if="!importing">抓取最新權證資料</span>
            <span v-else>匯入中...</span>
          </button>
        </div>
      </div>
    </header>

    <main class="app-main">
      <div class="status-bar">
        <div class="status-line">
          <span>{{ statusText }}</span>
          <span v-if="importing && importProgress" class="import-progress">
            {{ importProgress }} · 若逾時請稍晚再試
          </span>
        </div>
      </div>
      <div class="layout">
        <section class="layout-left">
          <RankingTable :rows="rankings" :loading="loadingRankings" @select="onSelectWarrant" />
        </section>
        <section class="layout-right">
          <WarrantChart
            :code="selectedWarrant?.warrant_code || ''"
            :name="selectedWarrant?.warrant_name || ''"
            :series="timeseries"
          />
        </section>
      </div>
    </main>
  </div>
</template>
