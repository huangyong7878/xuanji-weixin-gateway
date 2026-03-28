import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { downloadInboundAttachments } from './inbound-media.js'

test('downloadInboundAttachments saves decrypted inbound image', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weixin-inbound-'))
  const aesHex = '00112233445566778899aabbccddeeff'
  const aesBase64 = Buffer.from(aesHex, 'hex').toString('base64')
  const originalFetch = global.fetch
  global.fetch = async () => {
    const { createCipheriv } = await import('node:crypto')
    const cipher = createCipheriv('aes-128-ecb', Buffer.from(aesHex, 'hex'), null)
    const ciphertext = Buffer.concat([cipher.update(Buffer.from([1, 2, 3, 4])), cipher.final()])
    return {
      ok: true,
      async text() { return '' },
      async arrayBuffer() { return ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) },
    }
  }

  const attachments = await downloadInboundAttachments({
    item_list: [
      {
        type: 2,
        image_item: {
          media: {
            encrypt_query_param: 'q',
            aes_key: aesBase64,
          },
        },
      },
    ],
  }, {
    inboundDir: tempDir,
    account: {},
  })
  global.fetch = originalFetch

  assert.equal(attachments.length, 1)
  assert.equal(attachments[0].kind, 'image')
  const saved = await fs.readFile(attachments[0].path)
  assert.deepEqual([...saved], [1, 2, 3, 4])
})

test('downloadInboundAttachments saves decrypted inbound file with original extension', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weixin-inbound-file-'))
  const aesHex = '00112233445566778899aabbccddeeff'
  const aesBase64 = Buffer.from(aesHex, 'hex').toString('base64')
  const originalFetch = global.fetch
  global.fetch = async () => {
    const { createCipheriv } = await import('node:crypto')
    const cipher = createCipheriv('aes-128-ecb', Buffer.from(aesHex, 'hex'), null)
    const plaintext = Buffer.from('# hello markdown\n')
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return {
      ok: true,
      async text() { return '' },
      async arrayBuffer() { return ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) },
    }
  }

  const attachments = await downloadInboundAttachments({
    item_list: [
      {
        type: 4,
        file_item: {
          file_name: 'notes.md',
          media: {
            encrypt_query_param: 'q-file',
            aes_key: aesBase64,
          },
        },
      },
    ],
  }, {
    inboundDir: tempDir,
    account: {},
  })
  global.fetch = originalFetch

  assert.equal(attachments.length, 1)
  assert.equal(attachments[0].kind, 'file')
  assert.equal(attachments[0].media_type, 'text/markdown')
  assert.equal(attachments[0].file_name, 'notes.md')
  assert.equal(attachments[0].path.endsWith('.md'), true)
  const saved = await fs.readFile(attachments[0].path, 'utf8')
  assert.equal(saved, '# hello markdown\n')
})

test('downloadInboundAttachments saves decrypted inbound video', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weixin-inbound-video-'))
  const aesHex = '00112233445566778899aabbccddeeff'
  const aesBase64 = Buffer.from(aesHex, 'hex').toString('base64')
  const originalFetch = global.fetch
  global.fetch = async () => {
    const { createCipheriv } = await import('node:crypto')
    const cipher = createCipheriv('aes-128-ecb', Buffer.from(aesHex, 'hex'), null)
    const plaintext = Buffer.from([5, 4, 3, 2, 1])
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return {
      ok: true,
      async text() { return '' },
      async arrayBuffer() { return ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) },
    }
  }

  const attachments = await downloadInboundAttachments({
    item_list: [
      {
        type: 5,
        video_item: {
          media: {
            encrypt_query_param: 'q-video',
            aes_key: aesBase64,
          },
        },
      },
    ],
  }, {
    inboundDir: tempDir,
    account: {},
  })
  global.fetch = originalFetch

  assert.equal(attachments.length, 1)
  assert.equal(attachments[0].kind, 'video')
  assert.equal(attachments[0].media_type, 'video/mp4')
  assert.equal(attachments[0].path.endsWith('.mp4'), true)
  const saved = await fs.readFile(attachments[0].path)
  assert.deepEqual([...saved], [5, 4, 3, 2, 1])
})

test('downloadInboundAttachments always keeps decrypted inbound voice as raw silk', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weixin-inbound-voice-'))
  const aesHex = '00112233445566778899aabbccddeeff'
  const aesBase64 = Buffer.from(aesHex, 'hex').toString('base64')
  const originalFetch = global.fetch
  global.fetch = async () => {
    const { createCipheriv } = await import('node:crypto')
    const cipher = createCipheriv('aes-128-ecb', Buffer.from(aesHex, 'hex'), null)
    const plaintext = Buffer.from([7, 7, 7, 7])
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return {
      ok: true,
      async text() { return '' },
      async arrayBuffer() { return ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) },
    }
  }

  const attachments = await downloadInboundAttachments({
    item_list: [
      {
        type: 3,
        voice_item: {
          media: {
            encrypt_query_param: 'q-voice',
            aes_key: aesBase64,
          },
          text: '语音转写内容',
        },
      },
    ],
  }, {
    inboundDir: tempDir,
    account: {},
  })
  global.fetch = originalFetch

  assert.equal(attachments.length, 1)
  assert.equal(attachments[0].kind, 'voice')
  assert.equal(attachments[0].media_type, 'audio/silk')
  assert.equal(attachments[0].path.endsWith('.silk'), true)
  const saved = await fs.readFile(attachments[0].path)
  assert.equal(saved.length > 0, true)
})
