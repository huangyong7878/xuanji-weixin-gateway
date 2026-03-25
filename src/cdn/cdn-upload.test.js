import test from 'node:test'
import assert from 'node:assert/strict'

import { uploadBufferToCdn } from './cdn-upload.js'

const AESKEY = Buffer.alloc(16, 1)

test('uploadBufferToCdn retries retryable CDN timeout error and eventually succeeds', async () => {
  const calls = []
  const originalFetch = global.fetch

  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (calls.length === 1) {
      return {
        status: 500,
        headers: {
          get(name) {
            return name.toLowerCase() === 'x-error-message'
              ? '[DFS][RPC]: ret: 354, func_ret: 0, err: read timeout'
              : null
          },
        },
        async text() { return '' },
      }
    }
    return {
      status: 200,
      headers: {
        get(name) {
          return name.toLowerCase() === 'x-encrypted-param' ? 'download-token-ok' : null
        },
      },
      async text() { return '' },
    }
  }

  const result = await uploadBufferToCdn({
    buf: Buffer.from([1, 2, 3, 4]),
    uploadParam: 'upload-token',
    filekey: 'filekey-1',
    cdnBaseUrl: 'https://novac2c.cdn.weixin.qq.com/c2c',
    aeskey: AESKEY,
    timeoutMs: 1000,
    maxAttempts: 2,
  })

  global.fetch = originalFetch

  assert.equal(result.downloadParam, 'download-token-ok')
  assert.equal(calls.length, 2)
})

test('uploadBufferToCdn does not retry non-timeout CDN error', async () => {
  let calls = 0
  const originalFetch = global.fetch

  global.fetch = async () => {
    calls += 1
    return {
      status: 500,
      headers: {
        get() { return 'permission denied' },
      },
      async text() { return '' },
    }
  }

  await assert.rejects(
    uploadBufferToCdn({
      buf: Buffer.from([1, 2, 3, 4]),
      uploadParam: 'upload-token',
      filekey: 'filekey-2',
      cdnBaseUrl: 'https://novac2c.cdn.weixin.qq.com/c2c',
      aeskey: AESKEY,
      timeoutMs: 1000,
      maxAttempts: 3,
    }),
    /permission denied/,
  )

  global.fetch = originalFetch

  assert.equal(calls, 1)
})
