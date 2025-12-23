import express from 'express';
import pool from '../db.js';

const router = express.Router();

const TABLE = 'tw_warrant_trade';
const TWSE_API_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap42_L';

let importLatestInProgress = false;

function parseRocDateToIso(dateText) {
  if (!dateText) return null;
  const s = String(dateText).trim();
  if (!/^\d{7}$/.test(s)) return null;
  const rocYear = Number(s.slice(0, 3));
  const month = s.slice(3, 5);
  const day = s.slice(5, 7);
  if (!rocYear || !month || !day) return null;
  const year = rocYear + 1911;
  return `${year}-${month}-${day}`;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithTimeout(url, { timeoutMs = 12_000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'accept': 'application/json,text/plain,*/*',
          'user-agent': 'twse-warrant-volume-radar/1.0',
        },
      });
      if (!resp.ok) {
        const err = new Error(`TWSE API 狀態碼 ${resp.status}`);
        err.status = resp.status;
        throw err;
      }
      return await resp.json();
    } catch (err) {
      lastErr = err;
      const isLast = attempt >= retries;
      if (isLast) break;
      await sleep(400 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// GET /api/warrants/dates - available trade dates
router.get('/dates', async (req, res) => {
  const limitParam = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 365) : 120;

  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT DISTINCT to_char(trade_date, 'YYYY-MM-DD') AS trade_date
       FROM ${TABLE}
       WHERE trade_date IS NOT NULL
       ORDER BY trade_date DESC
       LIMIT $1`,
      [limit],
    );

    const dates = result.rows
      .map((r) => (r.trade_date ? String(r.trade_date) : null))
      .filter(Boolean);

    res.json({ success: true, dates });
  } catch (err) {
    console.error('GET /api/warrants/dates error', err);
    res.status(500).json({ success: false, error: err.message || '載入日期失敗' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/warrants/import-latest - fetch from TWSE and upsert into DB
router.post('/import-latest', async (_req, res) => {
  if (importLatestInProgress) {
    return res.status(200).json({
      success: true,
      message: '匯入作業進行中，請稍候再試或稍後刷新',
      inProgress: true,
    });
  }

  importLatestInProgress = true;
  let client;
  try {
    let rawList;
    try {
      rawList = await fetchJsonWithTimeout(TWSE_API_URL, { timeoutMs: 12_000, retries: 1 });
    } catch (err) {
      if (err?.name === 'AbortError') {
        return res.status(504).json({ success: false, error: 'TWSE API 逾時，請稍後再試' });
      }
      return res.status(502).json({ success: false, error: err?.message || 'TWSE API 讀取失敗' });
    }

    if (!Array.isArray(rawList) || !rawList.length) {
      return res.status(200).json({
        success: true,
        message: 'TWSE 目前暫無資料（可能非交易日或尚未出表），未進行匯入',
        importedCount: 0,
        tradeDate: null,
      });
    }

    const first = rawList[0];
    const tradeDateText = first['交易日期'] || first['出表日期'];
    const isoTradeDate = parseRocDateToIso(tradeDateText);

    client = await pool.connect();
    await client.query('BEGIN');

    const sql = `
      INSERT INTO ${TABLE} (
        out_date,
        trade_date,
        warrant_code,
        warrant_name,
        turnover,
        volume,
        raw_out_date_text,
        raw_trade_date_text,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT (warrant_code, trade_date) DO UPDATE
      SET
        out_date = EXCLUDED.out_date,
        warrant_name = EXCLUDED.warrant_name,
        turnover = EXCLUDED.turnover,
        volume = EXCLUDED.volume,
        raw_out_date_text = EXCLUDED.raw_out_date_text,
        raw_trade_date_text = EXCLUDED.raw_trade_date_text,
        updated_at = NOW()
    `;

    let affected = 0;
    for (const item of rawList) {
      const outDateText = item['出表日期'];
      const tradeText = item['交易日期'];
      const outDateIso = parseRocDateToIso(outDateText);
      const tradeIso = parseRocDateToIso(tradeText);
      const code = String(item['權證代號'] || '').trim();
      const name = String(item['權證名稱'] || '').trim();
      if (!code || !tradeIso) continue;

      const turnover = toNumber(item['成交金額']);
      const volume = toNumber(item['成交張數']);

      await client.query(sql, [
        outDateIso || tradeIso,
        tradeIso,
        code,
        name || null,
        turnover,
        volume,
        outDateText || null,
        tradeText || null,
      ]);
      affected += 1;
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: '權證資料匯入完成',
      importedCount: affected,
      tradeDate: isoTradeDate,
    });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    console.error('POST /api/warrants/import-latest error', err);
    return res.status(500).json({ success: false, error: err.message || '匯入失敗' });
  } finally {
    if (client) client.release();
    importLatestInProgress = false;
  }
});

// GET /api/warrants/rankings - rankings by turnover or volume
router.get('/rankings', async (req, res) => {
  const metricRaw = (req.query.metric || 'turnover').toString().toLowerCase();
  const metric = metricRaw === 'volume' ? 'volume' : 'turnover';
  const limitParam = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

  let client;
  try {
    client = await pool.connect();

    // resolve target date
    let targetDate = req.query.date;
    if (!targetDate) {
      const latest = await client.query(`SELECT MAX(trade_date)::text AS latest FROM ${TABLE}`);
      const v = latest.rows[0]?.latest;
      if (!v) {
        return res.json({ success: true, date: null, metric, rows: [] });
      }
      targetDate = String(v).slice(0, 10);
    }

    const orderExpr =
      metric === 'turnover'
        ? 'turnover DESC NULLS LAST, volume DESC NULLS LAST, warrant_code ASC'
        : 'volume DESC NULLS LAST, turnover DESC NULLS LAST, warrant_code ASC';

    const result = await client.query(
      `SELECT trade_date, warrant_code, warrant_name, turnover, volume
       FROM ${TABLE}
       WHERE trade_date = $1::date
       ORDER BY ${orderExpr}
       LIMIT $2`,
      [targetDate, limit],
    );

    const rows = [];
    result.rows.forEach((row, idx) => {
      rows.push({
        rank: idx + 1,
        trade_date: row.trade_date ? row.trade_date.toISOString().slice(0, 10) : null,
        warrant_code: row.warrant_code,
        warrant_name: row.warrant_name,
        turnover: row.turnover !== null ? Number(row.turnover) : null,
        volume: row.volume !== null ? Number(row.volume) : null,
      });
    });

    res.json({ success: true, date: targetDate, metric, rows });
  } catch (err) {
    console.error('GET /api/warrants/rankings error', err);
    res.status(500).json({ success: false, error: err.message || '排行榜查詢失敗' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/warrants/timeseries - single warrant history
router.get('/timeseries', async (req, res) => {
  const code = (req.query.code || req.query.warrant_code || '').toString().trim();
  if (!code) {
    return res.status(400).json({ success: false, error: '缺少必要參數 code' });
  }

  const start = (req.query.start || '').toString().trim() || null;
  const end = (req.query.end || '').toString().trim() || null;
  const limitParam = Number.parseInt(req.query.limitDays, 10);
  const limitDays = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 365) : 90;

  let client;
  try {
    client = await pool.connect();

    const params = [code];
    const where = ['warrant_code = $1'];

    if (start) {
      where.push(`trade_date >= $${params.length + 1}`);
      params.push(start);
    }
    if (end) {
      where.push(`trade_date <= $${params.length + 1}`);
      params.push(end);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    let sql;
    let finalParams;
    if (start || end) {
      sql = `
        SELECT to_char(trade_date, 'YYYY-MM-DD') AS trade_date, warrant_code, warrant_name, turnover, volume
        FROM ${TABLE}
        ${whereSql}
        ORDER BY trade_date ASC, warrant_code ASC
      `;
      finalParams = params;
    } else {
      sql = `
        SELECT to_char(trade_date, 'YYYY-MM-DD') AS trade_date, warrant_code, warrant_name, turnover, volume
        FROM ${TABLE}
        ${whereSql}
        ORDER BY trade_date DESC, warrant_code ASC
        LIMIT $${params.length + 1}
      `;
      finalParams = [...params, limitDays];
    }

    const result = await client.query(sql, finalParams);
    let rows = result.rows || [];
    if (!(start || end)) {
      rows = rows.slice().reverse();
    }

    const series = [];
    let warrantName = null;
    for (const r of rows) {
      if (!warrantName && r.warrant_name) warrantName = r.warrant_name;
      series.push({
        trade_date: r.trade_date ? String(r.trade_date).slice(0, 10) : null,
        warrant_code: r.warrant_code,
        warrant_name: r.warrant_name,
        turnover: r.turnover !== null ? Number(r.turnover) : null,
        volume: r.volume !== null ? Number(r.volume) : null,
      });
    }

    res.json({
      success: true,
      code,
      name: warrantName,
      start,
      end,
      count: series.length,
      data: series,
    });
  } catch (err) {
    console.error('GET /api/warrants/timeseries error', err);
    res.status(500).json({ success: false, error: err.message || '時間序列查詢失敗' });
  } finally {
    if (client) client.release();
  }
});

export default router;
import express from 'express';
import pool from '../db.js';

const router = express.Router();

const TABLE = 'tw_warrant_trade';
const TWSE_API_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap42_L';

let importLatestInProgress = false;

function parseRocDateToIso(dateText) {
  if (!dateText) return null;
  const s = String(dateText).trim();
  if (!/^\d{7}$/.test(s)) return null;
  const rocYear = Number(s.slice(0, 3));
  const month = s.slice(3, 5);
  const day = s.slice(5, 7);
  if (!rocYear || !month || !day) return null;
  const year = rocYear + 1911;
  return `${year}-${month}-${day}`;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithTimeout(url, { timeoutMs = 12_000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'accept': 'application/json,text/plain,*/*',
          'user-agent': 'twse-warrant-volume-radar/1.0',
        },
      });
      if (!resp.ok) {
        const err = new Error(`TWSE API 狀態碼 ${resp.status}`);
        err.status = resp.status;
        throw err;
      }
      return await resp.json();
    } catch (err) {
      lastErr = err;
      const isLast = attempt >= retries;
      if (isLast) break;
      await sleep(400 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// GET /api/warrants/dates - available trade dates
router.get('/dates', async (req, res) => {
  const limitParam = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 365) : 120;

  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT DISTINCT to_char(trade_date, 'YYYY-MM-DD') AS trade_date
       FROM ${TABLE}
       WHERE trade_date IS NOT NULL
       ORDER BY trade_date DESC
       LIMIT $1`,
      [limit],
    );

    const dates = result.rows
      .map((r) => (r.trade_date ? String(r.trade_date) : null))
      .filter(Boolean);

    res.json({ success: true, dates });
  } catch (err) {
    console.error('GET /api/warrants/dates error', err);
    res.status(500).json({ success: false, error: err.message || '載入日期失敗' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/warrants/import-latest - fetch from TWSE and upsert into DB
router.post('/import-latest', async (_req, res) => {
  if (importLatestInProgress) {
    return res.status(200).json({
      success: true,
      message: '匯入作業進行中，請稍候再試或稍後刷新',
      inProgress: true,
    });
  }

  importLatestInProgress = true;
  let client;
  try {
    let rawList;
    try {
      rawList = await fetchJsonWithTimeout(TWSE_API_URL, { timeoutMs: 12_000, retries: 1 });
    } catch (err) {
      if (err?.name === 'AbortError') {
        return res.status(504).json({ success: false, error: 'TWSE API 逾時，請稍後再試' });
      }
      return res.status(502).json({ success: false, error: err?.message || 'TWSE API 讀取失敗' });
    }

    if (!Array.isArray(rawList) || !rawList.length) {
      return res.status(200).json({
        success: true,
        message: 'TWSE 目前暫無資料（可能非交易日或尚未出表），未進行匯入',
        importedCount: 0,
        tradeDate: null,
      });
    }

    const first = rawList[0];
    const tradeDateText = first['交易日期'] || first['出表日期'];
    const isoTradeDate = parseRocDateToIso(tradeDateText);

    client = await pool.connect();
    await client.query('BEGIN');

    const sql = `
      INSERT INTO ${TABLE} (
        out_date,
        trade_date,
        warrant_code,
        warrant_name,
        turnover,
        volume,
        raw_out_date_text,
        raw_trade_date_text,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT (warrant_code, trade_date) DO UPDATE
      SET
        out_date = EXCLUDED.out_date,
        warrant_name = EXCLUDED.warrant_name,
        turnover = EXCLUDED.turnover,
        volume = EXCLUDED.volume,
        raw_out_date_text = EXCLUDED.raw_out_date_text,
        raw_trade_date_text = EXCLUDED.raw_trade_date_text,
        updated_at = NOW()
    `;

    let affected = 0;
    for (const item of rawList) {
      const outDateText = item['出表日期'];
      const tradeText = item['交易日期'];
      const outDateIso = parseRocDateToIso(outDateText);
      const tradeIso = parseRocDateToIso(tradeText);
      const code = String(item['權證代號'] || '').trim();
      const name = String(item['權證名稱'] || '').trim();
      if (!code || !tradeIso) continue;

      const turnover = toNumber(item['成交金額']);
      const volume = toNumber(item['成交張數']);

      await client.query(sql, [
        outDateIso || tradeIso,
        tradeIso,
        code,
        name || null,
        turnover,
        volume,
        outDateText || null,
        tradeText || null,
      ]);
      affected += 1;
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: '權證資料匯入完成',
      importedCount: affected,
      tradeDate: isoTradeDate,
    });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    console.error('POST /api/warrants/import-latest error', err);
    return res.status(500).json({ success: false, error: err.message || '匯入失敗' });
  } finally {
    if (client) client.release();
    importLatestInProgress = false;
  }
});

// GET /api/warrants/rankings - rankings by turnover or volume
router.get('/rankings', async (req, res) => {
  const metricRaw = (req.query.metric || 'turnover').toString().toLowerCase();
  const metric = metricRaw === 'volume' ? 'volume' : 'turnover';
  const limitParam = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

  let client;
  try {
    client = await pool.connect();

    // resolve target date
    let targetDate = req.query.date;
    if (!targetDate) {
      const latest = await client.query(`SELECT MAX(trade_date)::text AS latest FROM ${TABLE}`);
      const v = latest.rows[0]?.latest;
      if (!v) {
        return res.json({ success: true, date: null, metric, rows: [] });
      }
      targetDate = String(v).slice(0, 10);
    }

    const orderExpr =
      metric === 'turnover'
        ? 'turnover DESC NULLS LAST, volume DESC NULLS LAST, warrant_code ASC'
        : 'volume DESC NULLS LAST, turnover DESC NULLS LAST, warrant_code ASC';

    const result = await client.query(
      `SELECT trade_date, warrant_code, warrant_name, turnover, volume
       FROM ${TABLE}
       WHERE trade_date = $1::date
       ORDER BY ${orderExpr}
       LIMIT $2`,
      [targetDate, limit],
    );

    const rows = [];
    result.rows.forEach((row, idx) => {
      rows.push({
        rank: idx + 1,
        trade_date: row.trade_date ? row.trade_date.toISOString().slice(0, 10) : null,
        warrant_code: row.warrant_code,
        warrant_name: row.warrant_name,
        turnover: row.turnover !== null ? Number(row.turnover) : null,
        volume: row.volume !== null ? Number(row.volume) : null,
      });
    });

    res.json({ success: true, date: targetDate, metric, rows });
  } catch (err) {
    console.error('GET /api/warrants/rankings error', err);
    res.status(500).json({ success: false, error: err.message || '排行榜查詢失敗' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/warrants/timeseries - single warrant history
router.get('/timeseries', async (req, res) => {
  const code = (req.query.code || req.query.warrant_code || '').toString().trim();
  if (!code) {
    return res.status(400).json({ success: false, error: '缺少必要參數 code' });
  }

  const start = (req.query.start || '').toString().trim() || null;
  const end = (req.query.end || '').toString().trim() || null;
  const limitParam = Number.parseInt(req.query.limitDays, 10);
  const limitDays = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 365) : 90;

  let client;
  try {
    client = await pool.connect();

    const params = [code];
    const where = ['warrant_code = $1'];

    if (start) {
      where.push(`trade_date >= $${params.length + 1}`);
      params.push(start);
    }
    if (end) {
      where.push(`trade_date <= $${params.length + 1}`);
      params.push(end);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    let sql;
    let finalParams;
    if (start || end) {
      sql = `
        SELECT to_char(trade_date, 'YYYY-MM-DD') AS trade_date, warrant_code, warrant_name, turnover, volume
        FROM ${TABLE}
        ${whereSql}
        ORDER BY trade_date ASC, warrant_code ASC
      `;
      finalParams = params;
    } else {
      sql = `
        SELECT to_char(trade_date, 'YYYY-MM-DD') AS trade_date, warrant_code, warrant_name, turnover, volume
        FROM ${TABLE}
        ${whereSql}
        ORDER BY trade_date DESC, warrant_code ASC
        LIMIT $${params.length + 1}
      `;
      finalParams = [...params, limitDays];
    }

    const result = await client.query(sql, finalParams);
    let rows = result.rows || [];
    if (!(start || end)) {
      rows = rows.slice().reverse();
    }

    const series = [];
    let warrantName = null;
    for (const r of rows) {
      if (!warrantName && r.warrant_name) warrantName = r.warrant_name;
      series.push({
        trade_date: r.trade_date ? String(r.trade_date).slice(0, 10) : null,
        warrant_code: r.warrant_code,
        warrant_name: r.warrant_name,
        turnover: r.turnover !== null ? Number(r.turnover) : null,
        volume: r.volume !== null ? Number(r.volume) : null,
      });
    }

    res.json({
      success: true,
      code,
      name: warrantName,
      start,
      end,
      count: series.length,
      data: series,
    });
  } catch (err) {
    console.error('GET /api/warrants/timeseries error', err);
    res.status(500).json({ success: false, error: err.message || '時間序列查詢失敗' });
  } finally {
    if (client) client.release();
  }
});

export default router;
