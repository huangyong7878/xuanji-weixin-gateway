import { pollAllAccountsOnce } from './poller.js'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class PollingLoop {
  constructor(config, store) {
    this.config = config
    this.store = store
    this._running = false
    this._task = null
    this._lastStartedAt = ''
    this._lastFinishedAt = ''
    this._lastResults = []
    this._lastError = ''
  }

  get running() {
    return this._running
  }

  get status() {
    return {
      running: this._running,
      interval_ms: this.config.pollIntervalMs,
      last_started_at: this._lastStartedAt,
      last_finished_at: this._lastFinishedAt,
      last_error: this._lastError,
      last_results: this._lastResults,
    }
  }

  async startIfNeeded() {
    if (this._running) {
      return false
    }
    const accounts = await this.store.listAccounts()
    const activeAccounts = Array.isArray(accounts)
      ? accounts.filter((account) => String(account?.session_state || 'active') !== 'expired')
      : []
    if (activeAccounts.length === 0) {
      return false
    }
    await this.start()
    return true
  }

  async start() {
    if (this._running) {
      return
    }
    this._running = true
    this._task = this._run()
  }

  async stop() {
    this._running = false
    if (this._task) {
      await this._task
      this._task = null
    }
  }

  async _run() {
    while (this._running) {
      try {
        this._lastStartedAt = new Date().toISOString()
        this._lastError = ''
        this._lastResults = await pollAllAccountsOnce(this.config, this.store)
        this._lastFinishedAt = new Date().toISOString()
      } catch (error) {
        this._lastFinishedAt = new Date().toISOString()
        this._lastError = error instanceof Error ? error.message : String(error)
        console.error('[weixin-gateway] polling loop error:', error)
      }
      await sleep(this.config.pollIntervalMs)
    }
  }
}
