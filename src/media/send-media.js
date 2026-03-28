import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  getUploadUrl,
  sendMessage,
  WeixinMessageItemType,
  WeixinMessageState,
  WeixinMessageType,
  WeixinUploadMediaType,
} from '../api/weixin-api.js'
import { aesEcbPaddedSize } from '../cdn/aes-ecb.js'
import { uploadBufferToCdn } from '../cdn/cdn-upload.js'
import { getExtensionFromContentTypeOrUrl } from './mime.js'

const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'

const VOICE_ENCODING = {
  '.silk': { encode_type: 6, sample_rate: 24000 },
  '.mp3': { encode_type: 7, sample_rate: 24000 },
  '.ogg': { encode_type: 8, sample_rate: 24000 },
  '.amr': { encode_type: 5, sample_rate: 8000 },
}

function createClientId() {
  return `xuanji-weixin-${crypto.randomUUID()}`
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''))
}

function isFileUrl(value) {
  return /^file:\/\//i.test(String(value || ''))
}

async function downloadRemoteFileToTemp(url, destDir) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`remote media download failed: ${response.status} ${response.statusText}`)
  }
  const buf = Buffer.from(await response.arrayBuffer())
  await fs.mkdir(destDir, { recursive: true })
  const ext = getExtensionFromContentTypeOrUrl(response.headers.get('content-type'), url)
  const filePath = path.join(destDir, `weixin-media-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`)
  await fs.writeFile(filePath, buf)
  return filePath
}

async function resolveMediaSourceToLocalPath(source, destDir) {
  const value = String(source || '').trim()
  if (!value) {
    throw new Error('missing media url')
  }

  if (isHttpUrl(value)) {
    return {
      filePath: await downloadRemoteFileToTemp(value, destDir),
      cleanup: true,
    }
  }

  if (isFileUrl(value)) {
    return {
      filePath: new URL(value),
      cleanup: false,
    }
  }

  if (path.isAbsolute(value)) {
    return {
      filePath: value,
      cleanup: false,
    }
  }

  throw new Error('unsupported media url: expected http(s), file://, or absolute local path')
}

async function uploadLocalFileToWeixin(account, { filePath, toUserId, mediaType, cdnBaseUrl }) {
  const plaintext = await fs.readFile(filePath)
  const rawsize = plaintext.length
  const rawfilemd5 = crypto.createHash('md5').update(plaintext).digest('hex')
  const filesize = aesEcbPaddedSize(rawsize)
  const filekey = crypto.randomBytes(16).toString('hex')
  const aeskey = crypto.randomBytes(16)

  const uploadUrlResp = await getUploadUrl(account, {
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString('hex'),
  })
  const uploadParam = typeof uploadUrlResp.upload_param === 'string' ? uploadUrlResp.upload_param : ''
  const uploadFullUrl = typeof uploadUrlResp.upload_full_url === 'string' ? uploadUrlResp.upload_full_url : ''
  if (!uploadParam && !uploadFullUrl) {
    throw new Error('getUploadUrl returned neither upload_param nor upload_full_url')
  }

  console.error('[weixin-gateway] uploadLocalFileToWeixin prepared', JSON.stringify({
    to_user_id: toUserId,
    media_type: mediaType,
    file_name: filePath instanceof URL ? path.basename(filePath.pathname) : path.basename(String(filePath)),
    raw_size: rawsize,
    ciphertext_size: filesize,
    has_upload_param: Boolean(uploadParam),
    has_upload_full_url: Boolean(uploadFullUrl),
  }))
  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadParam,
    uploadFullUrl,
    filekey,
    cdnBaseUrl,
    aeskey,
  })

  return {
    fileName:
      filePath instanceof URL
        ? path.basename(filePath.pathname)
        : path.basename(String(filePath)),
    downloadEncryptedQueryParam: downloadParam,
    aeskey: aeskey.toString('hex'),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  }
}

async function sendImageMessage(account, { toUserId, contextToken, text, uploaded }) {
  return await sendMessage(account, {
    from_user_id: '',
    to_user_id: toUserId,
    context_token: contextToken || '',
    client_id: createClientId(),
    message_type: WeixinMessageType.BOT,
    message_state: WeixinMessageState.FINISH,
    item_list: [
      {
        type: WeixinMessageItemType.IMAGE,
        image_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: Buffer.from(uploaded.aeskey).toString('base64'),
            encrypt_type: 1,
          },
          mid_size: uploaded.fileSizeCiphertext,
        },
      },
    ],
  }, 'sendImageMessage')
}

