import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const api = axios.create({
  baseURL: API_BASE,
});

export async function fetchDates(limit = 120) {
  const resp = await api.get('/warrants/dates', { params: { limit } });
  if (!resp.data?.success) throw new Error(resp.data?.error || '載入日期失敗');
  return resp.data.dates || [];
}

export async function fetchRankings({ date, metric = 'turnover', limit = 50 } = {}) {
  const resp = await api.get('/warrants/rankings', {
    params: { date, metric, limit },
  });
  if (!resp.data?.success) throw new Error(resp.data?.error || '排行榜查詢失敗');
  return resp.data;
}

export async function fetchTimeseries({ code, start, end, limitDays = 90 }) {
  if (!code) throw new Error('缺少代號');
  const resp = await api.get('/warrants/timeseries', {
    params: { code, start, end, limitDays },
  });
  if (!resp.data?.success) throw new Error(resp.data?.error || '時間序列查詢失敗');
  return resp.data;
}

export async function importLatestWarrants() {
  const resp = await api.post('/warrants/import-latest');
  if (!resp.data?.success) throw new Error(resp.data?.error || '匯入最新權證資料失敗');
  return resp.data;
}
