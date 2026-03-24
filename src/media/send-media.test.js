import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { sendMediaFromPayload } from './send-media.js'

const ACCOUNT = {
  account_id: 'bot-1',
  api_base_url: 'https://ilinkai.weixin.qq.com',
  bot_token: 'bot-token',
  cdn_base_url: 'https://novac2c.cdn.weixin.qq.com/c2c',
}

test('sendMediaFromPayload uploads and sends image message', async () => {
  const calls = []
  const originalFetch = global.fetch
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url) === 'https://example.com/test.png') {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get(name) { return name.toLowerCase() === 'content-type' ? 'image/png' : null } },
        async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer },
      }
    }
    if (String(url).endsWith('/ilink/bot/getuploadurl')) {
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ret: 0, upload_param: 'upload-token' }) },
      }
    }
    if (String(url).startsWith('https://novac2c.cdn.weixin.qq.com/c2c/upload?')) {
      return {
        status: 200,
        headers: { get(name) { return name.toLowerCase() === 'x-encrypted-param' ? 'download-token' : null } },
        async text() { return '' },
      }
    }
    if (String(url).endsWith('/ilink/bot/sendmessage')) {
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ret: 0 }) },
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  await sendMediaFromPayload(ACCOUNT, {
    to_user_id: 'user-1',
    context_token: 'ctx-1',
    items: [{ type: 'file', file_type: 1, url: 'https://example.com/test.png' }],
  })

  global.fetch = originalFetch

  const sendCall = calls.find((entry) => entry.url.endsWith('/ilink/bot/sendmessage'))
  assert.ok(sendCall)
  const sendBody = JSON.parse(String(sendCall.init.body))
  assert.equal(sendBody.msg.to_user_id, 'user-1')
  assert.equal(sendBody.msg.context_token, 'ctx-1')
  assert.equal(sendBody.msg.item_list[0].type, 2)
  assert.equal(sendBody.msg.image_item, undefined)
  assert.equal(sendBody.msg.item_list[0].image_item.media.encrypt_query_param, 'download-token')
})

test('sendMediaFromPayload uploads and sends file attachment', async () => {
  const calls = []
  const originalFetch = global.fetch
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url) === 'https://example.com/report.pdf') {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get(name) { return name.toLowerCase() === 'content-type' ? 'application/pdf' : null } },
        async arrayBuffer() { return new Uint8Array([9, 8, 7, 6]).buffer },
      }
    }
    if (String(url).endsWith('/ilink/bot/getuploadurl')) {
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ret: 0, upload_param: 'upload-token' }) },
      }
    }
    if (String(url).startsWith('https://novac2c.cdn.weixin.qq.com/c2c/upload?')) {
      return {
        status: 200,
        headers: { get(name) { return name.toLowerCase() === 'x-encrypted-param' ? 'download-token-file' : null } },
        async text() { return '' },
      }
    }
    if (String(url).endsWith('/ilink/bot/sendmessage')) {
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ret: 0 }) },
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  await sendMediaFromPayload(ACCOUNT, {
    to_user_id: 'user-2',
    context_token: '',
    items: [{ type: 'file', file_type: 4, url: 'https://example.com/report.pdf' }],
  })

  global.fetch = originalFetch

  const sendCall = calls.find((entry) => entry.url.endsWith('/ilink/bot/sendmessage'))
  assert.ok(sendCall)
  const sendBody = JSON.parse(String(sendCall.init.body))
  assert.equal(sendBody.msg.to_user_id, 'user-2')
  assert.equal(sendBody.msg.item_list[0].type, 4)
  assert.equal(sendBody.msg.item_list[0].file_item.media.encrypt_query_param, 'download-token-file')
  assert.equal(sendBody.msg.item_list[0].file_item.file_name.endsWith('.pdf'), true)
})

test('sendMediaFromPayload uploads and sends video message', async () => {
  const calls = []
  const originalFetch = global.fetch
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url) === 'https://example.com/demo.mp4') {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get(name) { return name.toLowerCase() === 'content-type' ? 'video/mp4' : null } },
        async arrayBuffer() { return new Uint8Array([1, 3, 5, 7]).buffer },
      }
    }
    if (String(url).endsWith('/ilink/bot/getuploadurl')) {
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ret: 0, upload_param: 'upload-token-video' }) },
      }
    }
    if (String(url).startsWith('https://novac2c.cdn.weixin.qq.com/c2c/upload?')) {
      return {
        status: 200,
        headers: { get(name) { return name.toLowerCase() === 'x-encrypted-param' ? 'download-token-video' : null } },
        async text() { return '' },
      }
    }
    if (String(url).endsWith('/ilink/bot/sendmessage')) {
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ret: 0 }) },
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  await sendMediaFromPayload(ACCOUNT, {
    to_user_id: 'user-3',
    context_token: 'ctx-video',
    items: [{ type: 'file', file_type: 2, url: 'https://example.com/demo.mp4' }],
  })

  global.fetch = originalFetch

  const sendCall = calls.find((entry) => entry.url.endsWith('/ilink/bot/sendmessage'))
  assert.ok(sendCall)
  const sendBody = JSON.parse(String(sendCall.init.body))
  assert.equal(sendBody.msg.to_user_id, 'user-3')
  assert.equal(sendBody.msg.context_token, 'ctx-video')
  assert.equal(sendBody.msg.item_list[0].type, 5)
  assert.equal(sendBody.msg.item_list[0].video_item.media.encrypt_query_param, 'download-token-video')
})

