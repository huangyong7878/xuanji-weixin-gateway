import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const STATE_FILE = 'state.json'
const STATE_TMP_FILE = 'state.json.tmp'
const ZERO_ACCOUNTS_BACKUP_PREFIX = 'state.before-zero-accounts'
const LOG_PREFIX = '[weixin-gateway] FileStore'

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

function summarizeState(state) {
  return {
    accounts: Object.keys(state?.accounts || {}).length,
    login_sessions: Object.keys(state?.login_sessions || {}).length,
    inbox_messages: Object.keys(state?.inbox_messages || {}).length,
    send_tasks: Object.keys(state?.send_tasks || {}).length,
  }
}

function previewRaw(raw) {
  return String(raw || '').replace(/\s+/g, ' ').slice(0, 200)
}

function buildZeroAccountsBackupPath(dataDir) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(dataDir, `${ZERO_ACCOUNTS_BACKUP_PREFIX}.${timestamp}.json`)
}

async function readJson(filePath, fallback) {
  let raw = ''
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error(
        `${LOG_PREFIX} readState failed`,
        JSON.stringify({
          path: filePath,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }
    return fallback
  }

  try {
    return JSON.parse(raw)
  } catch (error) {
    console.error(
      `${LOG_PREFIX} parseState failed`,
      JSON.stringify({
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
        body_length: raw.length,
        raw_preview: previewRaw(raw),
      }),
    )
    return fallback
  }
}

export class FileStore {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.statePath = path.join(dataDir, STATE_FILE)
    this.stateTmpPath = path.join(dataDir, STATE_TMP_FILE)
  }

  async init() {
    await ensureDir(this.dataDir)
    const state = await this.loadState()
    if (!state.accounts || !state.login_sessions || !state.inbox_messages || !state.send_tasks) {
      await this.saveState({
        accounts: state.accounts || {},
        login_sessions: state.login_sessions || {},
        inbox_messages: state.inbox_messages || {},
        send_tasks: state.send_tasks || {},
      })
    }
    console.info(
      `${LOG_PREFIX} init`,
      JSON.stringify({
        path: this.statePath,
        ...summarizeState(await this.loadState()),
      }),
    )
  }

  async loadState() {
    return await readJson(this.statePath, {
      accounts: {},
      login_sessions: {},
      inbox_messages: {},
      send_tasks: {},
    })
  }

  async saveState(state) {
    await ensureDir(this.dataDir)
    const previous = await this.loadState()
    const before = summarizeState(previous)
    const after = summarizeState(state)
    if (before.accounts > 0 && after.accounts === 0) {
      const backupPath = buildZeroAccountsBackupPath(this.dataDir)
      await fs.writeFile(backupPath, JSON.stringify(previous, null, 2), 'utf8')
      console.error(
        `${LOG_PREFIX} accounts dropped to zero`,
        JSON.stringify({
          path: this.statePath,
          before,
          after,
          previous_account_ids: Object.keys(previous.accounts || {}),
          backup_path: backupPath,
        }),
      )
    }
    const payload = JSON.stringify(state, null, 2)
    await fs.writeFile(this.stateTmpPath, payload, 'utf8')
    await fs.rename(this.stateTmpPath, this.statePath)
  }

  async listAccounts() {
    const state = await this.loadState()
    return Object.values(state.accounts || {})
  }

  async getAccount(accountId) {
    const state = await this.loadState()
    return state.accounts?.[accountId] || null
  }

  async upsertAccount(account) {
    const state = await this.loadState()
    state.accounts ||= {}
    state.accounts[account.account_id] = {
      ...state.accounts[account.account_id],
      ...account,
      updated_at: new Date().toISOString(),
    }
    await this.saveState(state)
    console.info(
      `${LOG_PREFIX} upsertAccount`,
      JSON.stringify({
        account_id: account.account_id,
        user_id: String(account.user_id || ''),
        wechat_uin: String(account.wechat_uin || ''),
        account_count: Object.keys(state.accounts || {}).length,
      }),
    )
    return state.accounts[account.account_id]
  }

  async removeAccount(accountId) {
    const state = await this.loadState()
    const existing = state.accounts?.[accountId] || null
    if (!existing) {
      return null
    }
    delete state.accounts[accountId]
    await this.saveState(state)
    console.warn(
      `${LOG_PREFIX} removeAccount`,
      JSON.stringify({
        account_id: accountId,
        remaining_account_ids: Object.keys(state.accounts || {}),
      }),
    )
    return existing
  }

  async removeOtherAccountsForUser(userId, keepAccountId) {
    if (!userId) {
      return []
    }
    const state = await this.loadState()
    const removed = []
    for (const [accountId, account] of Object.entries(state.accounts || {})) {
      if (accountId === keepAccountId) {
        continue
      }
      if (String(account?.user_id || '') !== userId) {
        continue
      }
      removed.push(accountId)
      delete state.accounts[accountId]
    }
    if (removed.length > 0) {
      await this.saveState(state)
      console.warn(
        `${LOG_PREFIX} removeOtherAccountsForUser`,
        JSON.stringify({
          user_id: userId,
          keep_account_id: keepAccountId,
          removed_account_ids: removed,
          remaining_account_ids: Object.keys(state.accounts || {}),
        }),
      )
    }
    return removed
  }

  async updateCursor(accountId, cursor) {
    const state = await this.loadState()
    const existing = state.accounts?.[accountId]
    if (!existing) {
      return null
    }
    existing.cursor = cursor
    existing.updated_at = new Date().toISOString()
    await this.saveState(state)
    return existing
  }

  async updateAccount(accountId, patch) {
    const state = await this.loadState()
    const existing = state.accounts?.[accountId]
    if (!existing) {
      return null
    }
    state.accounts[accountId] = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    }
    await this.saveState(state)
    return state.accounts[accountId]
  }

  async createLoginSession(session) {
    const state = await this.loadState()
    state.login_sessions ||= {}
    state.login_sessions[session.session_id] = session
    await this.saveState(state)
    return session
  }

  async getLoginSession(sessionId) {
    const state = await this.loadState()
    return state.login_sessions?.[sessionId] || null
  }

  async updateLoginSession(sessionId, patch) {
    const state = await this.loadState()
    if (!state.login_sessions?.[sessionId]) {
      return null
    }
    state.login_sessions[sessionId] = {
      ...state.login_sessions[sessionId],
      ...patch,
      updated_at: new Date().toISOString(),
    }
    await this.saveState(state)
    return state.login_sessions[sessionId]
  }

  async deleteLoginSession(sessionId) {
    const state = await this.loadState()
    const existing = state.login_sessions?.[sessionId] || null
    if (!existing) {
      return null
    }
    delete state.login_sessions[sessionId]
    await this.saveState(state)
    return existing
  }

  async enqueueInboxMessage(message) {
    const state = await this.loadState()
    state.inbox_messages ||= {}
    const eventId = String(message.event_id || '').trim()
    const accountId = String(message.account_id || '').trim()
    const dedupeKey = eventId && accountId ? `${accountId}:${eventId}` : ''
    if (dedupeKey) {
      const existing = Object.values(state.inbox_messages).find((item) => item?.dedupe_key === dedupeKey) || null
      if (existing) {
        return existing
      }
    }
    const messageId = crypto.randomUUID()
    const now = new Date().toISOString()
    const record = {
      id: messageId,
      dedupe_key: dedupeKey,
      status: 'pending',
      claim: null,
      error: '',
      callback_attempted: false,
      callback_succeeded: false,
      created_at: now,
      updated_at: now,
      ...message,
    }
    state.inbox_messages[messageId] = record
    await this.saveState(state)
    return record
  }

  async listInboxMessages(options = {}) {
    const state = await this.loadState()
    const status = String(options.status || '').trim()
    const limit = Number(options.limit || 20)
    const accountId = String(options.account_id || '').trim()
    const items = Object.values(state.inbox_messages || {})
      .filter((item) => {
        if (status && String(item?.status || '') !== status) {
          return false
        }
        if (accountId && String(item?.account_id || '') !== accountId) {
          return false
        }
        return true
      })
      .sort((left, right) => String(left.created_at || '').localeCompare(String(right.created_at || '')))
    return items.slice(0, Math.max(1, limit))
  }

  async getInboxMessage(messageId) {
    const state = await this.loadState()
    return state.inbox_messages?.[messageId] || null
  }

  async updateInboxMessage(messageId, patch) {
    const state = await this.loadState()
    if (!state.inbox_messages?.[messageId]) {
      return null
    }
    state.inbox_messages[messageId] = {
      ...state.inbox_messages[messageId],
      ...patch,
      updated_at: new Date().toISOString(),
    }
    await this.saveState(state)
    return state.inbox_messages[messageId]
  }

  async claimInboxMessage(messageId, workerId = '') {
    const current = await this.getInboxMessage(messageId)
    if (!current) {
      return null
    }
    if (current.status !== 'pending' && current.status !== 'failed') {
      return current
    }
    return await this.updateInboxMessage(messageId, {
      status: 'claimed',
      claim: {
        worker_id: workerId || '',
        claimed_at: new Date().toISOString(),
      },
      error: '',
    })
  }

  async completeInboxMessage(messageId, patch = {}) {
    return await this.updateInboxMessage(messageId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      ...patch,
    })
  }

  async failInboxMessage(messageId, error = '') {
    return await this.updateInboxMessage(messageId, {
      status: 'failed',
      error: String(error || ''),
      failed_at: new Date().toISOString(),
    })
  }

  async createSendTask(task) {
    const state = await this.loadState()
    state.send_tasks ||= {}
    state.send_tasks[task.task_id] = task
    await this.saveState(state)
    return task
  }

  async getSendTask(taskId) {
    const state = await this.loadState()
    return state.send_tasks?.[taskId] || null
  }

  async updateSendTask(taskId, patch) {
    const state = await this.loadState()
    if (!state.send_tasks?.[taskId]) {
      return null
    }
    state.send_tasks[taskId] = {
      ...state.send_tasks[taskId],
      ...patch,
      updated_at: new Date().toISOString(),
    }
    await this.saveState(state)
    return state.send_tasks[taskId]
  }
}
