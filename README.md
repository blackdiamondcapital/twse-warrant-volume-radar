# QuantGems 權證雷達

台股權證主檔篩選、成交熱度排行與全螢幕技術分析（K 線、多空線、KD、RSI、MACD）。

**正式站：** https://warrant.quantgems.com

## 架構

| 元件 | 位置 |
|------|------|
| 本 repo（前端） | Vue 3 + Vite，部署於 Vercel |
| 權證資料 API | [TWSEDataCenter](https://github.com/blackdiamondcapital/TWSEDataCenter) → `https://twse-data-center.vercel.app/api` |
| 登入／方案 | QuantGems 主站 OAuth 後端（Render） |

## 本機開發

1. 啟動資料 API（[TWSEDataCenter](https://github.com/blackdiamondcapital/TWSEDataCenter) 根目錄）：

```bash
python server.py
# 預設 http://127.0.0.1:5003
```

2. 啟動前端：

```bash
npm install
npm run dev
```

瀏覽 http://127.0.0.1:5180（Vite 會把 `/api` proxy 到 5003）

環境變數可複製 `.env.example` 為 `.env.local`。

## 部署 Vercel

- **Repository：** 本 repo（Root Directory 留空，即 repo 根目錄）
- **Build Command：** `npm run build`
- **Output Directory：** `dist`
- **Environment Variables：**
  - `VITE_API_BASE=/api`（正式站由 `vercel.json` rewrite 至 TWSEDataCenter API）
  - `VITE_BACKEND_URL` — QuantGems OAuth 後端
  - `VITE_SITE_URL` — 本站 origin（如 `https://warrant.quantgems.com`）

後端 `ALLOWED_ORIGINS` 需加入 Vercel 網域。

## 功能

- 全市場主檔篩選（TWSE `tw_warrant_master` ∪ TPEX `tpex_warrant_master`）
- 當日成交熱度排行（金額／張數）
- 單檔走勢與詳情、全螢幕技術分析
- 同步最新 TWSE 成交（管理員）
- PWA 安裝、OG 分享圖
