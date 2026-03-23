import { buildCdnUploadUrl } from './cdn-url.js'
import { encryptAesEcb } from './aes-ecb.js'

export async function uploadBufferToCdn({ buf, uploadParam, filekey, cdnBaseUrl, aeskey }) {
  const ciphertext = encryptAesEcb(buf, aeskey)
  const cdnUrl = buildCdnUploadUrl({ cdnBaseUrl, uploadParam, filekey })
  const response = await fetch(cdnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(ciphertext),
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
