import path from 'node:path'

export function loadConfig() {
  const rootDir = process.cwd()
  const port = Number(process.env.PORT || 8787)
  const dataDir = process.env.WEIXIN_GATEWAY_DATA_DIR || path.join(rootDir, '.data')
  const inboundDir = process.env.WEIXIN_GATEWAY_INBOUND_DIR || path.join(dataDir, 'inbound')
  const upstreamBaseUrl = process.env.UPSTREAM_BASE_URL || process.env.XUANJI_BASE_URL || 'http://127.0.0.1:8000'
  const upstreamEventsPath =
    process.env.UPSTREAM_EVENTS_PATH || process.env.XUANJI_WEIXIN_CALLBACK_PATH || '/callback/weixin-gateway'
  const upstreamSharedSecret = process.env.UPSTREAM_SHARED_SECRET || process.env.XUANJI_SHARED_SECRET || ''
  const pollIntervalMs = Number(process.env.WEIXIN_GATEWAY_POLL_INTERVAL_MS || 5000)
  const autoStartPolling = String(process.env.WEIXIN_GATEWAY_AUTO_START || 'true').toLowerCase() === 'true'
  const loginSessionTtlMs = Number(process.env.WEIXIN_GATEWAY_LOGIN_SESSION_TTL_MS || 10 * 60 * 1000)
  const deliveryMode = String(process.env.WEIXIN_GATEWAY_DELIVERY_MODE || 'callback').trim().toLowerCase()

  return {
    rootDir,
    port,
    dataDir,
    inboundDir,
    upstreamBaseUrl: upstreamBaseUrl.replace(/\/$/, ''),
    upstreamEventsPath,
    upstreamSharedSecret,
    // 向后兼容旧命名，避免现有 Xuanji 集成配置立即失效。
    xuanjiBaseUrl: upstreamBaseUrl.replace(/\/$/, ''),
    xuanjiCallbackPath: upstreamEventsPath,
    xuanjiSharedSecret: upstreamSharedSecret,
    pollIntervalMs,
    autoStartPolling,
    loginSessionTtlMs,
    deliveryMode: ['callback', 'inbox'].includes(deliveryMode) ? deliveryMode : 'callback',
  }
}
