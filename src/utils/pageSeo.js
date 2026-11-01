const SITE_ORIGIN = String(import.meta.env.VITE_SITE_URL || 'https://warrant.quantgems.com').replace(/\/$/, '')

export const DEFAULT_TITLE = '台股權證篩選、認購認售查詢與成交熱度｜QuantGems® 權證引擎'
export const DEFAULT_DESC =
  'QuantGems® 權證引擎幫你查詢台股認購／認售、依履約價與剩餘天數篩選、追當日成交熱度，並用全螢幕 K 線與多空線研究走勢。僅供研究參考，非投資建議。'
export const DEFAULT_KEYWORDS =
  '台股權證,權證查詢,權證篩選,認購權證,認售權證,權證熱度,權證搜尋,權證技術分析,權證K線,權證總覽,QuantGems,權證引擎'

export const VIEW_PATH = {
  heat: '/',
  search: '/search',
  screener: '/screener',
  watchlist: '/watchlist',
  ranking: '/ranking',
}

const VIEW_SEO = {
  heat: {
    title: '台股權證當日成交熱度｜認購認售排行｜QuantGems® 權證引擎',
    description:
      '查看台股權證當日成交金額與張數熱度，可切換上市／上櫃、認購／認售，快速找出市場焦點權證。僅供研究參考，非投資建議。',
    keywords: '權證熱度,權證成交排行,認購權證,認售權證,台股權證,QuantGems 權證引擎',
  },
  search: {
    title: '權證搜尋｜基本面與技術面篩選台股認購認售｜QuantGems®',
    description:
      '用標的代號、履約價、剩餘天數、均線、KD、MACD 與多空線條件搜尋台股權證。支援上市上櫃認購／認售。僅供研究參考。',
    keywords: '權證搜尋,權證篩選,權證技術分析,履約價,剩餘天數,多空線,QuantGems',
  },
  screener: {
    title: '權證總覽｜全市場未到期認購認售列表｜QuantGems® 權證引擎',
    description:
      '瀏覽全市場未到期台股權證，可篩認購／認售、依收盤、漲跌幅、成交量與剩餘天數排序，並加入自選。僅供研究參考。',
    keywords: '權證總覽,權證列表,未到期權證,認購認售,權證漲跌幅,QuantGems',
  },
  watchlist: {
    title: '權證自選股｜追蹤關注的認購認售｜QuantGems® 權證引擎',
    description:
      '把關注的台股權證加入自選，集中查看收盤、漲跌與到期日，搭配技術分析圖表追蹤走勢。僅供研究參考。',
    keywords: '權證自選股,權證追蹤,認購權證,認售權證,QuantGems 權證引擎',
  },
  ranking: {
    title: '權證報酬排行｜比較台股認購認售漲跌幅｜QuantGems® 權證引擎',
    description:
      '依期間比較台股權證報酬表現，快速找出相對強弱的認購／認售標的。僅供研究參考，非投資建議。',
    keywords: '權證報酬排行,權證漲幅,權證強弱,認購認售,QuantGems',
  },
}

function setMetaContent(selector, content) {
  if (typeof document === 'undefined') return
  const el = document.querySelector(selector)
  if (el && 'content' in el) el.content = content
}

function setLinkHref(selector, href) {
  if (typeof document === 'undefined') return
  const el = document.querySelector(selector)
  if (el) el.href = href
}

export function viewFromPathname(pathname = '') {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/'
  if (path === '/search') return 'search'
  if (path === '/screener') return 'screener'
  if (path === '/watchlist') return 'watchlist'
  if (path === '/ranking') return 'ranking'
  return 'heat'
}

export function applyViewPageSeo(view) {
  if (typeof document === 'undefined') return
  const key = VIEW_SEO[view] ? view : 'heat'
  const seo = key === 'heat'
    ? { title: DEFAULT_TITLE, description: DEFAULT_DESC, keywords: DEFAULT_KEYWORDS }
    : VIEW_SEO[key]
  const path = VIEW_PATH[key] || '/'
  const canonical = `${SITE_ORIGIN}${path === '/' ? '/' : path}`

  document.title = seo.title
  setMetaContent('meta[name="description"]', seo.description)
  setMetaContent('meta[name="keywords"]', seo.keywords)
  setMetaContent('meta[property="og:title"]', seo.title)
  setMetaContent('meta[property="og:description"]', seo.description)
  setMetaContent('meta[property="og:url"]', canonical)
  setMetaContent('meta[name="twitter:title"]', seo.title)
  setMetaContent('meta[name="twitter:description"]', seo.description)
  setLinkHref('link[rel="canonical"]', canonical)
}

export function syncViewPath(view) {
  if (typeof window === 'undefined') return
  const key = VIEW_PATH[view] ? view : 'heat'
  const nextPath = VIEW_PATH[key]
  const { pathname, search, hash } = window.location
  if (pathname === nextPath) return
  window.history.replaceState({}, '', `${nextPath}${search}${hash}`)
}
