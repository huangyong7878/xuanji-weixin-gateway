function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

export async function forwardMessageUpstream(config, event) {
  const headers = {
    'Content-Type': 'application/json',
  }
  if (config.upstreamSharedSecret) {
    headers.Authorization = `Bearer ${config.upstreamSharedSecret}`
  }

  const response = await fetch(
    joinUrl(config.upstreamBaseUrl, config.upstreamEventsPath),
    {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `upstream callback failed: HTTP ${response.status}`)
  }
}
