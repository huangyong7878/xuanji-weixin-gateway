import test from 'node:test'
import assert from 'node:assert/strict'

import { getConfig, getUpdates, getUploadUrl, sendTextMessage, sendTyping } from './weixin-api.js'

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

test('getConfig calls ilink/bot/getconfig with ilink_user_id and context_token', async () => {
  const calls = []
  const originalFetch = global.fetch
  global.fetch = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      async text() {
        return JSON.stringify({ ret: 0, typing_ticket: 'ticket-1' })
      },
    }
  }

  const result = await getConfig(ACCOUNT, {
    ilink_user_id: 'user-1',
    context_token: 'ctx-1',
  })
  global.fetch = originalFetch

  assert.equal(result.typing_ticket, 'ticket-1')
  assert.match(String(calls[0].url), /ilink\/bot\/getconfig$/)
  const body = JSON.parse(String(calls[0].init.body))
  assert.equal(body.ilink_user_id, 'user-1')
  assert.equal(body.context_token, 'ctx-1')
})

test('sendTyping calls ilink/bot/sendtyping with typing_ticket and status', async () => {
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

  await sendTyping(ACCOUNT, {
    ilink_user_id: 'user-1',
    typing_ticket: 'ticket-1',
    status: 1,
  })
  global.fetch = originalFetch

  assert.match(String(calls[0].url), /ilink\/bot\/sendtyping$/)
  const body = JSON.parse(String(calls[0].init.body))
  assert.equal(body.ilink_user_id, 'user-1')
  assert.equal(body.typing_ticket, 'ticket-1')
  assert.equal(body.status, 1)
})

test('getUploadUrl logs upload_param presence and response keys', async () => {
  const originalFetch = global.fetch
  const originalInfo = console.info
  const logs = []

  console.info = (...args) => {
    logs.push(args)
  }
  global.fetch = async () => {
    return {
      ok: true,
      async text() {
        return JSON.stringify({ foo: 'bar', errmsg: 'missing upload param' })
      },
    }
  }

  const result = await getUploadUrl(ACCOUNT, {
    filekey: 'file-key',
    media_type: 1,
    to_user_id: 'user-1',
    rawsize: 12,
    rawfilemd5: 'abc',
    filesize: 16,
    no_need_thumb: true,
    aeskey: '001122',
  })

  global.fetch = originalFetch
  console.info = originalInfo

  assert.deepEqual(result, { foo: 'bar', errmsg: 'missing upload param' })
  const responseLog = logs.find((entry) => String(entry[0]).includes('getUploadUrl response'))
  assert.ok(responseLog)
  const payload = JSON.parse(String(responseLog[1]))
  assert.equal(payload.has_upload_param, false)
  assert.deepEqual(payload.keys, ['foo', 'errmsg'])
  assert.equal(payload.errmsg, 'missing upload param')
})
