import dotenv from 'dotenv';
import pkg from 'pg';

const { Pool } = pkg;

dotenv.config();

const sslFlag = String(process.env.DB_SSL || process.env.DB_SSLMODE || '')
  .trim()
  .toLowerCase();

const useSsl = sslFlag === 'true' || sslFlag === '1' || sslFlag === 'require';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'postgres',
  max: 10,
  idleTimeoutMillis: 30_000,
  ssl: useSsl
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('[pg] Unexpected error on idle client', err);
});

export default pool;
