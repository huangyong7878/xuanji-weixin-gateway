import http from 'node:http'
import process from 'node:process'
import { URL } from 'node:url'

import { loadConfig } from './config.js'
import { cancelQrLogin, completeQrLogin, getQrLoginStatus, startQrLogin } from './auth/login-qr.js'
import { getConfig as getWeixinConfig, sendTyping as sendWeixinTyping, WeixinTypingStatus } from './api/weixin-api.js'
import { FileStore } from './store/file-store.js'
import { pollAccountOnce, pollAllAccountsOnce, sendOutboundMessage } from './runtime/poller.js'
import { PollingLoop } from './runtime/loop.js'

function createAppContext() {
  const config = loadConfig()
  const store = new FileStore(config.dataDir)
  const pollingLoop = new PollingLoop(config, store)
  return { config, store, pollingLoop }
}

async function maybeAutoStartPolling(config, pollingLoop) {
  if (!config.autoStartPolling) {
    return false
  }
  return await pollingLoop.startIfNeeded()
}

function buildAccountStatus(account) {
  const polling = pollingLoop.status
  const lastResult = Array.isArray(polling.last_results)
    ? polling.last_results.find((item) => item?.account_id === account.account_id) || null
    : null
  return {
    polling_running: polling.running,
    session_state: String(account.session_state || lastResult?.session_state || 'active'),
    has_cursor: Boolean(account.cursor),
    last_forwarded: Number(lastResult?.forwarded || 0),
    last_error: String(lastResult?.error || ''),
    last_cursor: String(lastResult?.cursor || account.cursor || ''),
    last_poll_finished_at: polling.last_finished_at || '',
  }
}

function buildAccountView(account) {
  return {
    account_id: account.account_id,
    api_base_url: account.api_base_url,
    wechat_uin: account.wechat_uin,
    cursor: account.cursor || '',
    created_at: account.created_at || '',
    updated_at: account.updated_at || '',
    status: buildAccountStatus(account),
  }
}

