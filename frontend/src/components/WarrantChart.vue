<script setup>
import { ref, onMounted, watch, onBeforeUnmount } from 'vue';
import * as echarts from 'echarts';

const props = defineProps({
  code: { type: String, default: '' },
  name: { type: String, default: '' },
  series: { type: Array, default: () => [] },
});

const chartRef = ref(null);
let chartInstance = null;

function disposeChart() {
  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
  }
}

function renderChart() {
  if (!chartRef.value) return;
  if (!chartInstance) {
    chartInstance = echarts.init(chartRef.value);
  }

  const data = Array.isArray(props.series) ? props.series : [];
  if (!data.length) {
    chartInstance.clear();
    chartInstance.setOption({
      title: { text: '尚無資料', left: 'center', top: 'middle', textStyle: { color: '#94a3b8' } },
    });
    return;
  }

  const dates = data.map((d) => d.trade_date);
  const turnovers = data.map((d) => d.turnover ?? null);
  const volumes = data.map((d) => d.volume ?? null);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      valueFormatter: (v) => (v == null ? '-' : v.toLocaleString()),
    },
    legend: {
      data: ['成交金額', '成交張數'],
      textStyle: { color: '#e2e8f0' },
    },
    grid: { left: 50, right: 60, top: 40, bottom: 40 },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: true,
      axisLine: { lineStyle: { color: '#64748b' } },
      axisLabel: { color: '#cbd5f5' },
    },
    yAxis: [
      {
        type: 'value',
        name: '成交金額',
        position: 'left',
        axisLine: { lineStyle: { color: '#38bdf8' } },
        axisLabel: { color: '#e2e8f0' },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.3)' } },
      },
      {
        type: 'value',
        name: '成交張數',
        position: 'right',
        axisLine: { lineStyle: { color: '#a855f7' } },
        axisLabel: { color: '#e2e8f0' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '成交金額',
        type: 'line',
        smooth: true,
        yAxisIndex: 0,
        data: turnovers,
        showSymbol: false,
        lineStyle: { width: 2, color: '#38bdf8' },
      },
      {
        name: '成交張數',
        type: 'bar',
        yAxisIndex: 1,
        data: volumes,
        itemStyle: { color: '#a855f7' },
        barMaxWidth: 18,
      },
    ],
  };

  chartInstance.setOption(option);
}

onMounted(() => {
  renderChart();
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  disposeChart();
});

function handleResize() {
  if (chartInstance) {
    chartInstance.resize();
  }
}

watch(
  () => [props.code, props.series],
  () => {
    renderChart();
  },
  { deep: true },
);
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">
        <i class="fas fa-chart-line"></i>
        <span>技術分析 · {{ code }}</span>
        <span v-if="name" class="subtitle">{{ name }}</span>
      </div>
    </div>
    <div class="panel-body">
      <div ref="chartRef" class="chart-container"></div>
    </div>
  </div>
</template>
