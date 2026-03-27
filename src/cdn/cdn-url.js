function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || ''))
}

export function buildCdnUploadUrl({ cdnBaseUrl, uploadParam, uploadFullUrl, filekey }) {
  if (isAbsoluteUrl(uploadFullUrl)) {
    return String(uploadFullUrl)
  }
  return `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`
}

export function buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl) {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`
}
