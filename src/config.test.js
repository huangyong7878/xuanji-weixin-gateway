import test from 'node:test'
import assert from 'node:assert/strict'

import { loadConfig } from './config.js'

test('loadConfig prefers generic upstream env vars', () => {
  const previous = {
    UPSTREAM_BASE_URL: process.env.UPSTREAM_BASE_URL,
    UPSTREAM_EVENTS_PATH: process.env.UPSTREAM_EVENTS_PATH,
    UPSTREAM_SHARED_SECRET: process.env.UPSTREAM_SHARED_SECRET,
    XUANJI_BASE_URL: process.env.XUANJI_BASE_URL,
    XUANJI_WEIXIN_CALLBACK_PATH: process.env.XUANJI_WEIXIN_CALLBACK_PATH,
    XUANJI_SHARED_SECRET: process.env.XUANJI_SHARED_SECRET,
  }

  process.env.UPSTREAM_BASE_URL = 'http://127.0.0.1:9000/'
  process.env.UPSTREAM_EVENTS_PATH = '/events/weixin'
  process.env.UPSTREAM_SHARED_SECRET = 'generic-secret'
  process.env.XUANJI_BASE_URL = 'http://127.0.0.1:8000'
  process.env.XUANJI_WEIXIN_CALLBACK_PATH = '/callback/weixin-gateway'
  process.env.XUANJI_SHARED_SECRET = 'legacy-secret'

  try {
    const config = loadConfig()
    assert.equal(config.upstreamBaseUrl, 'http://127.0.0.1:9000')
    assert.equal(config.upstreamEventsPath, '/events/weixin')
    assert.equal(config.upstreamSharedSecret, 'generic-secret')
    assert.equal(config.xuanjiBaseUrl, 'http://127.0.0.1:9000')
    assert.equal(config.xuanjiCallbackPath, '/events/weixin')
    assert.equal(config.xuanjiSharedSecret, 'generic-secret')
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
})

test('loadConfig falls back to legacy Xuanji env vars', () => {
  const previous = {
    UPSTREAM_BASE_URL: process.env.UPSTREAM_BASE_URL,
    UPSTREAM_EVENTS_PATH: process.env.UPSTREAM_EVENTS_PATH,
    UPSTREAM_SHARED_SECRET: process.env.UPSTREAM_SHARED_SECRET,
    XUANJI_BASE_URL: process.env.XUANJI_BASE_URL,
    XUANJI_WEIXIN_CALLBACK_PATH: process.env.XUANJI_WEIXIN_CALLBACK_PATH,
    XUANJI_SHARED_SECRET: process.env.XUANJI_SHARED_SECRET,
  }

  delete process.env.UPSTREAM_BASE_URL
  delete process.env.UPSTREAM_EVENTS_PATH
  delete process.env.UPSTREAM_SHARED_SECRET
  process.env.XUANJI_BASE_URL = 'http://127.0.0.1:8100/'
  process.env.XUANJI_WEIXIN_CALLBACK_PATH = '/legacy/events'
  process.env.XUANJI_SHARED_SECRET = 'legacy-only'

  try {
    const config = loadConfig()
    assert.equal(config.upstreamBaseUrl, 'http://127.0.0.1:8100')
    assert.equal(config.upstreamEventsPath, '/legacy/events')
    assert.equal(config.upstreamSharedSecret, 'legacy-only')
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
})

test('loadConfig auto starts polling by default', () => {
  const previous = process.env.WEIXIN_GATEWAY_AUTO_START
  delete process.env.WEIXIN_GATEWAY_AUTO_START

  try {
    const config = loadConfig()
    assert.equal(config.autoStartPolling, true)
  } finally {
    if (previous === undefined) {
      delete process.env.WEIXIN_GATEWAY_AUTO_START
    } else {
      process.env.WEIXIN_GATEWAY_AUTO_START = previous
    }
  }
})
