import { buildCdnUploadUrl } from './cdn-url.js'
import { encryptAesEcb } from './aes-ecb.js'

const DEFAULT_CDN_UPLOAD_TIMEOUT_MS = 30_000
const DEFAULT_CDN_UPLOAD_ATTEMPTS = 3

function nowIso() {
  return new Date().toISOString()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableCdnUploadError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return (
    message.includes('read timeout')
    || message.includes('ret: 354')
    || message.includes('timeout')
    || message.includes('aborterror')
  )
}

async function uploadOnce({ ciphertext, cdnUrl, timeoutMs }) {
  console.error('[weixin-gateway]  request', JSON.stringify({
    timestamp: nowIso(),
    cdn_url_host: (() => {
      try {
        return new URL(cdnUrl).host
      } catch {
        return ''
      }
    })(),
    ciphertext_size: ciphertext.byteLength,
    timeout_ms: timeoutMs,
  }))
  const response = await fetch(cdnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(ciphertext),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (response.status !== 200) {
    const errMsg = response.headers.get('x-error-message') || (await response.text())
    throw new Error(`CDN upload failed: ${response.status} ${errMsg}`)
  }
  const downloadParam = response.headers.get('x-encrypted-param')
  if (!downloadParam) {
    throw new Error('CDN upload response missing x-encrypted-param header')
  }
  console.error('[weixin-gateway] uploadBufferToCdn response', JSON.stringify({
    timestamp: nowIso(),
    status: response.status,
    has_download_param: true,
  }))
  return { downloadParam }
}

export async function uploadBufferToCdn({
  buf,
  uploadParam,
  uploadFullUrl,
  filekey,
  cdnBaseUrl,
  aeskey,
  timeoutMs = DEFAULT_CDN_UPLOAD_TIMEOUT_MS,
  maxAttempts = DEFAULT_CDN_UPLOAD_ATTEMPTS,
}) {
  const ciphertext = encryptAesEcb(buf, aeskey)
  const cdnUrl = buildCdnUploadUrl({ cdnBaseUrl, uploadParam, uploadFullUrl, filekey })
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.error('[weixin-gateway] uploadBufferToCdn attempt', JSON.stringify({
        timestamp: nowIso(),
        attempt,
        max_attempts: maxAttempts,
      }))
      return await uploadOnce({ ciphertext, cdnUrl, timeoutMs })
    } catch (error) {
      lastError = error
      console.error('[weixin-gateway] uploadBufferToCdn failure', JSON.stringify({
        timestamp: nowIso(),
        attempt,
        max_attempts: maxAttempts,
        error: String(error?.message || error || ''),
        retryable: isRetryableCdnUploadError(error),
      }))
      if ( attempt >= maxAttempts) {
        throw error
      }
      await sleep(300 * attempt)
    }
  }

  throw lastError || new Error('CDN upload failed')
}
