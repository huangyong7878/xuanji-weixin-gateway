# Weixin Gateway

这是一个独立的微信网关，可对接任意上游 Agent 服务。

- [License](./LICENSE)
- [Contributing](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)
- [Release Checklist](./RELEASE_CHECKLIST.md)
- [Repo Split Guide](./REPO_SPLIT_GUIDE.md)
- [Publishing Notes](./PUBLISHING.md)

当前阶段目标：

- 不依赖 OpenClaw
- 先打通文本消息版 MVP，并补齐图片/视频/通用文件发送
- 后续逐步补齐二维码登录、typing 和更多产品化能力

## 当前接口

### `GET /health`

健康检查。

### `POST /accounts/register`

注册一个微信账号配置（当前阶段手工写入 token/uin）。

```json
{
  "account_id": "wx-account-1",
  "api_base_url": "https://your-weixin-bot.example.com",
  "bot_token": "token-from-login",
  "wechat_uin": "base64-uin"
}
```

### `GET /accounts`

查看已注册账号（隐藏 token）。

### `GET /accounts/:account_id`

查看单个账号详情和最近轮询状态，包括：

- `polling_running`
- `last_forwarded`
- `last_error`
- `last_cursor`

### `DELETE /accounts/:account_id`

删除一个账号。

说明：

- 如果删除后已没有任何账号，gateway 会自动停止后台轮询

### `POST /login/qr/start`

创建一个二维码登录会话。

当前阶段这里已经会真实调用：

- `ilink/bot/get_bot_qrcode`

返回真实的二维码内容和二维码图片 URL。

请求体示例：

```json
{
  "account_id": "wx-account-1",
  "api_base_url": "https://your-weixin-bot.example.com"
}
```

### `GET /login/qr/status?session_id=...`

查看登录会话状态：

- `pending`
- `scaned`
- `completed`
- `expired`
- `cancelled`

当前阶段这里会真实调用：

- `ilink/bot/get_qrcode_status`

如果扫码已确认，并且返回了：

- `bot_token`
- `ilink_bot_id`
- `baseurl`

系统会自动把账号写入本地 store，并把会话标记为 `completed`。

### `POST /login/qr/complete`

当前阶段用于**手工完成一次登录**，把真实拿到的 `bot_token` / `wechat_uin` 写入账号。

```json
{
  "session_id": "xxx",
  "api_base_url": "https://your-weixin-bot.example.com",
  "bot_token": "token",
  "wechat_uin": "base64-uin"
}
```

### `POST /login/qr/cancel`

取消一个登录会话。

### `POST /accounts/:account_id/poll-once`

对单个账号执行一次 `getupdates` 长轮询拉取。

### `POST /poll/run-once`

对所有账号执行一次轮询。

### `POST /poll/start`

启动后台轮询 loop。

### `GET /poll/status`

查看当前轮询状态，包括：

- 是否正在运行
- 轮询间隔
- 最近一次开始/结束时间
- 最近一次错误

### `POST /poll/stop`

停止后台轮询 loop。

### `POST /send`

上游 Agent -> Gateway 的出站消息接口。当前阶段支持：

- 文本
- 图片（`file_type=1`）
- 视频（`file_type=2`）
- 语音（`file_type=3`）
- 通用文件（`file_type=4`）

语音当前支持的上传格式：

- `.mp3`
- `.silk`
- `.amr`
- `.ogg`

对于其他语音格式，gateway 会明确报错，而不是假装发送成功。

请求体示例：

```json
{
  "account_id": "wx-account-1",
  "to_user_id": "wx-user-1",
  "context_token": "ctx-123",
  "chat_type": "c2c",
  "items": [
    {
      "type": "text",
      "text": "你好"
    }
  ]
}
```

发送图片/文件时，`items` 结构示例：

```json
{
  "account_id": "wx-account-1",
  "to_user_id": "wx-user-1",
  "context_token": "ctx-123",
  "chat_type": "c2c",
  "items": [
    {
      "type": "file",
      "file_type": 1,
      "url": "https://example.com/image.png",
      "srv_send_msg": true
    }
  ]
}
```

说明：

