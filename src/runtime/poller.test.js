import test from 'node:test'
import assert from 'node:assert/strict'

import { pollAllAccountsOnce } from './poller.js'

test('pollAllAccountsOnce isolates per-account failures', async () => {
  const store = {
    async updateAccount() {
      return null
    },
    async listAccounts() {
      return [
        { account_id: 'ok-bot', cursor: '' },
        { account_id: 'bad-bot', cursor: 'cursor-1' },
      ]
    },
    async getAccount(accountId) {
      if (accountId === 'ok-bot') {
        return {
          account_id: 'ok-bot',
          api_base_url: 'https://ilinkai.weixin.qq.com',
          bot_token: 'token-ok',
        }
      }
      return {
        account_id: 'bad-bot',
        api_base_url: 'https://ilinkai.weixin.qq.com',
        bot_token: 'token-bad',
        cursor: 'cursor-1',
      }
    },
    async updateCursor() {
      return null
    },
  }

  const originalFetch = global.fetch
  let call = 0
  global.fetch = async () => {
    call += 1
    if (call === 1) {
      return {
        ok: true,
        async text() {
          return JSON.stringify({ ret: 0, msgs: [], get_updates_buf: 'next' })
        },
      }
    }
    return {
      ok: true,
      async text() {
        return JSON.stringify({ errcode: -14, errmsg: 'session timeout' })
      },
    }
  }

  const results = await pollAllAccountsOnce({ xuanjiBaseUrl: 'http://127.0.0.1:8000' }, store)
  global.fetch = originalFetch

  assert.equal(results.length, 2)
  assert.equal(results[0].account_id, 'ok-bot')
  assert.equal(results[1].account_id, 'bad-bot')
  assert.equal(results[1].error, 'session timeout')
})

test('pollAccountOnce marks account expired on session timeout', async () => {
  const updates = []
  const store = {
    async getAccount() {
      return {
        account_id: 'bad-bot',
        api_base_url: 'https://ilinkai.weixin.qq.com',
        bot_token: 'token-bad',
        cursor: 'cursor-1',
        session_state: 'active',
      }
    },
    async updateAccount(accountId, patch) {
      updates.push({ accountId, patch })
      return null
    },
  }

  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({ errcode: -14, errmsg: 'session timeout' })
    },
  })

  const { pollAccountOnce } = await import('./poller.js')
  await assert.rejects(pollAccountOnce({}, store, 'bad-bot'), /session timeout/)
  global.fetch = originalFetch

  assert.equal(updates.length, 1)
  assert.equal(updates[0].accountId, 'bad-bot')
  assert.equal(updates[0].patch.session_state, 'expired')
})

test('pollAllAccountsOnce stores inbox messages when delivery mode is inbox', async () => {
  const enqueued = []
  const store = {
    async listAccounts() {
      return [{ account_id: 'inbox-bot', cursor: '' }]
    },
    async getAccount() {
      return {
        account_id: 'inbox-bot',
        api_base_url: 'https://ilinkai.weixin.qq.com',
        bot_token: 'token-inbox',
      }
    },
    async updateCursor() {
      return null
    },
    async enqueueInboxMessage(event) {
      enqueued.push(event)
      return { id: 'msg-1', ...event }
    },
  }

  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({
        ret: 0,
        msgs: [
          {
            message_type: 1,
            message_id: 'evt-1',
            from_user_id: 'wx-user-1',
            context_token: 'ctx-1',
            item_list: [{ type: 1, text_item: { text: '你好' } }],
          },
        ],
        get_updates_buf: 'next-cursor',
      })
    },
  })

  const results = await pollAllAccountsOnce({ deliveryMode: 'inbox', dataDir: '/tmp' }, store)
  global.fetch = originalFetch

  assert.equal(results.length, 1)
  assert.equal(results[0].forwarded, 1)
  assert.equal(enqueued.length, 1)
  assert.equal(enqueued[0].account_id, 'inbox-bot')
  assert.equal(enqueued[0].event_id, 'evt-1')
  assert.equal(enqueued[0].text, '你好')
})
