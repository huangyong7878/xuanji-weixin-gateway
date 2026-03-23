# Changelog

All notable changes to `weixin-gateway` should be documented in this file.

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
