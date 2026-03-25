# Changelog

All notable changes to `weixin-gateway` should be documented in this file.

## 0.2.0 - 2026-03-24

Inbox delivery release.

### Added

- configurable delivery mode: `callback`, `inbox`
- inbox message persistence with dedupe by `account_id + event_id`
- inbox APIs for list/show/claim/complete/fail
- inbox CLI commands for local workers and Codex-style polling consumers
- basic inbox store tests and CLI coverage
- expired account state when a bot session hits `session timeout`

### Notes

- default behavior remains `callback`, so existing upstream webhook integrations continue to work unchanged
- `inbox` mode is intended for local workers, Codex automations, and other agents that prefer pull-based consumption
- expired accounts are now retained for inspection instead of being auto-deleted, but automatic polling skips them

## 0.1.0 - 2026-03-24

Initial open-source preparation release candidate.

### Added

- QR login APIs and CLI helpers
- account persistence and cleanup
- automatic polling on startup/login by default
- polling status APIs and CLI commands
- text inbound/outbound message support
- image inbound/outbound support
- video inbound/outbound support
- voice inbound/outbound first-pass support
- generic file inbound/outbound support
- account inspection and removal APIs/CLI

### Notes

- Core gateway behavior is being kept upstream-neutral.
- Xuanji compatibility remains supported through the current upstream event/send schema.
- Voice sending currently supports a practical subset of formats: `mp3`, `silk`, `amr`, `ogg`.
