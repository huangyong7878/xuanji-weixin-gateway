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
  if (!uploadUrlResp.upload_param) {
    throw new Error('getUploadUrl returned no upload_param')
  }

  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadParam: uploadUrlResp.upload_param,
    filekey,
    cdnBaseUrl,
    aeskey,
  })

  return {
    fileName: path.basename(filePath),
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
  const localPath = await downloadRemoteFileToTemp(String(item.url), tempDir)
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
    await fs.rm(localPath, { force: true })
  }
}
