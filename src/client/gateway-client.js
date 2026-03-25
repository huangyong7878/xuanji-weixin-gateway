function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

async function parseJson(response) {
  const text = await response.text()
  if (!text) {
    return {}
  }
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

async function requestJson(baseUrl, method, path, body) {
  const response = await fetch(joinUrl(baseUrl, path), {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await parseJson(response)
  if (!response.ok) {
    throw new Error(data?.error || data?.errmsg || `HTTP ${response.status}`)
  }
  return data
}

export function createGatewayClient(baseUrl) {
  return {
    async health() {
      return await requestJson(baseUrl, 'GET', '/health')
    },
    async listAccounts() {
      return await requestJson(baseUrl, 'GET', '/accounts')
    },
    async getAccount(accountId) {
      return await requestJson(baseUrl, 'GET', `/accounts/${encodeURIComponent(accountId)}`)
    },
    async listInboxMessages(options = {}) {
      const query = new URLSearchParams()
      if (options.status) {
        query.set('status', String(options.status))
      }
      if (options.limit !== undefined) {
        query.set('limit', String(options.limit))
      }
      if (options.account_id) {
        query.set('account_id', String(options.account_id))
      }
      const suffix = query.size > 0 ? `?${query.toString()}` : ''
      return await requestJson(baseUrl, 'GET', `/inbox/messages${suffix}`)
    },
    async getInboxMessage(messageId) {
      return await requestJson(baseUrl, 'GET', `/inbox/messages/${encodeURIComponent(messageId)}`)
    },
    async claimInboxMessage(messageId, workerId = '') {
      return await requestJson(baseUrl, 'POST', `/inbox/messages/${encodeURIComponent(messageId)}/claim`, {
        worker_id: workerId,
      })
    },
    async completeInboxMessage(messageId, completionNote = '') {
      return await requestJson(baseUrl, 'POST', `/inbox/messages/${encodeURIComponent(messageId)}/complete`, {
        completion_note: completionNote,
      })
    },
    async failInboxMessage(messageId, error = '') {
      return await requestJson(baseUrl, 'POST', `/inbox/messages/${encodeURIComponent(messageId)}/fail`, {
        error,
      })
    },
    async startQrLogin(payload) {
      return await requestJson(baseUrl, 'POST', '/login/qr/start', payload)
    },
    async getQrLoginStatus(sessionId) {
      return await requestJson(
        baseUrl,
        'GET',
        `/login/qr/status?session_id=${encodeURIComponent(sessionId)}`,
      )
    },
    async cancelQrLogin(sessionId) {
      return await requestJson(baseUrl, 'POST', '/login/qr/cancel', {
        session_id: sessionId,
      })
    },
    async completeQrLogin(payload) {
      return await requestJson(baseUrl, 'POST', '/login/qr/complete', payload)
    },
    async runPollOnce() {
      return await requestJson(baseUrl, 'POST', '/poll/run-once', {})
    },
    async getPollingStatus() {
      return await requestJson(baseUrl, 'GET', '/poll/status')
    },
    async startPolling() {
      return await requestJson(baseUrl, 'POST', '/poll/start', {})
    },
    async stopPolling() {
      return await requestJson(baseUrl, 'POST', '/poll/stop', {})
    },
    async pollAccountOnce(accountId) {
      return await requestJson(
        baseUrl,
        'POST',
        `/accounts/${encodeURIComponent(accountId)}/poll-once`,
        {},
      )
    },
    async sendTyping(payload) {
      return await requestJson(baseUrl, 'POST', '/typing', payload)
    },
    async registerAccount(payload) {
      return await requestJson(baseUrl, 'POST', '/accounts/register', payload)
    },
    async removeAccount(accountId) {
      return await requestJson(baseUrl, 'DELETE', `/accounts/${encodeURIComponent(accountId)}`)
    },
  }
}

export { joinUrl }
