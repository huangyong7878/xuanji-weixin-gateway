import test from 'node:test'
import assert from 'node:assert/strict'

import { runCli } from './cli.js'

test('runCli prints login:start summary', async () => {
  const calls = []
  const originalFetch = global.fetch
  global.fetch = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      async text() {
        return JSON.stringify({
          ok: true,
          session: {
            session_id: 'sess-1',
            state: 'pending',
            qrcode: 'qr-123',
            qrcode_url: 'https://example.com/qr.png',
          },
        })
      },
    }
  }

  const lines = []
  const io = {
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(`ERR:${args.join(' ')}`),
  }
  const code = await runCli(
    ['login:start', '--api-base-url', 'https://wx.example.com', '--account-id', 'acc-1'],
    io,
  )

  global.fetch = originalFetch

  assert.equal(code, 0)
  assert.equal(calls.length, 1)
  assert.match(String(calls[0].url), /\/login\/qr\/start$/)
  assert.ok(lines.some((line) => line.includes('session_id=sess-1')))
  assert.ok(lines.some((line) => line.includes('qrcode=qr-123')))
})

test('runCli uses default ilink api base url for login:start', async () => {
  const calls = []
  const originalFetch = global.fetch
  global.fetch = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      async text() {
        return JSON.stringify({
          ok: true,
          session: {
            session_id: 'sess-default',
            state: 'pending',
            qrcode: 'qr-default',
            qrcode_url: 'https://example.com/default.png',
          },
        })
      },
    }
  }

  const code = await runCli(['login:start'], {
    log() {},
    error() {},
  })

  global.fetch = originalFetch

  assert.equal(code, 0)
  const body = JSON.parse(String(calls[0].init.body))
  assert.equal(body.api_base_url, 'https://ilinkai.weixin.qq.com')
})

test('runCli validates required flags', async () => {
  const errors = []
  const code = await runCli(['login:status'], {
    log() {},
    error: (...args) => errors.push(args.join(' ')),
  })

  assert.equal(code, 1)
  assert.ok(errors.some((line) => line.includes('--session-id is required')))
})

test('runCli prints friendly hint when gateway is offline', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => {
    throw new Error('fetch failed')
  }

  const errors = []
  const code = await runCli(['health'], {
    log() {},
    error: (...args) => errors.push(args.join(' ')),
  })

  global.fetch = originalFetch

  assert.equal(code, 1)
  assert.ok(errors.some((line) => line.includes('无法连接到 weixin-gateway')))
  assert.ok(errors.some((line) => line.includes('node src/server.js')))
})

test('runCli login:watch polls until completed', async () => {
  const originalFetch = global.fetch
  let count = 0
  global.fetch = async () => {
    count += 1
    return {
      ok: true,
      async text() {
        if (count === 1) {
          return JSON.stringify({
            ok: true,
            session: { session_id: 'sess-watch', state: 'wait', message: '等待扫码中。' },
          })
        }
        return JSON.stringify({
          ok: true,
          session: { session_id: 'sess-watch', state: 'completed', message: '微信登录成功。', account_id: 'bot-1' },
        })
      },
    }
  }

  const lines = []
  const code = await runCli(
    ['login:watch', '--session-id', 'sess-watch', '--interval-ms', '1', '--timeout-ms', '1000'],
    {
      log: (...args) => lines.push(args.join(' ')),
      error: (...args) => lines.push(`ERR:${args.join(' ')}`),
    },
  )

  global.fetch = originalFetch

  assert.equal(code, 0)
  assert.ok(lines.some((line) => line.includes('state=wait')))
  assert.ok(lines.some((line) => line.includes('state=completed')))
})

test('runCli poll:status prints polling summary', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({
        ok: true,
        polling: {
          running: true,
          interval_ms: 5000,
          last_started_at: '2026-03-23T22:00:00.000Z',
          last_finished_at: '2026-03-23T22:00:01.000Z',
          last_error: '',
        },
      })
    },
  })

  const lines = []
  const code = await runCli(['poll:status'], {
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(`ERR:${args.join(' ')}`),
  })

  global.fetch = originalFetch

  assert.equal(code, 0)
  assert.ok(lines.some((line) => line.includes('polling=true interval_ms=5000')))
  assert.ok(lines.some((line) => line.includes('last_started_at=2026-03-23T22:00:00.000Z')))
  assert.ok(lines.some((line) => line.includes('last_finished_at=2026-03-23T22:00:01.000Z')))
})

test('runCli accounts:show prints account details and status', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({
        ok: true,
        account: {
          account_id: 'bot-1',
          api_base_url: 'https://ilinkai.weixin.qq.com',
          wechat_uin: 'user-1@im.wechat',
          cursor: 'cursor-1',
          status: {
            polling_running: true,
            last_forwarded: 2,
            last_error: '',
          },
        },
      })
    },
  })

  const lines = []
  const code = await runCli(['accounts:show', '--account-id', 'bot-1'], {
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(`ERR:${args.join(' ')}`),
  })

  global.fetch = originalFetch

  assert.equal(code, 0)
  assert.ok(lines.some((line) => line.includes('account_id=bot-1')))
  assert.ok(lines.some((line) => line.includes('wechat_uin=user-1@im.wechat')))
  assert.ok(lines.some((line) => line.includes('last_forwarded=2')))
})

test('runCli accounts:remove prints removed account summary', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({
        ok: true,
        removed: {
          account_id: 'bot-1',
        },
        polling: {
          running: false,
        },
      })
    },
  })

  const lines = []
  const code = await runCli(['accounts:remove', '--account-id', 'bot-1'], {
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(`ERR:${args.join(' ')}`),
  })

  global.fetch = originalFetch

  assert.equal(code, 0)
  assert.ok(lines.some((line) => line.includes('removed=bot-1')))
  assert.ok(lines.some((line) => line.includes('polling=false')))
})
