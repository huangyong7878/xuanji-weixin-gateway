import crypto from 'node:crypto'

import { fetchBotQrCode, getQrCodeStatus } from '../api/weixin-api.js'

function nowIso() {
  return new Date().toISOString()
}

const DEFAULT_BOT_TYPE = '3'
const ACTIVE_POLLING_STATES = new Set(['pending', 'wait', 'scaned'])

function isExpired(session) {
  return Date.now() > Number(session.expires_at_ms || 0)
}

export async function startQrLogin(config, store, payload = {}) {
  const sessionId = crypto.randomUUID()
  const apiBaseUrl = String(payload.api_base_url || '').trim()
  const botType = String(payload.bot_type || DEFAULT_BOT_TYPE).trim()
  if (!apiBaseUrl) {
    throw new Error('api_base_url is required')
  }

  const qr = await fetchBotQrCode(apiBaseUrl, botType)
  const session = {
    session_id: sessionId,
    account_id: String(payload.account_id || `wx-${sessionId.slice(0, 8)}`).trim(),
    api_base_url: apiBaseUrl,
    bot_type: botType,
    state: 'pending',
    created_at: nowIso(),
    updated_at: nowIso(),
    expires_at_ms: Date.now() + config.loginSessionTtlMs,
    qrcode: String(qr.qrcode || ''),
    qrcode_url: String(qr.qrcode_img_content || ''),
    qr_mode: 'remote_image',
    message: '请使用微信扫描二维码完成登录。',
  }
  await store.createLoginSession(session)
  return session
}

export async function getQrLoginStatus(store, sessionId) {
  const session = await store.getLoginSession(sessionId)
  if (!session) {
    return null
  }
  console.info(
    '[weixin-gateway] qrLogin status check',
    JSON.stringify({
      session_id: sessionId,
      state: session.state,
      qrcode: session.qrcode || '',
      api_base_url: session.api_base_url || '',
    }),
  )
  if (ACTIVE_POLLING_STATES.has(String(session.state || '')) && isExpired(session)) {
    console.warn(
      '[weixin-gateway] qrLogin expired locally',
      JSON.stringify({
        session_id: sessionId,
        state: session.state,
      }),
    )
    return await store.updateLoginSession(sessionId, {
        state: 'expired',
        error: 'login session expired',
      })
  }
  if (!ACTIVE_POLLING_STATES.has(String(session.state || '')) || !session.qrcode || !session.api_base_url) {
    return session
  }

  const status = await getQrCodeStatus(session.api_base_url, session.qrcode)
  const nextState = String(status.status || 'pending')
  console.info(
    '[weixin-gateway] qrLogin upstream status',
    JSON.stringify({
      session_id: sessionId,
      upstream_status: nextState,
      has_bot_token: Boolean(status.bot_token),
      has_ilink_bot_id: Boolean(status.ilink_bot_id),
      has_baseurl: Boolean(status.baseurl),
      ilink_user_id: String(status.ilink_user_id || ''),
    }),
  )
  if (nextState === 'confirmed' && status.bot_token && status.ilink_bot_id && status.baseurl) {
    const userId = String(status.ilink_user_id || '')
    const account = await store.upsertAccount({
      account_id: String(status.ilink_bot_id),
      api_base_url: String(status.baseurl),
      bot_token: String(status.bot_token),
      wechat_uin: userId,
      cursor: '',
      created_at: nowIso(),
      user_id: userId,
      session_state: 'active',
    })
    console.info(
      '[weixin-gateway] qrLogin completed',
      JSON.stringify({
        session_id: sessionId,
        account_id: account.account_id,
        user_id: userId,
      }),
    )
    return await store.updateLoginSession(sessionId, {
      state: 'completed',
      account_id: account.account_id,
      api_base_url: account.api_base_url,
      completed_at: nowIso(),
      bot_token_acquired: true,
      ilink_user_id: userId,
      message: '微信登录成功。',
    })
  }

  if (nextState === 'confirmed') {
    console.warn(
      '[weixin-gateway] qrLogin confirmed but incomplete payload',
      JSON.stringify({
        session_id: sessionId,
        has_bot_token: Boolean(status.bot_token),
        has_ilink_bot_id: Boolean(status.ilink_bot_id),
        has_baseurl: Boolean(status.baseurl),
        raw_keys: Object.keys(status || {}),
      }),
    )
  }

  return await store.updateLoginSession(sessionId, {
    state: nextState,
    message:
      nextState === 'scaned'
        ? '已扫码，请在手机上确认授权。'
        : nextState === 'expired'
          ? '二维码已过期，请重新生成。'
          : '等待扫码中。',
    error: nextState === 'expired' ? 'qr code expired' : '',
  })
}

export async function completeQrLogin(store, payload = {}) {
  const sessionId = String(payload.session_id || '').trim()
  if (!sessionId) {
    throw new Error('session_id is required')
  }
  const session = await store.getLoginSession(sessionId)
  if (!session) {
    throw new Error('unknown session_id')
  }
  if (isExpired(session)) {
    await store.updateLoginSession(sessionId, {
      state: 'expired',
      error: 'login session expired',
    })
    throw new Error('login session expired')
  }

  const apiBaseUrl = String(payload.api_base_url || session.api_base_url || '').trim()
  const botToken = String(payload.bot_token || '').trim()
  const wechatUin = String(payload.wechat_uin || '').trim()
  if (!apiBaseUrl || !botToken || !wechatUin) {
    throw new Error('api_base_url, bot_token, wechat_uin are required to complete login')
  }

  const account = await store.upsertAccount({
    account_id: session.account_id,
    api_base_url: apiBaseUrl,
    bot_token: botToken,
    wechat_uin: wechatUin,
    cursor: '',
    created_at: nowIso(),
    session_state: 'active',
  })

  const completed = await store.updateLoginSession(sessionId, {
    state: 'completed',
    api_base_url: apiBaseUrl,
    completed_at: nowIso(),
  })

  return { session: completed, account }
}

export async function cancelQrLogin(store, sessionId) {
  const session = await store.getLoginSession(sessionId)
  if (!session) {
    return null
  }
  return await store.updateLoginSession(sessionId, {
    state: 'cancelled',
    cancelled_at: nowIso(),
  })
}
