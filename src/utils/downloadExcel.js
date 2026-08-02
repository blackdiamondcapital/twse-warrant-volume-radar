import * as XLSX from 'xlsx'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const EXCEL_PICKER_TYPES = [{
  description: 'Excel 活頁簿',
  accept: {
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  },
}]

function normalizeFilename(filename) {
  return filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
}

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
 * 在按鈕點擊當下先選儲存位置（預設桌面），避免載入大量資料後 user gesture 失效。
 * @returns {Promise<{ mode: 'handle'|'auto', handle?: FileSystemFileHandle, filename: string }>}
 */
export async function pickExcelSaveLocation(filename) {
  const name = normalizeFilename(filename)
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        startIn: 'desktop',
        types: EXCEL_PICKER_TYPES,
      })
      return { mode: 'handle', handle, filename: name }
    } catch (err) {
      if (err?.name === 'AbortError') throw err
    }
  }
  return { mode: 'auto', filename: name }
}

async function fallbackDownloadBlob(blob, name) {
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

/**
 * @returns {Promise<'save-as'|'download'|'share'|'open'>}
 */
export async function writeExcelBlob(blob, saveTarget) {
  const name = saveTarget?.filename ? normalizeFilename(saveTarget.filename) : 'export.xlsx'

  if (saveTarget?.mode === 'handle' && saveTarget.handle) {
    const writable = await saveTarget.handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return 'save-as'
  }

  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        startIn: 'desktop',
        types: EXCEL_PICKER_TYPES,
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'save-as'
    } catch (err) {
      if (err?.name === 'AbortError') throw err
    }
  }

  return fallbackDownloadBlob(blob, name)
}

/**
 * 跨平台下載 xlsx。若已 pickExcelSaveLocation，傳入 saveTarget 直接寫入。
 * @returns {Promise<'save-as'|'download'|'share'|'open'>}
 */
export async function downloadExcelFile(workbook, filename, saveTarget = null) {
  const blob = workbookToBlob(workbook)
  const name = normalizeFilename(filename)
  if (saveTarget) {
    return writeExcelBlob(blob, { ...saveTarget, filename: saveTarget.filename || name })
  }
  return writeExcelBlob(blob, { mode: 'auto', filename: name })
}

export function excelDownloadStatus(method, count) {
  const n = count != null ? `（${Number(count).toLocaleString()} 檔未到期個股權證）` : ''
  if (method === 'save-as') return `已儲存 Excel${n}至您選擇的位置（桌面）`
  if (method === 'share') return `請在分享選單選擇「儲存到檔案」${n}`
  if (method === 'open') return `已開啟 Excel${n}，請用瀏覽器選單儲存或分享`
  return `已下載 Excel${n}至瀏覽器下載資料夾，可移至桌面`
}
