import fs from 'node:fs/promises'
import path from 'node:path'

import { downloadAndDecryptBuffer } from '../cdn/pic-decrypt.js'
import { getMimeFromFilename } from './mime.js'
import { silkToWav } from './silk-transcode.js'

const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function saveBuffer(targetDir, fileName, buffer) {
  await ensureDir(targetDir)
  const filePath = path.join(targetDir, fileName)
  await fs.writeFile(filePath, buffer)
  return filePath
}

function buildStoredFileName(prefix, index, originalFileName, fallbackExtension) {
  const safeName = path.basename(String(originalFileName || '')).replace(/[^\w.\-() \u4e00-\u9fa5]/g, '_')
  if (safeName) {
    return `weixin-inbound-${Date.now()}-${index}-${safeName}`
  }
  return `weixin-inbound-${Date.now()}-${index}${fallbackExtension}`
}

async function downloadInboundImage(item, inboundDir, cdnBaseUrl, index) {
  const image = item?.image_item
  const encryptedQueryParam = image?.media?.encrypt_query_param
  const aesKey = image?.aeskey
    ? Buffer.from(image.aeskey, 'hex').toString('base64')
    : image?.media?.aes_key
  if (!encryptedQueryParam || !aesKey) {
    return null
  }
  const buf = await downloadAndDecryptBuffer(encryptedQueryParam, aesKey, cdnBaseUrl)
  const filePath = await saveBuffer(inboundDir, buildStoredFileName('image', index, '', '.png'), buf)
  return {
    kind: 'image',
    path: filePath,
    media_type: 'image/png',
  }
}

async function downloadInboundFile(item, inboundDir, cdnBaseUrl, index) {
  const fileItem = item?.file_item
  const encryptedQueryParam = fileItem?.media?.encrypt_query_param
  const aesKey = fileItem?.media?.aes_key
  if (!encryptedQueryParam || !aesKey) {
    return null
  }
  const buf = await downloadAndDecryptBuffer(encryptedQueryParam, aesKey, cdnBaseUrl)
  const originalFileName = String(fileItem?.file_name || '')
  const mime = getMimeFromFilename(originalFileName || 'file.bin')
  const fallbackExtension = path.extname(originalFileName || '') || '.bin'
  const filePath = await saveBuffer(inboundDir, buildStoredFileName('file', index, originalFileName, fallbackExtension), buf)
  return {
    kind: 'file',
    path: filePath,
    media_type: mime,
    file_name: originalFileName || path.basename(filePath),
  }
}

async function downloadInboundVideo(item, inboundDir, cdnBaseUrl, index) {
  const videoItem = item?.video_item
  const encryptedQueryParam = videoItem?.media?.encrypt_query_param
  const aesKey = videoItem?.media?.aes_key
  if (!encryptedQueryParam || !aesKey) {
    return null
  }
  const buf = await downloadAndDecryptBuffer(encryptedQueryParam, aesKey, cdnBaseUrl)
  const filePath = await saveBuffer(inboundDir, buildStoredFileName('video', index, '', '.mp4'), buf)
  return {
    kind: 'video',
    path: filePath,
    media_type: 'video/mp4',
  }
}

async function downloadInboundVoice(item, inboundDir, cdnBaseUrl, index) {
  const voiceItem = item?.voice_item
  const encryptedQueryParam = voiceItem?.media?.encrypt_query_param
  const aesKey = voiceItem?.media?.aes_key
  if (!encryptedQueryParam || !aesKey) {
    return null
  }
  const silkBuf = await downloadAndDecryptBuffer(encryptedQueryParam, aesKey, cdnBaseUrl)
  const wavBuf = await silkToWav(silkBuf)
  if (wavBuf) {
    const filePath = await saveBuffer(inboundDir, buildStoredFileName('voice', index, '', '.wav'), wavBuf)
    return {
      kind: 'voice',
      path: filePath,
      media_type: 'audio/wav',
    }
  }
  const filePath = await saveBuffer(inboundDir, buildStoredFileName('voice', index, '', '.silk'), silkBuf)
  return {
    kind: 'voice',
    path: filePath,
    media_type: 'audio/silk',
  }
}

export async function downloadInboundAttachments(message, { inboundDir, account }) {
  const attachments = []
  const items = Array.isArray(message?.item_list) ? message.item_list : []
  const cdnBaseUrl = account?.cdn_base_url || DEFAULT_CDN_BASE_URL

  for (const item of items) {
    const type = Number(item?.type)
    if (type === 2) {
      const attachment = await downloadInboundImage(item, inboundDir, cdnBaseUrl, attachments.length)
      if (attachment) {
        attachments.push(attachment)
      }
      continue
    }
    if (type === 4) {
      const attachment = await downloadInboundFile(item, inboundDir, cdnBaseUrl, attachments.length)
      if (attachment) {
        attachments.push(attachment)
      }
      continue
    }
    if (type === 5) {
      const attachment = await downloadInboundVideo(item, inboundDir, cdnBaseUrl, attachments.length)
      if (attachment) {
        attachments.push(attachment)
      }
      continue
    }
    if (type === 3) {
      const attachment = await downloadInboundVoice(item, inboundDir, cdnBaseUrl, attachments.length)
      if (attachment) {
        attachments.push(attachment)
      }
      continue
    }
  }

  return attachments
}
