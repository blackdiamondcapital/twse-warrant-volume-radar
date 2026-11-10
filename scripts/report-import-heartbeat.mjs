import { readFile } from 'node:fs/promises';

const [status = 'unknown'] = process.argv.slice(2);
const apiUrl = process.env.MONITOR_API_URL?.replace(/\/+$/, '');
const secret = process.env.ETL_REPORT_SECRET;

if (!apiUrl || !secret) {
  console.warn('::warning::Heartbeat skipped: MONITOR_API_URL or ETL_REPORT_SECRET is not configured');
  process.exit(0);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

const trigger = await readJson('trigger.json');
const portalStats = await readJson('stats.json');
const cron = process.env.GITHUB_EVENT_SCHEDULE || '';
const scheduleRole = cron === '0 7 * * 1-5'
  ? 'primary'
  : cron === '0 10 * * 1-5'
    ? 'catchup'
    : 'manual';
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;

const payload = {
  job_key: 'warrant-import',
  status,
  slot: scheduleRole,
  run_id: process.env.GITHUB_RUN_ID,
  url: runUrl,
  as_of: trigger?.tradeDate ?? portalStats?.twse?.latest_trade_date,
  metadata: {
    import: trigger,
    portal: portalStats,
  },
};

try {
  const response = await fetch(`${apiUrl}/api/heartbeat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      'X-ETL-Report-Secret': secret,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    console.warn(`::warning::Heartbeat returned HTTP ${response.status}: ${detail}`);
  } else {
    console.log(`Heartbeat reported: ${status} (${scheduleRole})`);
  }
} catch (error) {
  console.warn(`::warning::Heartbeat failed: ${error.message}`);
}