- gateway 会先下载这个公网 URL
- 然后上传到微信 CDN
- 再调用 `sendmessage` 发送图片/文件消息

Gateway 内部会把拉到的文本消息转换成如下事件并转发给上游：

```json
{
  "type": "message",
  "account_id": "wx-account-1",
  "event_id": "evt-1",
  "chat_id": "wx-user-1",
  "user_id": "wx-user-1",
  "text": "你好",
  "context_token": "ctx-1",
  "chat_type": "c2c",
  "raw": {}
}
```

当前入站媒体已支持落盘：

- 图片
- 视频
- 语音
- 通用文件

默认会保存到：

- `WEIXIN_GATEWAY_DATA_DIR/inbound`
- 默认即 `apps/weixin-gateway/.data/inbound`

## 开发建议

当前目录结构：

- `src/auth/login-qr.js`：二维码登录会话管理
- `src/config.js`：环境配置
- `src/store/file-store.js`：本地账号与游标存储
- `src/api/weixin-api.js`：`getupdates/sendmessage` HTTP 封装
- `src/media/send-media.js`：图片/通用文件发送流程
- `src/cdn/`：CDN 上传相关最小实现
- `src/bridge/upstream-client.js`：向上游 callback 转发事件
- `src/bridge/xuanji-client.js`：旧版 Xuanji 命名兼容导出
- `src/runtime/poller.js`：轮询与出站逻辑
- `src/server.js`：HTTP 服务入口

## 运行

```bash
cd apps/weixin-gateway
node src/server.js
```

调试 CLI：

```bash
cd apps/weixin-gateway
node src/cli.js health
node src/cli.js login:start
node src/cli.js login:status --session-id <session_id>
node src/cli.js login:watch --session-id <session_id>
node src/cli.js accounts:show --account-id <account_id>
node src/cli.js accounts:remove --account-id <account_id>
node src/cli.js poll:status
node src/cli.js poll:start
node src/cli.js accounts
```

拆分成独立仓库时，也可以直接使用导出脚本：

```bash
cd apps/weixin-gateway
bash scripts/export-standalone.sh ~/Codes/xuanji-weixin-gateway
```

也可以：

```bash
pnpm cli -- health
pnpm cli -- login:start
```

`login:start` 默认会使用：

- `https://ilinkai.weixin.qq.com`

如果你后面需要切换上游地址，再显式传 `--api-base-url`。

环境变量：

```bash
PORT=8787
WEIXIN_GATEWAY_DATA_DIR=.data
UPSTREAM_BASE_URL=http://127.0.0.1:8000
UPSTREAM_EVENTS_PATH=/callback/weixin-gateway
UPSTREAM_SHARED_SECRET=
WEIXIN_GATEWAY_POLL_INTERVAL_MS=5000
WEIXIN_GATEWAY_AUTO_START=true
WEIXIN_GATEWAY_LOGIN_SESSION_TTL_MS=600000
WEIXIN_GATEWAY_VERBOSE_UPDATES=false
```

默认行为：

- 服务启动后，如果本地已经有账号，默认会自动开始轮询
- 二维码登录成功后，也会自动开始轮询
- `poll:start / poll:stop` 仍然保留给调试和运维场景

兼容说明：

- 当前仍兼容旧的 `XUANJI_BASE_URL` / `XUANJI_WEIXIN_CALLBACK_PATH` / `XUANJI_SHARED_SECRET`
- 如果同时设置了新旧两套变量，优先使用 `UPSTREAM_*`

## 已验证的发送要点

当前文本回复链路已经验证通过，但有一个很重要的协议细节：

- `sendmessage` 不能只发送最简的 `to_user_id/context_token/item_list`

当前验证过可稳定工作的文本消息结构还需要包含：

- `from_user_id: ""`
- `client_id`
- `message_type: 2`
- `message_state: 2`

如果缺少这些字段，可能会出现：

- 上游 HTTP 返回成功
- gateway 也认为发送成功
- 但微信端实际收不到回复

另外，正常轮询日志默认已经降噪：

- `getUpdates` 的正常 request/response 默认不打印
- 如需排查轮询问题，可临时设置 `WEIXIN_GATEWAY_VERBOSE_UPDATES=true`
