import test from 'node:test'
import assert from 'node:assert/strict'

import { getUpdates, sendTextMessage } from './weixin-api.js'

const ACCOUNT = {
  api_base_url: 'https://ilinkai.weixin.qq.com',
  bot_token: 'bot-token',
}

test('getUpdates uses ilink/bot path and base_info', async () => {
  const calls = []
  const originalFetch = global.fetch
  global.fetch = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      async text() {
        return JSON.stringify({ ret: 0, msgs: [], get_updates_buf: 'next-cursor' })
      },
    }
  }

  const result = await getUpdates(ACCOUNT, '')
  global.fetch = originalFetch

  assert.equal(result.get_updates_buf, 'next-cursor')
  assert.match(String(calls[0].url), /ilink\/bot\/getupdates$/)
  const body = JSON.parse(String(calls[0].init.body))
  assert.equal(body.get_updates_buf, '')
  assert.equal(body.base_info.channel_version, 'xuanji-weixin-gateway/0.1.0')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer bot-token')
})

test('sendTextMessage uses ilink/bot path and wraps text item', async () => {
  const calls = []
  const originalFetch = global.fetch
  global.fetch = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      async text() {
        return JSON.stringify({ ret: 0 })
      },
    }
  }

  await sendTextMessage(ACCOUNT, {
    to_user_id: 'user-1',
    context_token: 'ctx-1',
    text: '你好',
  })
  global.fetch = originalFetch

  assert.match(String(calls[0].url), /ilink\/bot\/sendmessage$/)
  const body = JSON.parse(String(calls[0].init.body))
  assert.equal(body.msg.from_user_id, '')
  assert.equal(body.msg.to_user_id, 'user-1')
  assert.match(String(body.msg.client_id), /^xuanji-weixin-/)
  assert.equal(body.msg.message_type, 2)
  assert.equal(body.msg.message_state, 2)
  assert.equal(body.msg.item_list[0].text_item.text, '你好')
  assert.equal(body.base_info.channel_version, 'xuanji-weixin-gateway/0.1.0')
})

test('sendTextMessage throws on business-level ret error', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => {
    return {
      ok: true,
      async text() {
        return JSON.stringify({ ret: 1001, errmsg: 'send failed' })
      },
    }
  }

  await assert.rejects(
    async () => {
      await sendTextMessage(ACCOUNT, {
        to_user_id: 'user-1',
        context_token: 'ctx-1',
        text: '你好',
      })
    },
    /send failed/,
  )

  global.fetch = originalFetch
})
