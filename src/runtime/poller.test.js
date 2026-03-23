import test from 'node:test'
import assert from 'node:assert/strict'

import { pollAllAccountsOnce } from './poller.js'

test('pollAllAccountsOnce isolates per-account failures', async () => {
  const store = {
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
