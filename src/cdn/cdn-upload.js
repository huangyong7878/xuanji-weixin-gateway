import { buildCdnUploadUrl } from './cdn-url.js'
import { encryptAesEcb } from './aes-ecb.js'

const DEFAULT_CDN_UPLOAD_TIMEOUT_MS = 30_000
const DEFAULT_CDN_UPLOAD_ATTEMPTS = 3

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
      return await uploadOnce({ ciphertext, cdnUrl, timeoutMs })
    } catch (error) {
      lastError = error
      if (!isRetryableCdnUploadError(error) || attempt >= maxAttempts) {
        throw error
      }
      await sleep(300 * attempt)
    }
  }

  throw lastError || new Error('CDN upload failed')
}
