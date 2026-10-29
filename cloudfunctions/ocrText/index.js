const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const MAX_IMAGES = 9

// 聊天截图 OCR：逐张识别印刷体文字，按视觉顺序拼接
exports.main = async (event) => {
  const { fileIDs } = event
  if (!Array.isArray(fileIDs) || !fileIDs.length) {
    return { code: 400, error: '参数不完整' }
  }

  const used = fileIDs.slice(0, MAX_IMAGES)
  const chunks = []
  try {
    for (const fileID of used) {
      const res = await cloud.openapi.ocr.printedText({
        type: 'photo',
        fileID,
      })
      const lines = (res.items || [])
        .map((it) => it.text)
        .filter((t) => typeof t === 'string' && t.trim())
      if (lines.length) chunks.push(lines.join('\n'))
    }
  } catch (e) {
    console.error('ocr failed', e)
    return {
      code: 502,
      error: `图片识别失败：${(e.errMsg || e.message || '未知错误').slice(0, 150)}`,
    }
  } finally {
    // 截图是临时素材，识别完就删，不在云存储留存
    await cloud.deleteFile({ fileList: used }).catch((e) => {
      console.error('delete ocr temp files failed', e)
    })
  }

  const text = chunks.join('\n')
  if (!text.trim()) {
    return { code: 400, error: '没有识别出文字，换几张更清晰的截图试试' }
  }
  return { code: 0, text }
}
