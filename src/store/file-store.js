import fs from 'node:fs/promises'
import path from 'node:path'

const STATE_FILE = 'state.json'

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export class FileStore {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.statePath = path.join(dataDir, STATE_FILE)
  }

  async init() {
    await ensureDir(this.dataDir)
    const state = await this.loadState()
    if (!state.accounts || !state.login_sessions) {
      await this.saveState({
        accounts: state.accounts || {},
        login_sessions: state.login_sessions || {},
      })
    }
  }

  async loadState() {
    return await readJson(this.statePath, { accounts: {}, login_sessions: {} })
  }

  async saveState(state) {
    await ensureDir(this.dataDir)
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf8')
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
}
