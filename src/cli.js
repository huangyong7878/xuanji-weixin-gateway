#!/usr/bin/env node

import process from 'node:process'

import { createGatewayClient } from './client/gateway-client.js'

const DEFAULT_GATEWAY_BASE_URL = 'http://127.0.0.1:8787'
const DEFAULT_ILINK_API_BASE_URL = 'https://ilinkai.weixin.qq.com'

function printUsage(io = console) {
  io.log(`weixin-gateway CLI

用法:
  node src/cli.js health
  node src/cli.js accounts
  node src/cli.js accounts:show --account-id ACCOUNT_ID
  node src/cli.js accounts:remove --account-id ACCOUNT_ID
  node src/cli.js login:start [--api-base-url URL] [--account-id ID] [--bot-type 3]
  node src/cli.js login:status --session-id SESSION_ID
  node src/cli.js login:watch --session-id SESSION_ID [--interval-ms 1500] [--timeout-ms 180000]
  node src/cli.js login:cancel --session-id SESSION_ID
  node src/cli.js poll:status
  node src/cli.js poll:start
  node src/cli.js poll:stop
  node src/cli.js poll:once
  node src/cli.js poll:account --account-id ACCOUNT_ID

可选:
  --gateway-base-url URL   默认 http://127.0.0.1:8787
  --json                   直接输出完整 JSON
`)
}

function parseArgs(argv) {
  const args = [...argv]
  const command = args.shift() || ''
  const flags = {}
  while (args.length > 0) {
    const token = args.shift()
    if (!token?.startsWith('--')) {
      continue
    }
    const key = token.slice(2)
    const next = args[0]
    if (!next || next.startsWith('--')) {
      flags[key] = true
      continue
    }
    flags[key] = args.shift()
  }
  return { command, flags }
}

function requireFlag(flags, name) {
  const value = String(flags[name] || '').trim()
  if (!value) {
    throw new Error(`--${name} is required`)
  }
  return value
}

function getFlag(flags, name, fallback = '') {
  return String(flags[name] || fallback).trim()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatCliError(error, gatewayBaseUrl) {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'fetch failed') {
    return [
      `无法连接到 weixin-gateway: ${gatewayBaseUrl}`,
      '请先在另一个终端启动服务：',
      '  cd apps/weixin-gateway && node src/server.js',
    ].join('\n')
  }
  return message
}

function printResult(command, data, io = console, jsonMode = false) {
  if (jsonMode) {
    io.log(JSON.stringify(data, null, 2))
    return
  }

  switch (command) {
    case 'health':
      io.log(`ok=${Boolean(data.ok)} polling=${Boolean(data.polling?.running)} interval_ms=${data.polling?.interval_ms ?? ''}`)
      return
    case 'accounts':
      if (!Array.isArray(data.accounts) || data.accounts.length === 0) {
        io.log('没有已注册账号。')
        return
      }
      for (const account of data.accounts) {
        io.log(
          `${account.account_id}  ${account.api_base_url}  cursor=${account.cursor || ''}  running=${Boolean(account.status?.polling_running)}  last_error=${account.status?.last_error || ''}`,
        )
      }
      return
    case 'accounts:show':
      io.log(`account_id=${data.account?.account_id || ''}`)
      io.log(`api_base_url=${data.account?.api_base_url || ''}`)
      io.log(`wechat_uin=${data.account?.wechat_uin || ''}`)
      io.log(`cursor=${data.account?.cursor || ''}`)
      io.log(`polling=${Boolean(data.account?.status?.polling_running)}`)
      io.log(`last_forwarded=${data.account?.status?.last_forwarded ?? 0}`)
      io.log(`last_error=${data.account?.status?.last_error || ''}`)
      return
    case 'accounts:remove':
      io.log(`removed=${data.removed?.account_id || ''}`)
      io.log(`polling=${Boolean(data.polling?.running)}`)
      return
    case 'login:start':
      io.log(`session_id=${data.session?.session_id || ''}`)
      io.log(`state=${data.session?.state || ''}`)
      io.log(`qrcode=${data.session?.qrcode || ''}`)
      io.log(`qrcode_url=${data.session?.qrcode_url || ''}`)
      return
    case 'login:status':
    case 'login:cancel':
    case 'login:watch':
      io.log(`session_id=${data.session?.session_id || ''}`)
      io.log(`state=${data.session?.state || ''}`)
      io.log(`message=${data.session?.message || ''}`)
      if (data.session?.account_id) {
        io.log(`account_id=${data.session.account_id}`)
      }
      return
    case 'poll:start':
    case 'poll:stop':
    case 'poll:status':
      io.log(`polling=${Boolean(data.polling?.running)} interval_ms=${data.polling?.interval_ms ?? ''}`)
      if (data.polling?.last_started_at) {
        io.log(`last_started_at=${data.polling.last_started_at}`)
      }
      if (data.polling?.last_finished_at) {
        io.log(`last_finished_at=${data.polling.last_finished_at}`)
      }
      if (data.polling?.last_error) {
        io.log(`last_error=${data.polling.last_error}`)
      }
      return
    case 'poll:once':
      io.log(`accounts=${Array.isArray(data.results) ? data.results.length : 0}`)
      return
    case 'poll:account':
      io.log(JSON.stringify(data.result || {}, null, 2))
      return
    default:
      io.log(JSON.stringify(data, null, 2))
  }
}