async function sendFileMessage(account, { toUserId, contextToken, uploaded }) {
  return await sendMessage(account, {
    from_user_id: '',
    to_user_id: toUserId,
    context_token: contextToken || '',
    client_id: createClientId(),
    message_type: WeixinMessageType.BOT,
    message_state: WeixinMessageState.FINISH,
    item_list: [
      {
        type: WeixinMessageItemType.FILE,
        file_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: Buffer.from(uploaded.aeskey).toString('base64'),
            encrypt_type: 1,
          },
          file_name: uploaded.fileName,
          len: String(uploaded.fileSize),
        },
      },
    ],
  }, 'sendFileMessage')
}

async function sendVideoMessage(account, { toUserId, contextToken, uploaded }) {
  return await sendMessage(account, {
    from_user_id: '',
    to_user_id: toUserId,
    context_token: contextToken || '',
    client_id: createClientId(),
    message_type: WeixinMessageType.BOT,
    message_state: WeixinMessageState.FINISH,
    item_list: [
      {
        type: WeixinMessageItemType.VIDEO,
        video_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: Buffer.from(uploaded.aeskey).toString('base64'),
            encrypt_type: 1,
          },
          video_size: uploaded.fileSizeCiphertext,
        },
      },
    ],
  }, 'sendVideoMessage')
}

function resolveVoiceEncoding(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase()
  return VOICE_ENCODING[ext] || null
}

async function sendVoiceMessage(account, { toUserId, contextToken, uploaded }) {
  const encoding = resolveVoiceEncoding(uploaded.fileName)
  if (!encoding) {
    throw new Error(`unsupported voice format: ${uploaded.fileName}`)
  }
  return await sendMessage(account, {
    from_user_id: '',
    to_user_id: toUserId,
    context_token: contextToken || '',
    client_id: createClientId(),
    message_type: WeixinMessageType.BOT,
    message_state: WeixinMessageState.FINISH,
    item_list: [
      {
        type: WeixinMessageItemType.VOICE,
        voice_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: Buffer.from(uploaded.aeskey).toString('base64'),
            encrypt_type: 1,
          },
          encode_type: encoding.encode_type,
          sample_rate: encoding.sample_rate,
        },
      },
    ],
  }, 'sendVoiceMessage')
}

export async function sendMediaFromPayload(account, payload, options = {}) {
  const item = (payload.items || []).find((entry) => entry?.type === 'file')
  if (!item) {
    throw new Error('missing file item')
  }
  const fileType = Number(item.file_type || 0)
  if (![1, 2, 3, 4].includes(fileType)) {
    throw new Error(`unsupported file_type: ${fileType}`)
  }
  const tempDir = options.tempDir || path.join(os.tmpdir(), 'weixin-gateway-media')
  const source = await resolveMediaSourceToLocalPath(String(item.url), tempDir)
  const localPath = source.filePath instanceof URL ? source.filePath : String(source.filePath)
  const cdnBaseUrl = account.cdn_base_url || DEFAULT_CDN_BASE_URL
  const uploadMediaType =
    fileType === 1
      ? WeixinUploadMediaType.IMAGE
      : fileType === 2
        ? WeixinUploadMediaType.VIDEO
        : fileType === 3
          ? WeixinUploadMediaType.VOICE
          : WeixinUploadMediaType.FILE
  const uploaded = await uploadLocalFileToWeixin(account, {
    filePath: localPath,
    toUserId: payload.to_user_id,
    mediaType: uploadMediaType,
    cdnBaseUrl,
  })
  console.error('[weixin-gateway] sendMediaFromPayload uploaded', JSON.stringify({
    to_user_id: payload.to_user_id,
    file_type: fileType,
    media_type: uploadMediaType,
    uploaded_file_name: uploaded.fileName,
    uploaded_file_size: uploaded.fileSize,
    uploaded_ciphertext_size: uploaded.fileSizeCiphertext,
  }))
  try {
    if (fileType === 1) {
      return await sendImageMessage(account, {
        toUserId: payload.to_user_id,
        contextToken: payload.context_token || '',
        text: '',
        uploaded,
      })
    }
    if (fileType === 2) {
      return await sendVideoMessage(account, {
        toUserId: payload.to_user_id,
        contextToken: payload.context_token || '',
        uploaded,
      })
    }
    if (fileType === 3) {
      return await sendVoiceMessage(account, {
        toUserId: payload.to_user_id,
        contextToken: payload.context_token || '',
        uploaded,
      })
    }
    return await sendFileMessage(account, {
      toUserId: payload.to_user_id,
      contextToken: payload.context_token || '',
      uploaded,
    })
  } finally {
    if (source.cleanup) {
      await fs.rm(localPath, { force: true })
    }
  }
}