test('sendMediaFromPayload uploads and sends voice message', async () => {
  const calls = []
  const originalFetch = global.fetch
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url) === 'https://example.com/voice.mp3') {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get(name) { return name.toLowerCase() === 'content-type' ? 'audio/mpeg' : null } },
        async arrayBuffer() { return new Uint8Array([9, 9, 9, 9]).buffer },
      }
    }
    if (String(url).endsWith('/ilink/bot/getuploadurl')) {
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ret: 0, upload_param: 'upload-token-voice' }) },
      }
    }
    if (String(url).startsWith('https://novac2c.cdn.weixin.qq.com/c2c/upload?')) {
      return {
        status: 200,
        headers: { get(name) { return name.toLowerCase() === 'x-encrypted-param' ? 'download-token-voice' : null } },
        async text() { return '' },
      }
    }
    if (String(url).endsWith('/ilink/bot/sendmessage')) {
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ret: 0 }) },
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  await sendMediaFromPayload(ACCOUNT, {
    to_user_id: 'user-4',
    context_token: 'ctx-voice',
    items: [{ type: 'file', file_type: 3, url: 'https://example.com/voice.mp3' }],
  })

  global.fetch = originalFetch

  const sendCall = calls.find((entry) => entry.url.endsWith('/ilink/bot/sendmessage'))
  assert.ok(sendCall)
  const sendBody = JSON.parse(String(sendCall.init.body))
  assert.equal(sendBody.msg.to_user_id, 'user-4')
  assert.equal(sendBody.msg.context_token, 'ctx-voice')
  assert.equal(sendBody.msg.item_list[0].type, 3)
  assert.equal(sendBody.msg.item_list[0].voice_item.media.encrypt_query_param, 'download-token-voice')
  assert.equal(sendBody.msg.item_list[0].voice_item.encode_type, 7)
})

test('sendMediaFromPayload accepts absolute local file path', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weixin-local-file-'))
  const localFile = path.join(tempRoot, 'report.pdf')
  await fs.writeFile(localFile, Buffer.from([1, 2, 3, 4]))

  const calls = []
  const originalFetch = global.fetch
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/ilink/bot/getuploadurl')) {
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ret: 0, upload_param: 'upload-token-local' }) },
      }
    }
    if (String(url).startsWith('https://novac2c.cdn.weixin.qq.com/c2c/upload?')) {
      return {
        status: 200,
        headers: { get(name) { return name.toLowerCase() === 'x-encrypted-param' ? 'download-token-local' : null } },
        async text() { return '' },
      }
    }
    if (String(url).endsWith('/ilink/bot/sendmessage')) {
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ret: 0 }) },
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  await sendMediaFromPayload(ACCOUNT, {
    to_user_id: 'user-local',
    context_token: '',
    items: [{ type: 'file', file_type: 4, url: localFile }],
  })

  global.fetch = originalFetch
  await fs.rm(tempRoot, { recursive: true, force: true })

  const sendCall = calls.find((entry) => entry.url.endsWith('/ilink/bot/sendmessage'))
  assert.ok(sendCall)
  const sendBody = JSON.parse(String(sendCall.init.body))
  assert.equal(sendBody.msg.item_list[0].file_item.file_name, 'report.pdf')
})

test('sendMediaFromPayload accepts file url', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weixin-file-url-'))
  const localFile = path.join(tempRoot, 'voice.mp3')
  await fs.writeFile(localFile, Buffer.from([9, 8, 7, 6]))

  const calls = []
  const originalFetch = global.fetch
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/ilink/bot/getuploadurl')) {
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ret: 0, upload_param: 'upload-token-file-url' }) },
      }
    }
    if (String(url).startsWith('https://novac2c.cdn.weixin.qq.com/c2c/upload?')) {
      return {
        status: 200,
        headers: { get(name) { return name.toLowerCase() === 'x-encrypted-param' ? 'download-token-file-url' : null } },
        async text() { return '' },
      }
    }
    if (String(url).endsWith('/ilink/bot/sendmessage')) {
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ret: 0 }) },
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  await sendMediaFromPayload(ACCOUNT, {
    to_user_id: 'user-file-url',
    context_token: 'ctx-file',
    items: [{ type: 'file', file_type: 3, url: `file://${localFile}` }],
  })

  global.fetch = originalFetch
  await fs.rm(tempRoot, { recursive: true, force: true })

  const sendCall = calls.find((entry) => entry.url.endsWith('/ilink/bot/sendmessage'))
  assert.ok(sendCall)
  const sendBody = JSON.parse(String(sendCall.init.body))
  assert.equal(sendBody.msg.item_list[0].voice_item.encode_type, 7)
})
