import test from 'node:test'
import assert from 'node:assert/strict'

import { getQrLoginStatus, startQrLogin } from './login-qr.js'

class MemoryStore {
  constructor() {
    this.sessions = new Map()
    this.accounts = new Map()
    this.removed = []
  }

  async createLoginSession(session) {
    this.sessions.set(session.session_id, session)
    return session
  }

  async getLoginSession(sessionId) {
    return this.sessions.get(sessionId) || null
  }

  async updateLoginSession(sessionId, patch) {
    const next = { ...(this.sessions.get(sessionId) || {}), ...patch }
    this.sessions.set(sessionId, next)
    return next
  }

  async upsertAccount(account) {
    this.accounts.set(account.account_id, account)
    return account
  }

  async removeOtherAccountsForUser(userId, keepAccountId) {
    for (const [accountId, account] of this.accounts.entries()) {
      if (accountId === keepAccountId) continue
      if (String(account.user_id || '') !== userId) continue
      this.accounts.delete(accountId)
      this.removed.push(accountId)
    }
    return this.removed
  }
}

test('startQrLogin returns remote qr session', async () => {
  const store = new MemoryStore()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      qrcode: 'qr-token',
      qrcode_img_content: 'https://img.example.com/qr.png',
    }),
  })

  try {
    const session = await startQrLogin(
      { loginSessionTtlMs: 600000 },
      store,
      { api_base_url: 'https://ilink.example.com' },
    )
    assert.equal(session.qr_mode, 'remote_image')
    assert.equal(session.qrcode, 'qr-token')
    assert.equal(session.qrcode_url, 'https://img.example.com/qr.png')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('getQrLoginStatus completes account when qr confirmed', async () => {
  const store = new MemoryStore()
  await store.upsertAccount({
    account_id: 'old-bot',
    user_id: 'user-1',
    bot_token: 'old-token',
  })
  const session = {
    session_id: 'sess-1',
    account_id: 'wx-temp',
    api_base_url: 'https://ilink.example.com',
    qrcode: 'qr-token',
    state: 'pending',
    expires_at_ms: Date.now() + 600000,
  }
  await store.createLoginSession(session)

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      status: 'confirmed',
      bot_token: 'bot-token',
      ilink_bot_id: 'bot-1',
      baseurl: 'https://ilink.example.com',
      ilink_user_id: 'user-1',
    }),
  })

  try {
    const updated = await getQrLoginStatus(store, 'sess-1')
    assert.equal(updated.state, 'completed')
    assert.equal(updated.account_id, 'bot-1')
    assert.equal(store.accounts.get('bot-1').bot_token, 'bot-token')
    assert.equal(store.accounts.has('old-bot'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('getQrLoginStatus continues polling after wait state', async () => {
  const store = new MemoryStore()
  await store.createLoginSession({
    session_id: 'sess-2',
    account_id: 'wx-temp',
    api_base_url: 'https://ilink.example.com',
    qrcode: 'qr-token',
    state: 'wait',
    expires_at_ms: Date.now() + 600000,
  })

  let called = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    called += 1
    return {
      ok: true,
      text: async () => JSON.stringify({
        status: 'scaned',
      }),
    }
  }

  try {
    const updated = await getQrLoginStatus(store, 'sess-2')
    assert.equal(called, 1)
    assert.equal(updated.state, 'scaned')
  } finally {
    globalThis.fetch = originalFetch
  }
})
