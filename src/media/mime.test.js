import test from 'node:test'
import assert from 'node:assert/strict'

import { getExtensionFromContentTypeOrUrl } from './mime.js'

test('getExtensionFromContentTypeOrUrl prefers explicit url extension over misleading content-type', () => {
  const ext = getExtensionFromContentTypeOrUrl(
    'text/plain; charset=utf-8',
    'https://example.com/api/files/output/demo_weixin.silk?sig=abc',
  )
  assert.equal(ext, '.silk')
})
