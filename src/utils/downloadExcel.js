import * as XLSX from 'xlsx'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function workbookToBlob(workbook) {
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return new Blob([data], { type: XLSX_MIME })
}

function isMobileUa() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

function canShareFile(blob, filename) {
  if (!navigator.share || !navigator.canShare) return false
  try {
    const file = new File([blob], filename, { type: XLSX_MIME })
    return navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/**
 * 跨平台下載 xlsx：優先「另存新檔」可選桌面；否則 Blob 下載至瀏覽器預設資料夾。
 * @returns {Promise<'save-as'|'download'|'share'|'open'>}
 */
export async function downloadExcelFile(workbook, filename) {
  const name = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  const blob = workbookToBlob(workbook)

  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{
          description: 'Excel 活頁簿',
          accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
          },
        }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'save-as'
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      /* 不支援或失敗時改走一般下載 */
    }
  }

  if (canShareFile(blob, name)) {
    const file = new File([blob], name, { type: XLSX_MIME })
    await navigator.share({ files: [file], title: name })
    return 'share'
  }

  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.rel = 'noopener'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    link.remove()

    if (isMobileUa()) {
      const opened = window.open(url, '_blank')
      if (!opened) window.location.assign(url)
      return 'open'
    }
    return 'download'
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 8000)
  }
}

export function excelDownloadStatus(method, count) {
  const n = count != null ? `（${Number(count).toLocaleString()} 檔）` : ''
  if (method === 'save-as') return `已儲存 Excel${n}（可選桌面等位置）`
  if (method === 'share') return `請在分享選單選擇「儲存到檔案」${n}`
  if (method === 'open') return `已開啟 Excel${n}，請用瀏覽器選單儲存或分享`
  return `已下載 Excel${n}`
}