export async function runCli(argv, io = console) {
  const { command, flags } = parseArgs(argv)
  if (!command || flags.help) {
    printUsage(io)
    return 0
  }

  const gatewayBaseUrl = getFlag(flags, 'gateway-base-url', DEFAULT_GATEWAY_BASE_URL)
  const client = createGatewayClient(gatewayBaseUrl)

  try {
    let result
    switch (command) {
      case 'health':
        result = await client.health()
        break
      case 'accounts':
        result = await client.listAccounts()
        break
      case 'accounts:show':
        result = await client.getAccount(requireFlag(flags, 'account-id'))
        break
      case 'accounts:remove':
        result = await client.removeAccount(requireFlag(flags, 'account-id'))
        break
      case 'login:start':
        result = await client.startQrLogin({
          account_id: getFlag(flags, 'account-id'),
          api_base_url: getFlag(flags, 'api-base-url', DEFAULT_ILINK_API_BASE_URL),
          bot_type: getFlag(flags, 'bot-type', '3'),
        })
        break
      case 'login:status':
        result = await client.getQrLoginStatus(requireFlag(flags, 'session-id'))
        break
      case 'login:watch': {
        const sessionId = requireFlag(flags, 'session-id')
        const intervalMs = Number(getFlag(flags, 'interval-ms', '1500')) || 1500
        const timeoutMs = Number(getFlag(flags, 'timeout-ms', '180000')) || 180000
        const deadline = Date.now() + timeoutMs
        while (true) {
          result = await client.getQrLoginStatus(sessionId)
          printResult(command, result, io, Boolean(flags.json))
          const state = String(result?.session?.state || '')
          if (state === 'completed' || state === 'expired' || state === 'cancelled') {
            break
          }
          if (Date.now() >= deadline) {
            throw new Error(`login watch timed out after ${timeoutMs}ms`)
          }
          await sleep(intervalMs)
        }
        break
      }
      case 'login:cancel':
        result = await client.cancelQrLogin(requireFlag(flags, 'session-id'))
        break
      case 'poll:start':
        result = await client.startPolling()
        break
      case 'poll:status':
        result = await client.getPollingStatus()
        break
      case 'poll:stop':
        result = await client.stopPolling()
        break
      case 'poll:once':
        result = await client.runPollOnce()
        break
      case 'poll:account':
        result = await client.pollAccountOnce(requireFlag(flags, 'account-id'))
        break
      default:
        io.error(`未知命令: ${command}`)
        printUsage(io)
        return 1
    }
    if (command !== 'login:watch') {
      printResult(command, result, io, Boolean(flags.json))
    }
    return 0
  } catch (error) {
    io.error(formatCliError(error, gatewayBaseUrl))
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await runCli(process.argv.slice(2))
  process.exit(code)
}
