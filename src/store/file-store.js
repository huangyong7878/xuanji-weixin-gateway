import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'

const STATE_FILE = 'state.json'
const SQLITE_FILE = 'state.sqlite'
const LOG_PREFIX = '[weixin-gateway] SqliteStore'
const MIGRATED_JSON_PREFIX = 'state.json.migrated'

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

function rowToData(row) {
  if (!row) {
    return null
  }
  return JSON.parse(String(row.data_json || '{}'))
}

function rowsToData(rows) {
  return rows.map((row) => rowToData(row)).filter(Boolean)
}

function buildMigratedJsonPath(dataDir) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(dataDir, `${MIGRATED_JSON_PREFIX}.${timestamp}.json`)
}

async function readLegacyState(filePath) {
  let raw = ''
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error(
        `${LOG_PREFIX} readLegacyState failed`,
        JSON.stringify({
          path: filePath,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }
    return null
  }

  try {
    return JSON.parse(raw)
  } catch (error) {
    console.error(
      `${LOG_PREFIX} parseLegacyState failed`,
      JSON.stringify({
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
        body_length: raw.length,
      }),
    )
    return null
  }
}

export class FileStore {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.statePath = path.join(dataDir, STATE_FILE)
    this.dbPath = path.join(dataDir, SQLITE_FILE)
    this.db = null
  }

  async init() {
    await ensureDir(this.dataDir)
    this.db = new Database(this.dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        account_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        wechat_uin TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);

      CREATE TABLE IF NOT EXISTS login_sessions (
        session_id TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT '',
        expires_at_ms INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_login_sessions_state ON login_sessions(state);

      CREATE TABLE IF NOT EXISTS inbox_messages (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        account_id TEXT NOT NULL DEFAULT '',
        dedupe_key TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_messages_dedupe_key ON inbox_messages(dedupe_key) WHERE dedupe_key <> '';
      CREATE INDEX IF NOT EXISTS idx_inbox_messages_status_created_at ON inbox_messages(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_inbox_messages_account_status_created_at ON inbox_messages(account_id, status, created_at);

      CREATE TABLE IF NOT EXISTS send_tasks (
        task_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        account_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_send_tasks_status_created_at ON send_tasks(status, created_at);
    `)
    await this.maybeMigrateLegacyState()
    console.info(
      `${LOG_PREFIX} init`,
      JSON.stringify({
        path: this.dbPath,
        ...(await this.getCounts()),
      }),
    )
  }

  async getCounts() {
    return {
      accounts: Number(this.db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count || 0),
      login_sessions: Number(this.db.prepare('SELECT COUNT(*) AS count FROM login_sessions').get().count || 0),
      inbox_messages: Number(this.db.prepare('SELECT COUNT(*) AS count FROM inbox_messages').get().count || 0),
      send_tasks: Number(this.db.prepare('SELECT COUNT(*) AS count FROM send_tasks').get().count || 0),
    }
  }

  async maybeMigrateLegacyState() {
    const counts = await this.getCounts()
    const hasExistingData = Object.values(counts).some((value) => Number(value) > 0)
    if (hasExistingData) {
      return false
    }
    const legacy = await readLegacyState(this.statePath)
    if (!legacy) {
      return false
    }
    const summary = summarizeState(legacy)
    const tx = this.db.transaction(() => {
      for (const [accountId, account] of Object.entries(legacy.accounts || {})) {
        this.db.prepare(`
          INSERT OR REPLACE INTO accounts (account_id, user_id, wechat_uin, updated_at, data_json)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          accountId,
          String(account?.user_id || ''),
          String(account?.wechat_uin || ''),
          String(account?.updated_at || ''),
          JSON.stringify(account || {}),
        )
      }
      for (const [sessionId, session] of Object.entries(legacy.login_sessions || {})) {
        this.db.prepare(`
          INSERT OR REPLACE INTO login_sessions (session_id, state, expires_at_ms, updated_at, data_json)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          sessionId,
          String(session?.state || ''),
          Number(session?.expires_at_ms || 0),
          String(session?.updated_at || ''),
          JSON.stringify(session || {}),
        )
      }
      for (const [messageId, message] of Object.entries(legacy.inbox_messages || {})) {
        this.db.prepare(`
          INSERT OR REPLACE INTO inbox_messages (id, status, account_id, dedupe_key, created_at, updated_at, data_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          messageId,
          String(message?.status || 'pending'),
          String(message?.account_id || ''),
          String(message?.dedupe_key || ''),
          String(message?.created_at || ''),
          String(message?.updated_at || ''),
          JSON.stringify(message || {}),
        )
      }
      for (const [taskId, task] of Object.entries(legacy.send_tasks || {})) {
        this.db.prepare(`
          INSERT OR REPLACE INTO send_tasks (task_id, status, account_id, created_at, updated_at, data_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          taskId,
          String(task?.status || 'pending'),
          String(task?.account_id || ''),
          String(task?.created_at || ''),
          String(task?.updated_at || ''),
          JSON.stringify(task || {}),
        )
      }
    })
    tx()
    const migratedPath = buildMigratedJsonPath(this.dataDir)
    await fs.rename(this.statePath, migratedPath)
    console.warn(
      `${LOG_PREFIX} migrated legacy state`,
      JSON.stringify({
        from: this.statePath,
        to: migratedPath,
        ...summary,
      }),
    )
    return true
  }

  async loadState() {
    return {
      accounts: Object.fromEntries((await this.listAccounts()).map((item) => [item.account_id, item])),
      login_sessions: Object.fromEntries(rowsToData(this.db.prepare('SELECT data_json FROM login_sessions').all()).map((item) => [item.session_id, item])),
      inbox_messages: Object.fromEntries(rowsToData(this.db.prepare('SELECT data_json FROM inbox_messages').all()).map((item) => [item.id, item])),
      send_tasks: Object.fromEntries(rowsToData(this.db.prepare('SELECT data_json FROM send_tasks').all()).map((item) => [item.task_id, item])),
    }
  }

  async listAccounts() {
    return rowsToData(this.db.prepare('SELECT data_json FROM accounts ORDER BY updated_at ASC, account_id ASC').all())
  }

  async getAccount(accountId) {
    return rowToData(this.db.prepare('SELECT data_json FROM accounts WHERE account_id = ?').get(accountId))
  }

  async upsertAccount(account) {
    const existing = await this.getAccount(account.account_id)
    const merged = {
      ...(existing || {}),
      ...account,
      updated_at: new Date().toISOString(),
    }
    this.db.prepare(`
      INSERT OR REPLACE INTO accounts (account_id, user_id, wechat_uin, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      merged.account_id,
      String(merged.user_id || ''),
      String(merged.wechat_uin || ''),
      String(merged.updated_at || ''),
      JSON.stringify(merged),
    )
    console.info(
      `${LOG_PREFIX} upsertAccount`,
      JSON.stringify({
        account_id: merged.account_id,
        user_id: String(merged.user_id || ''),
        wechat_uin: String(merged.wechat_uin || ''),
        account_count: Number(this.db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count || 0),
      }),
    )
    return merged
  }

  async removeAccount(accountId) {
    const existing = await this.getAccount(accountId)
    if (!existing) {
      return null
    }
    this.db.prepare('DELETE FROM accounts WHERE account_id = ?').run(accountId)
    console.warn(
      `${LOG_PREFIX} removeAccount`,
      JSON.stringify({
        account_id: accountId,
        remaining_account_ids: this.db.prepare('SELECT account_id FROM accounts ORDER BY account_id ASC').all().map((row) => row.account_id),
      }),
    )
    return existing
  }

  async removeOtherAccountsForUser(userId, keepAccountId) {
    if (!userId) {
      return []
    }
    const rows = this.db.prepare('SELECT account_id FROM accounts WHERE user_id = ? AND account_id <> ? ORDER BY account_id ASC').all(userId, keepAccountId)
    const removed = rows.map((row) => row.account_id)
    if (removed.length === 0) {
      return []
    }
    this.db.prepare('DELETE FROM accounts WHERE user_id = ? AND account_id <> ?').run(userId, keepAccountId)
    console.warn(
      `${LOG_PREFIX} removeOtherAccountsForUser`,
      JSON.stringify({
        user_id: userId,
        keep_account_id: keepAccountId,
        removed_account_ids: removed,
        remaining_account_ids: this.db.prepare('SELECT account_id FROM accounts ORDER BY account_id ASC').all().map((row) => row.account_id),
      }),
    )
    return removed
  }

  async updateCursor(accountId, cursor) {
    return await this.updateAccount(accountId, { cursor })
  }

  async updateAccount(accountId, patch) {
    const existing = await this.getAccount(accountId)
    if (!existing) {
      return null
    }
    const merged = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    }
    this.db.prepare(`
      UPDATE accounts
      SET user_id = ?, wechat_uin = ?, updated_at = ?, data_json = ?
      WHERE account_id = ?
    `).run(
      String(merged.user_id || ''),
      String(merged.wechat_uin || ''),
      String(merged.updated_at || ''),
      JSON.stringify(merged),
      accountId,
    )
    return merged
  }

  async createLoginSession(session) {
    this.db.prepare(`
      INSERT OR REPLACE INTO login_sessions (session_id, state, expires_at_ms, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      session.session_id,
      String(session.state || ''),
      Number(session.expires_at_ms || 0),
      String(session.updated_at || ''),
      JSON.stringify(session),
    )
    return session
  }

  async getLoginSession(sessionId) {
    return rowToData(this.db.prepare('SELECT data_json FROM login_sessions WHERE session_id = ?').get(sessionId))
  }

  async updateLoginSession(sessionId, patch) {
    const existing = await this.getLoginSession(sessionId)
    if (!existing) {
      return null
    }
    const merged = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    }
    this.db.prepare(`
      UPDATE login_sessions
      SET state = ?, expires_at_ms = ?, updated_at = ?, data_json = ?
      WHERE session_id = ?
    `).run(
      String(merged.state || ''),
      Number(merged.expires_at_ms || 0),
      String(merged.updated_at || ''),
      JSON.stringify(merged),
      sessionId,
    )
    return merged
  }

  async deleteLoginSession(sessionId) {
    const existing = await this.getLoginSession(sessionId)
    if (!existing) {
      return null
    }
    this.db.prepare('DELETE FROM login_sessions WHERE session_id = ?').run(sessionId)
    return existing
  }

  async enqueueInboxMessage(message) {
    const eventId = String(message.event_id || '').trim()
    const accountId = String(message.account_id || '').trim()
    const dedupeKey = eventId && accountId ? `${accountId}:${eventId}` : ''
    if (dedupeKey) {
      const existing = rowToData(this.db.prepare('SELECT data_json FROM inbox_messages WHERE dedupe_key = ?').get(dedupeKey))
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
    this.db.prepare(`
      INSERT INTO inbox_messages (id, status, account_id, dedupe_key, created_at, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      String(record.status || 'pending'),
      String(record.account_id || ''),
      String(record.dedupe_key || ''),
      String(record.created_at || ''),
      String(record.updated_at || ''),
      JSON.stringify(record),
    )
    return record
  }

  async listInboxMessages(options = {}) {
    const status = String(options.status || '').trim()
    const limit = Math.max(1, Number(options.limit || 20) || 20)
    const accountId = String(options.account_id || '').trim()
    const clauses = []
    const params = []
    if (status) {
      clauses.push('status = ?')
      params.push(status)
    }
    if (accountId) {
      clauses.push('account_id = ?')
      params.push(accountId)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db.prepare(`SELECT data_json FROM inbox_messages ${where} ORDER BY created_at ASC LIMIT ?`).all(...params, limit)
    return rowsToData(rows)
  }

  async getInboxMessage(messageId) {
    return rowToData(this.db.prepare('SELECT data_json FROM inbox_messages WHERE id = ?').get(messageId))
  }

  async updateInboxMessage(messageId, patch) {
    const existing = await this.getInboxMessage(messageId)
    if (!existing) {
      return null
    }
    const merged = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    }
    this.db.prepare(`
      UPDATE inbox_messages
      SET status = ?, account_id = ?, dedupe_key = ?, created_at = ?, updated_at = ?, data_json = ?
      WHERE id = ?
    `).run(
      String(merged.status || ''),
      String(merged.account_id || ''),
      String(merged.dedupe_key || ''),
      String(merged.created_at || ''),
      String(merged.updated_at || ''),
      JSON.stringify(merged),
      messageId,
    )
    return merged
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
      claim: { worker_id: workerId || '', claimed_at: new Date().toISOString() },
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
    this.db.prepare(`
      INSERT OR REPLACE INTO send_tasks (task_id, status, account_id, created_at, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      task.task_id,
      String(task.status || 'pending'),
      String(task.account_id || ''),
      String(task.created_at || ''),
      String(task.updated_at || ''),
      JSON.stringify(task),
    )
    return task
  }

  async getSendTask(taskId) {
    return rowToData(this.db.prepare('SELECT data_json FROM send_tasks WHERE task_id = ?').get(taskId))
  }

  async updateSendTask(taskId, patch) {
    const existing = await this.getSendTask(taskId)
    if (!existing) {
      return null
    }
    const merged = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    }
    this.db.prepare(`
      UPDATE send_tasks
      SET status = ?, account_id = ?, created_at = ?, updated_at = ?, data_json = ?
      WHERE task_id = ?
    `).run(
      String(merged.status || ''),
      String(merged.account_id || ''),
      String(merged.created_at || ''),
      String(merged.updated_at || ''),
      JSON.stringify(merged),
      taskId,
    )
    return merged
  }
}
