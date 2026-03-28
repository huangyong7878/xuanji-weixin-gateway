import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeSilkBuffer } from './silk-transcode.js'

test('normalizeSilkBuffer strips tencent silk prefix byte', () => {
  const input = Buffer.concat([Buffer.from([0x02]), Buffer.from('#!SILK_V3')])
  const normalized = normalizeSilkBuffer(input)
  assert.equal(normalized.toString('ascii'), '#!SILK_V3')
})

test('normalizeSilkBuffer keeps standard silk header unchanged', () => {
  const input = Buffer.from('#!SILK_V3')
  const normalized = normalizeSilkBuffer(input)
  assert.equal(normalized.toString('ascii'), '#!SILK_V3')
})