function buildInboxView(message) {
  return {
    id: message.id,
    type: message.type || 'message',
    status: message.status || 'pending',
    account_id: message.account_id || '',
    event_id: message.event_id || '',
    chat_id: message.chat_id || '',
    user_id: message.user_id || '',
    chat_type: message.chat_type || 'c2c',
    text: message.text || '',
    context_token: message.context_token || '',
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    callback_attempted: Boolean(message.callback_attempted),
    callback_succeeded: Boolean(message.callback_succeeded),
    claim: message.claim || null,
    error: message.error || '',
    created_at: message.created_at || '',
    updated_at: message.updated_at || '',
    completed_at: message.completed_at || '',
    failed_at: message.failed_at || '',
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function handleRequest(req, res, config, store, pollingLoop) {
  const method = req.method || 'GET'
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)

  if (method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'weixin-gateway',
      phase: 'text-mvp',
      polling: pollingLoop.status,
      delivery_mode: config.deliveryMode,
    })
    return
  }

  if (method === 'GET' && url.pathname === '/poll/status') {
    sendJson(res, 200, {
      ok: true,
      polling: pollingLoop.status,
      delivery_mode: config.deliveryMode,
    })
    return
  }

  if (method === 'GET' && url.pathname === '/inbox/messages') {
    const status = String(url.searchParams.get('status') || 'pending').trim()
    const limit = Number(url.searchParams.get('limit') || 20)
    const accountId = String(url.searchParams.get('account_id') || '').trim()
    const messages = await store.listInboxMessages({
      status,
      limit,
      account_id: accountId,
    })
    sendJson(res, 200, {
      ok: true,
      messages: messages.map((message) => buildInboxView(message)),
    })
    return
  }

  if (method === 'GET' && url.pathname === '/accounts') {
    const accounts = await store.listAccounts()
    sendJson(res, 200, {
      ok: true,
      accounts: accounts.map((account) => buildAccountView(account)),
    })
    return
  }

  if (method === 'GET' && url.pathname.startsWith('/accounts/')) {
    const parts = url.pathname.split('/')
    const accountId = decodeURIComponent(parts[2] || '')
    if (parts.length === 3 && accountId) {
      const account = await store.getAccount(accountId)
      if (!account) {
        sendJson(res, 404, {
          ok: false,
          error: 'unknown account_id',
        })
        return
      }
      sendJson(res, 200, {
        ok: true,
        account: buildAccountView(account),
      })
      return
    }
  }

  if (method === 'GET' && url.pathname.startsWith('/inbox/messages/')) {
    const parts = url.pathname.split('/')
    const messageId = decodeURIComponent(parts[3] || '')
    if (parts.length === 4 && messageId) {
      const message = await store.getInboxMessage(messageId)
      if (!message) {
        sendJson(res, 404, {
          ok: false,
          error: 'unknown message_id',
        })
        return
      }
      sendJson(res, 200, {
        ok: true,
        message: buildInboxView(message),
      })
      return
    }
  }

  if (method === 'POST' && url.pathname === '/login/qr/start') {
    const body = await readJson(req)
    const session = await startQrLogin(config, store, body)
    sendJson(res, 200, {
      ok: true,
      session,
    })
    return
  }

  if (method === 'GET' && url.pathname === '/login/qr/status') {
    const sessionId = String(url.searchParams.get('session_id') || '').trim()
    if (!sessionId) {
      sendJson(res, 400, {
        ok: false,
        error: 'session_id is required',
      })
      return
    }
    const session = await getQrLoginStatus(store, sessionId)
    if (!session) {
      sendJson(res, 404, {
        ok: false,
        error: 'unknown session_id',
      })
      return
    }
    if (session?.state === 'completed') {
      await maybeAutoStartPolling(config, pollingLoop)
    }
    sendJson(res, 200, {
      ok: true,
      session,
    })
    return
  }

  if (method === 'POST' && url.pathname === '/login/qr/complete') {
    const body = await readJson(req)
    const result = await completeQrLogin(store, body)
    await maybeAutoStartPolling(config, pollingLoop)
    sendJson(res, 200, {
      ok: true,
      session: result.session,
      account: {
        account_id: result.account.account_id,
        api_base_url: result.account.api_base_url,
        wechat_uin: result.account.wechat_uin,
        cursor: result.account.cursor || '',
      },
    })
    return
  }

  if (method === 'POST' && url.pathname === '/login/qr/cancel') {
    const body = await readJson(req)
    const sessionId = String(body.session_id || '').trim()
    if (!sessionId) {
      sendJson(res, 400, {
        ok: false,
        error: 'session_id is required',
      })
      return
    }
    const session = await cancelQrLogin(store, sessionId)
    if (!session) {
      sendJson(res, 404, {
        ok: false,
        error: 'unknown session_id',
      })
      return
    }
    sendJson(res, 200, {
      ok: true,
      session,
    })
    return
  }

  if (method === 'POST' && url.pathname === '/accounts/register') {
    const body = await readJson(req)
    const accountId = String(body.account_id || '').trim()
    const apiBaseUrl = String(body.api_base_url || '').trim()
    const botToken = String(body.bot_token || '').trim()
    const wechatUin = String(body.wechat_uin || '').trim()
    if (!accountId || !apiBaseUrl || !botToken || !wechatUin) {
      sendJson(res, 400, {
        ok: false,
        error: 'account_id, api_base_url, bot_token, wechat_uin are required',
      })
      return
    }

    const account = await store.upsertAccount({
      account_id: accountId,
      api_base_url: apiBaseUrl,
      bot_token: botToken,
      wechat_uin: wechatUin,
      cursor: '',
      created_at: new Date().toISOString(),
    })
    await maybeAutoStartPolling(config, pollingLoop)
    sendJson(res, 200, {
      ok: true,
      account: buildAccountView(account),
    })
    return
  }

  if (method === 'POST' && url.pathname === '/typing') {
    const body = await readJson(req)
    const accountId = String(body.account_id || '').trim()
    const ilinkUserId = String(body.to_user_id || body.ilink_user_id || '').trim()
    const contextToken = String(body.context_token || '').trim()
    const statusRaw = String(body.status || 'typing').trim().toLowerCase()
    if (!accountId || !ilinkUserId) {
      sendJson(res, 400, {
        ok: false,
        error: 'account_id and to_user_id are required',
      })
      return
    }
    const account = await store.getAccount(accountId)
    if (!account) {
      sendJson(res, 404, {
        ok: false,
        error: 'unknown account_id',
      })
      return
    }
    const status =
      statusRaw === 'cancel' || statusRaw === 'stop'
        ? WeixinTypingStatus.CANCEL
        : WeixinTypingStatus.TYPING
    const configResp = await getWeixinConfig(account, {
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
    })
    const typingTicket = String(configResp?.typing_ticket || '').trim()
    if (!typingTicket) {
      sendJson(res, 502, {
        ok: false,
        error: 'missing typing_ticket from getconfig',
      })
      return
    }
    await sendWeixinTyping(account, {
      ilink_user_id: ilinkUserId,
      typing_ticket: typingTicket,
      status,
    })
    sendJson(res, 200, {
      ok: true,
      typing: {
        account_id: accountId,
        to_user_id: ilinkUserId,
        status: status === WeixinTypingStatus.CANCEL ? 'cancel' : 'typing',
      },
    })
    return
  }

  if (method === 'POST' && url.pathname.startsWith('/inbox/messages/') && url.pathname.endsWith('/claim')) {
    const parts = url.pathname.split('/')
    const messageId = decodeURIComponent(parts[3] || '')
    const body = await readJson(req)
    const workerId = String(body.worker_id || '').trim()
    const message = await store.claimInboxMessage(messageId, workerId)
    if (!message) {
      sendJson(res, 404, {
        ok: false,
        error: 'unknown message_id',
      })
      return
    }
    sendJson(res, 200, {
      ok: true,
      message: buildInboxView(message),
    })
    return
  }

  if (method === 'POST' && url.pathname.startsWith('/inbox/messages/') && url.pathname.endsWith('/complete')) {
    const parts = url.pathname.split('/')
    const messageId = decodeURIComponent(parts[3] || '')
    const body = await readJson(req)
    const message = await store.completeInboxMessage(messageId, {
      completion_note: String(body.completion_note || '').trim(),
    })
    if (!message) {
      sendJson(res, 404, {
        ok: false,
        error: 'unknown message_id',
      })
      return
    }
    sendJson(res, 200, {
      ok: true,
      message: buildInboxView(message),
    })
    return
  }

  if (method === 'POST' && url.pathname.startsWith('/inbox/messages/') && url.pathname.endsWith('/fail')) {
    const parts = url.pathname.split('/')
    const messageId = decodeURIComponent(parts[3] || '')
    const body = await readJson(req)
    const message = await store.failInboxMessage(messageId, String(body.error || '').trim())
    if (!message) {
      sendJson(res, 404, {
        ok: false,
        error: 'unknown message_id',
      })
      return
    }
    sendJson(res, 200, {
      ok: true,
      message: buildInboxView(message),
    })
    return
  }

  if (method === 'DELETE' && url.pathname.startsWith('/accounts/')) {
    const parts = url.pathname.split('/')
    const accountId = decodeURIComponent(parts[2] || '')
    if (parts.length === 3 && accountId) {
      const removed = await store.removeAccount(accountId)
      if (!removed) {
        sendJson(res, 404, {
          ok: false,
          error: 'unknown account_id',
        })
        return
      }
      const accounts = await store.listAccounts()
      if (accounts.length === 0 && pollingLoop.running) {
        await pollingLoop.stop()
      }
      sendJson(res, 200, {
        ok: true,
        removed: buildAccountView(removed),
        polling: pollingLoop.status,
      })
      return
    }
  }

  if (method === 'POST' && url.pathname === '/poll/run-once') {
    const result = await pollAllAccountsOnce(config, store)
    sendJson(res, 200, {
      ok: true,
      results: result,
      delivery_mode: config.deliveryMode,
    })
    return
  }

  if (method === 'POST' && url.pathname === '/poll/start') {
    await pollingLoop.start()
    sendJson(res, 200, {
      ok: true,
      polling: pollingLoop.status,
    })
    return
  }

  if (method === 'POST' && url.pathname === '/poll/stop') {
    await pollingLoop.stop()
    sendJson(res, 200, {
      ok: true,
      polling: pollingLoop.status,
    })
    return
  }

  if (method === 'POST' && url.pathname.startsWith('/accounts/') && url.pathname.endsWith('/poll-once')) {
    const parts = url.pathname.split('/')
    const accountId = decodeURIComponent(parts[2] || '')
    const result = await pollAccountOnce(config, store, accountId)
    sendJson(res, 200, {
      ok: true,
      result,
    })
    return
  }

  if (method === 'POST' && url.pathname === '/send') {
    const body = await readJson(req)
    console.info(
      '[weixin-gateway] /send inbound',
      JSON.stringify({
        account_id: body.account_id || '',
        to_user_id: body.to_user_id || '',
        has_context_token: Boolean(body.context_token),
        chat_type: body.chat_type || '',
        item_types: Array.isArray(body.items) ? body.items.map((item) => item?.type ?? '?') : [],
      }),
    )
    const result = await sendOutboundMessage(store, body)
    sendJson(res, 200, {
      ok: true,
      result,
    })
    return
  }

  sendJson(res, 404, {
    ok: false,
    error: 'not_found',
  })
}

export async function startServer() {
  const { config, store, pollingLoop } = createAppContext()
  const server = http.createServer((req, res) => {
    handleRequest(req, res, config, store, pollingLoop).catch((error) => {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  })

  await store.init()
  await maybeAutoStartPolling(config, pollingLoop)
  await new Promise((resolve) => {
    server.listen(config.port, () => {
      console.log(`[weixin-gateway] listening on :${config.port}`)
      resolve(undefined)
    })
  })
  return server
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServer()
}
