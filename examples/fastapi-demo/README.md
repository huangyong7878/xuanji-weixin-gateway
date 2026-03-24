# FastAPI Demo

这个 demo 只做三件事：

1. 在网页里发起扫码登录
2. 接收 gateway 转发过来的微信文本事件
3. 把文本回声回复给微信

## 启动

先启动 gateway：

```bash
cd /Users/yonghuang/Codes/xuanji-weixin-gateway
npm start
```

再启动 demo：

```bash
cd /Users/yonghuang/Codes/xuanji-weixin-gateway/examples/fastapi-demo
uv run uvicorn app:app --reload --port 8000
```

## 配置 gateway 的上游地址

让 gateway 把事件回调到这个 demo：

```bash
export UPSTREAM_BASE_URL=http://127.0.0.1:8000
export UPSTREAM_EVENTS_PATH=/callback/weixin-gateway
```

如果 gateway 已经在运行，重启一次。

## 使用方法

打开：

- <http://127.0.0.1:8000>

点击“开始扫码登录”。

页面会展示：

- `session_id`
- `state`
- 二维码链接
- “打开二维码页面”按钮

如果页面没有直接显示图片二维码，直接点击“打开二维码页面”即可扫码。

扫码成功后：

- gateway 会自动开始轮询
- 你在微信里给 bot 发一条文本
- demo 会收到事件
- demo 会通过 gateway `/send` 把回声文本发回微信

## 说明

这个 demo 只处理文本消息，不做多轮状态管理，也不处理媒体。

它的目标是：

- 让你最快跑通第一条完整链路
- 让你看懂上游 callback 和 `/send` 应该怎么接
