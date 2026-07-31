import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import warrantsRouter from './routes/warrants.js';

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 4100);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5176';

app.use(cors({
  origin: CORS_ORIGIN,
}));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Warrant Volume Radar backend is running' });
});

app.use('/api/warrants', warrantsRouter);

app.listen(PORT, () => {
  console.log(`Warrant analytics backend listening on http://localhost:${PORT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
});
