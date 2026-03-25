import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { FileStore } from './file-store.js'

async function createTempStore() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weixin-gateway-store-'))
  const store = new FileStore(dataDir)
  await store.init()
  return { store, dataDir }
}

test('FileStore enqueueInboxMessage deduplicates by account_id and event_id', async () => {
  const { store, dataDir } = await createTempStore()
  try {
    const first = await store.enqueueInboxMessage({
      account_id: 'bot-1',
      event_id: 'evt-1',
      user_id: 'wx-user-1',
      text: '你好',
    })
    const second = await store.enqueueInboxMessage({
      account_id: 'bot-1',
      event_id: 'evt-1',
      user_id: 'wx-user-1',
      text: '你好',
    })
    const messages = await store.listInboxMessages({ status: 'pending', limit: 10 })
    assert.equal(first.id, second.id)
    assert.equal(messages.length, 1)
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('FileStore claim/complete/fail updates inbox message lifecycle', async () => {
  const { store, dataDir } = await createTempStore()
  try {
    const message = await store.enqueueInboxMessage({
      account_id: 'bot-1',
      event_id: 'evt-2',
      user_id: 'wx-user-2',
      text: '帮我看一下状态',
    })
    const claimed = await store.claimInboxMessage(message.id, 'codex')
    assert.equal(claimed.status, 'claimed')
    assert.equal(claimed.claim.worker_id, 'codex')

    const failed = await store.failInboxMessage(message.id, 'temporary failure')
    assert.equal(failed.status, 'failed')
    assert.equal(failed.error, 'temporary failure')

    const completed = await store.completeInboxMessage(message.id, { completion_note: 'done' })
    assert.equal(completed.status, 'completed')
    assert.equal(completed.completion_note, 'done')
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})
