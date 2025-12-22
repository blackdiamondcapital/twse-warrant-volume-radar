import axios from 'axios';

// Determine API base:
// 1) Respect explicit VITE_API_BASE (for Vercel/production).
// 2) If running on Vercel domain but env is missing, fall back to the Render backend.
// 3) Otherwise use local proxy /api (for local dev).
const inferDefaultBase = () => {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  if (typeof window !== 'undefined') {
    const host = window.location.host || '';
    if (host.includes('vercel.app')) {
      return 'https://twse-warrant-volume-radar.onrender.com/api';
    }
  }
  return '/api';
};

const API_BASE = inferDefaultBase();

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
