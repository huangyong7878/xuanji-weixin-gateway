import { decryptAesEcb } from './aes-ecb.js'
import { buildCdnDownloadUrl } from './cdn-url.js'

function parseAesKey(aesKeyBase64) {
  const decoded = Buffer.from(aesKeyBase64, 'base64')
  if (decoded.length === 16) {
    return decoded
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex')
  }
  throw new Error(`unsupported aes_key encoding, decoded length=${decoded.length}`)
}

async function fetchCdnBytes(url) {
  const response = await fetch(url)
  if (!response.ok) {
    const body = await response.text().catch(() => '(unreadable)')
    throw new Error(`CDN download failed: ${response.status} ${response.statusText} body=${body}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

export async function downloadAndDecryptBuffer(encryptedQueryParam, aesKeyBase64, cdnBaseUrl) {
  const key = parseAesKey(aesKeyBase64)
  const encrypted = await fetchCdnBytes(buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl))
  return decryptAesEcb(encrypted, key)
}
