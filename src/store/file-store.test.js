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

test('FileStore create/update send task persists async send lifecycle', async () => {
  const { store, dataDir } = await createTempStore()
  try {
    const created = await store.createSendTask({
      task_id: 'task-1',
      status: 'pending',
      account_id: 'bot-1',
      to_user_id: 'wx-user-3',
      chat_type: 'c2c',
      item_types: ['file'],
      payload: { items: [{ type: 'file' }] },
      result: null,
      error: '',
      created_at: new Date().toISOString(),
      updated_at: '',
      started_at: '',
      completed_at: '',
      failed_at: '',
    })
    assert.equal(created.task_id, 'task-1')
    assert.equal(created.status, 'pending')

    const running = await store.updateSendTask('task-1', {
      status: 'running',
      started_at: new Date().toISOString(),
    })
    assert.equal(running.status, 'running')

    const completed = await store.updateSendTask('task-1', {
      status: 'completed',
      result: { ok: true },
      completed_at: new Date().toISOString(),
    })
    assert.equal(completed.status, 'completed')
    assert.deepEqual(completed.result, { ok: true })

    const loaded = await store.getSendTask('task-1')
    assert.equal(loaded.status, 'completed')
    assert.deepEqual(loaded.result, { ok: true })
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})

test('FileStore migrates legacy state.json into sqlite and renames source file', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weixin-gateway-store-'))
  try {
    await fs.writeFile(
      path.join(dataDir, 'state.json'),
      JSON.stringify({
        accounts: {
          'bot-1': { account_id: 'bot-1', user_id: 'wx-1', wechat_uin: 'wx-1', updated_at: '2026-01-01T00:00:00.000Z' },
        },
        login_sessions: {
          'sess-1': { session_id: 'sess-1', state: 'pending', expires_at_ms: 123, updated_at: '2026-01-01T00:00:00.000Z' },
        },
        inbox_messages: {
          'msg-1': { id: 'msg-1', status: 'pending', account_id: 'bot-1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
        },
        send_tasks: {
          'task-1': { task_id: 'task-1', status: 'failed', account_id: 'bot-1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
        },
      }),
      'utf8',
    )
    const store = new FileStore(dataDir)
    await store.init()
    const account = await store.getAccount('bot-1')
    const session = await store.getLoginSession('sess-1')
    const inbox = await store.getInboxMessage('msg-1')
    const task = await store.getSendTask('task-1')
    assert.equal(account.account_id, 'bot-1')
    assert.equal(session.session_id, 'sess-1')
    assert.equal(inbox.id, 'msg-1')
    assert.equal(task.task_id, 'task-1')
    const files = await fs.readdir(dataDir)
    assert.ok(files.includes('state.sqlite'))
    assert.ok(files.some((name) => name.startsWith('state.json.migrated.')))
    assert.equal(files.includes('state.json'), false)
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true })
  }
})
