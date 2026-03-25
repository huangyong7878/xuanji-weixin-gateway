import { getUpdates, sendTextMessage } from '../api/weixin-api.js'
import { forwardMessageUpstream } from '../bridge/upstream-client.js'
import { sendMediaFromPayload } from '../media/send-media.js'
import { downloadInboundAttachments } from '../media/inbound-media.js'

function extractText(itemList) {
  const texts = []
  for (const item of itemList || []) {
    if (item?.type === 1 && item?.text_item?.text) {
      texts.push(String(item.text_item.text))
      continue
    }
    if (item?.type === 3 && item?.voice_item?.text) {
      texts.push(String(item.voice_item.text))
    }
  }
  return texts.join('\n').trim()
}

function buildEventText(message, attachments) {
  const text = extractText(message.item_list)
  if (text) {
    if (attachments.length === 0) {
      return text
    }
    const attachmentHints = attachments
      .map((attachment) => `- ${attachment.kind}: ${attachment.path}`)
      .join('\n')
    return `${text}\n\n用户还发送了以下附件：\n${attachmentHints}\n请结合这些附件理解用户意图；如需查看图片内容，请使用 vision 工具分析对应路径。`
  }

  if (attachments.length === 0) {
    return null
  }
  const attachmentHints = attachments
    .map((attachment) => `- ${attachment.kind}: ${attachment.path}`)
    .join('\n')
  return `用户发送了以下附件：\n${attachmentHints}\n请先理解这些附件内容，再回复用户；如需查看图片内容，请使用 vision 工具分析对应路径。`
}

function buildUpstreamEvent(account, message, attachments) {
  const text = buildEventText(message, attachments)
  if (!text) {
    return null
  }
  const peerId = String(message.from_user_id || '')
  if (!peerId) {
    return null
  }

  return {
    type: 'message',
    account_id: account.account_id,
    event_id: String(message.message_id || message.seq || ''),
    chat_id: peerId,
    user_id: peerId,
    text,
    context_token: String(message.context_token || ''),
    chat_type: 'c2c',
    attachments,
    raw: message,
  }
}

function shouldEnqueueInbox(config) {
  return config.deliveryMode === 'inbox'
}

function shouldForwardCallback(config) {
  return config.deliveryMode === 'callback'
}

export async function pollAccountOnce(config, store, accountId) {
  const account = await store.getAccount(accountId)
  if (!account) {
    throw new Error(`unknown account: ${accountId}`)
  }
  if (String(account.session_state || 'active') === 'expired') {
    return {
      account_id: accountId,
      forwarded: 0,
      cursor: account.cursor || '',
      skipped: true,
      session_state: 'expired',
    }
  }

  let updates
  try {
    updates = await getUpdates(account, account.cursor || '')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'session timeout') {
      await store.updateAccount(accountId, {
        session_state: 'expired',
      })
    }
    throw error
  }
  const messages = Array.isArray(updates.msgs) ? updates.msgs : []
  let forwarded = 0

  for (const message of messages) {
    if (Number(message.message_type || 1) !== 1) {
      continue
    }
    const attachments = await downloadInboundAttachments(message, {
      inboundDir: config.inboundDir,
      account,
    })
    const event = buildUpstreamEvent(account, message, attachments)
    if (!event) {
      continue
    }
    let inboxRecord = null
    if (shouldEnqueueInbox(config)) {
      inboxRecord = await store.enqueueInboxMessage(event)
    }
    if (shouldForwardCallback(config)) {
      if (inboxRecord) {
        await store.updateInboxMessage(inboxRecord.id, {
          callback_attempted: true,
        })
      }
      await forwardMessageUpstream(config, event)
      if (inboxRecord) {
        await store.updateInboxMessage(inboxRecord.id, {
          callback_succeeded: true,
        })
      }
    }
    forwarded += 1
  }

  if (typeof updates.get_updates_buf === 'string') {
    await store.updateCursor(accountId, updates.get_updates_buf)
  }

  return {
    account_id: accountId,
    forwarded,
    cursor: updates.get_updates_buf || account.cursor || '',
    session_state: 'active',
  }
}

export async function pollAllAccountsOnce(config, store) {
  const accounts = await store.listAccounts()
  const results = []
  for (const account of accounts) {
    try {
      results.push(await pollAccountOnce(config, store, account.account_id))
    } catch (error) {
      results.push({
        account_id: account.account_id,
        forwarded: 0,
        cursor: account.cursor || '',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}

export async function sendOutboundMessage(store, payload) {
  console.info(
    '[weixin-gateway] sendOutboundMessage payload',
    JSON.stringify({
      account_id: payload.account_id || '',
      to_user_id: payload.to_user_id || '',
      has_context_token: Boolean(payload.context_token),
      chat_type: payload.chat_type || '',
      item_types: Array.isArray(payload.items) ? payload.items.map((item) => item?.type ?? '?') : [],
    }),
  )
  const account = await store.getAccount(payload.account_id)
  if (!account) {
    throw new Error(`unknown account: ${payload.account_id}`)
  }

  const textItem = (payload.items || []).find((item) => item?.type === 'text')
  if (textItem && textItem.text) {
    const result = await sendTextMessage(account, {
      to_user_id: payload.to_user_id,
      context_token: payload.context_token || '',
      text: String(textItem.text),
    })
    console.info(
      '[weixin-gateway] sendOutboundMessage success',
      JSON.stringify({
        account_id: payload.account_id || '',
        to_user_id: payload.to_user_id || '',
        has_context_token: Boolean(payload.context_token),
      }),
    )
    return result
  }
  const fileItem = (payload.items || []).find((item) => item?.type === 'file')
  if (!fileItem) {
    throw new Error('unsupported outbound payload: expected text or file item')
  }
  const result = await sendMediaFromPayload(account, payload)
  console.info(
    '[weixin-gateway] sendOutboundMessage success',
    JSON.stringify({
      account_id: payload.account_id || '',
      to_user_id: payload.to_user_id || '',
      has_context_token: Boolean(payload.context_token),
    }),
  )
  return result
}
