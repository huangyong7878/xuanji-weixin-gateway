import path from 'node:path'

const EXTENSION_TO_MIME = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.amr': 'audio/amr',
  '.silk': 'audio/silk',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

const MIME_TO_EXTENSION = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'video/mp4': '.mp4',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/amr': '.amr',
  'audio/silk': '.silk',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
}

export function getMimeFromFilename(filename) {
  return EXTENSION_TO_MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream'
}

export function getExtensionFromContentTypeOrUrl(contentType, url) {
  if (contentType) {
    const normalized = String(contentType).split(';')[0].trim().toLowerCase()
    const fromMime = MIME_TO_EXTENSION[normalized]
    if (fromMime) {
      return fromMime
    }
  }
  const ext = path.extname(new URL(url).pathname).toLowerCase()
  return EXTENSION_TO_MIME[ext] ? ext : '.bin'
}
