import crypto from 'node:crypto'

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function randomWechatUin() {
  const uint32 = crypto.getRandomValues(new Uint32Array(1))[0]
  return Buffer.from(String(uint32), 'utf-8').toString('base64')
}

function generateClientId() {
  return `xuanji-weixin-${crypto.randomUUID()}`
}

function buildBaseInfo() {
  return {
    channel_version: 'xuanji-weixin-gateway/0.1.0',
  }
}

function buildHeaders(account) {
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    Authorization: `Bearer ${account.bot_token}`,
    'X-WECHAT-UIN': randomWechatUin(),
  }
}

export const WeixinMessageType = {
  USER: 1,
  BOT: 2,
}

export const WeixinMessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
}

export const WeixinTypingStatus = {
  TYPING: 1,
  CANCEL: 2,
}

export const WeixinMessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
}

export const WeixinUploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
}

function summarizeBody(body) {
  const msg = body?.msg || {}
  return {
    to_user_id: msg.to_user_id || '',
    has_context_token: Boolean(msg.context_token),
    item_types: Array.isArray(msg.item_list) ? msg.item_list.map((item) => item?.type ?? '?') : [],
    text_preview:
      Array.isArray(msg.item_list) && msg.item_list[0]?.text_item?.text
        ? String(msg.item_list[0].text_item.text).slice(0, 80)
        : '',
    has_client_id: Boolean(msg.client_id),
    message_type: msg.message_type ?? null,
    message_state: msg.message_state ?? null,
  }
}

function shouldLogRequest(label) {
  if (label !== 'getUpdates') {
    return true
  }
  return String(process.env.WEIXIN_GATEWAY_VERBOSE_UPDATES || 'false').toLowerCase() === 'true'
}

async function postJson(url, body, headers, label = 'postJson') {
  if (shouldLogRequest(label)) {
    console.info(
      `[weixin-gateway] ${label} request`,
      JSON.stringify({
        url,
        summary: summarizeBody(body),
      }),
    )
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const text = await response.text()
  let data = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }

  if (!response.ok) {
    const message = data?.errmsg || data?.error || `HTTP ${response.status}`
    console.error(
      `[weixin-gateway] ${label} http_error`,
      JSON.stringify({
        url,
        status: response.status,
        message,
        response: data,
      }),
    )
    throw new Error(message)
  }

  if (typeof data?.ret === 'number' && data.ret !== 0) {
    const message = data?.errmsg || data?.error || `ret=${data.ret}`
    console.error(
      `[weixin-gateway] ${label} business_error`,
      JSON.stringify({
        url,
        ret: data.ret,
        errcode: data?.errcode ?? null,
        message,
        response: data,
      }),
    )
    throw new Error(message)
  }
  if (typeof data?.errcode === 'number' && data.errcode !== 0) {
    const message = data?.errmsg || data?.error || `errcode=${data.errcode}`
    console.error(
      `[weixin-gateway] ${label} business_error`,
      JSON.stringify({
        url,
        ret: data?.ret ?? null,
        errcode: data.errcode,
        message,
        response: data,
      }),
    )
    throw new Error(message)
  }

  if (shouldLogRequest(label)) {
    const rawSummary =
      typeof data?.raw === 'string'
        ? data.raw.slice(0, 500)
        : null
    console.info(
      `[weixin-gateway] ${label} response`,
      JSON.stringify({
        url,
        ret: data?.ret ?? null,
        errcode: data?.errcode ?? null,
        errmsg: data?.errmsg ?? data?.error ?? null,
        has_upload_param: typeof data?.upload_param === 'string' && data.upload_param.length > 0,
        keys: data && typeof data === 'object' ? Object.keys(data) : [],
        raw_summary: rawSummary,
      }),
    )
  }

  return data
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, {
    method: 'GET',
    headers,
  })

  const text = await response.text()
  let data = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }

  if (!response.ok) {
    const message = data?.errmsg || data?.error || `HTTP ${response.status}`
    throw new Error(message)
  }

  return data
}

export async function getUploadUrl(account, payload) {
  return await postJson(
    joinUrl(account.api_base_url, 'ilink/bot/getuploadurl'),
    {
      filekey: payload.filekey,
      media_type: payload.media_type,
      to_user_id: payload.to_user_id,
      rawsize: payload.rawsize,
      rawfilemd5: payload.rawfilemd5,
      filesize: payload.filesize,
      thumb_rawsize: payload.thumb_rawsize,
      thumb_rawfilemd5: payload.thumb_rawfilemd5,
      thumb_filesize: payload.thumb_filesize,
      no_need_thumb: payload.no_need_thumb,
      aeskey: payload.aeskey,
      base_info: buildBaseInfo(),
    },
    buildHeaders(account),
    'getUploadUrl',
  )
}

export async function sendMessage(account, msg, label = 'sendMessage') {
  return await postJson(
    joinUrl(account.api_base_url, 'ilink/bot/sendmessage'),
    {
      msg,
      base_info: buildBaseInfo(),
    },
    buildHeaders(account),
    label,
  )
}

export async function getUpdates(account, cursor = '') {
  return await postJson(
    joinUrl(account.api_base_url, 'ilink/bot/getupdates'),
    {
      get_updates_buf: cursor || '',
      base_info: buildBaseInfo(),
    },
    buildHeaders(account),
    'getUpdates',
  )
}

export async function getConfig(account, payload) {
  return await postJson(
    joinUrl(account.api_base_url, 'ilink/bot/getconfig'),
    {
      ilink_user_id: payload.ilink_user_id,
      context_token: payload.context_token || '',
      base_info: buildBaseInfo(),
    },
    buildHeaders(account),
    'getConfig',
  )
}

export async function sendTyping(account, payload) {
  return await postJson(
    joinUrl(account.api_base_url, 'ilink/bot/sendtyping'),
    {
      ilink_user_id: payload.ilink_user_id,
      typing_ticket: payload.typing_ticket,
      status: payload.status,
      base_info: buildBaseInfo(),
    },
    buildHeaders(account),
    'sendTyping',
  )
}

export async function sendTextMessage(account, payload) {
  const clientId = generateClientId()
  return await sendMessage(
    account,
    {
      from_user_id: '',
      to_user_id: payload.to_user_id,
      context_token: payload.context_token || '',
      client_id: clientId,
      message_type: WeixinMessageType.BOT,
      message_state: WeixinMessageState.FINISH,
      item_list: [
        {
          type: WeixinMessageItemType.TEXT,
          text_item: { text: payload.text },
        },
      ],
    },
    'sendTextMessage',
  )
}

export async function fetchBotQrCode(apiBaseUrl, botType = '3') {
  const url = new URL(joinUrl(apiBaseUrl, `ilink/bot/get_bot_qrcode`))
  url.searchParams.set('bot_type', botType)
  return await getJson(url.toString())
}

export async function getQrCodeStatus(apiBaseUrl, qrcode) {
  const url = new URL(joinUrl(apiBaseUrl, `ilink/bot/get_qrcode_status`))
  url.searchParams.set('qrcode', qrcode)
  return await getJson(url.toString(), {
    'iLink-App-ClientVersion': '1',
  })
}
