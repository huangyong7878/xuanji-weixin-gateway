"""最小 FastAPI 示例：扫码登录 + 接收微信文本 + 文本回声回复。"""

from __future__ import annotations

import base64
import os
from io import BytesIO
from typing import Any

import httpx
import qrcode
import qrcode.image.svg
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

GATEWAY_BASE_URL = os.getenv("GATEWAY_BASE_URL", "http://127.0.0.1:8787").rstrip("/")
GATEWAY_CALLBACK_PATH = os.getenv("GATEWAY_CALLBACK_PATH", "/callback/weixin-gateway")
ILINK_API_BASE_URL = os.getenv("ILINK_API_BASE_URL", "https://ilinkai.weixin.qq.com")

app = FastAPI(title="weixin-gateway fastapi demo")


def build_qrcode_data_url(content: str) -> str:
    """把二维码内容转换成可直接渲染的 SVG data URL。"""
    image = qrcode.make(content, image_factory=qrcode.image.svg.SvgImage)
    buffer = BytesIO()
    image.save(buffer)
    svg = buffer.getvalue()
    return f"data:image/svg+xml;base64,{base64.b64encode(svg).decode('ascii')}"


async def gateway_request(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """调用 gateway HTTP API。"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.request(
            method,
            f"{GATEWAY_BASE_URL}{path}",
            json=body,
        )
    try:
        data: dict[str, Any] = response.json()
    except Exception:
        data = {"raw": response.text}
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=data)
    return data


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
    """返回最小登录页面。"""
    return f"""
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>weixin-gateway fastapi demo</title>
    <style>
      body {{ font-family: sans-serif; max-width: 720px; margin: 40px auto; line-height: 1.6; }}
      button {{ padding: 8px 14px; cursor: pointer; }}
      code {{ background: #f5f5f5; padding: 2px 4px; border-radius: 4px; }}
      img {{ max-width: 280px; display: block; margin-top: 12px; }}
      .muted {{ color: #666; }}
    </style>
  </head>
  <body>
    <h1>weixin-gateway FastAPI Demo</h1>
    <p class="muted">这个 demo 演示三件事：发起扫码登录、接收微信文本、把文本回声回复给微信。</p>
    <p><strong>Gateway:</strong> <code>{GATEWAY_BASE_URL}</code></p>
    <p><strong>Gateway callback path:</strong> <code>{GATEWAY_CALLBACK_PATH}</code></p>
    <button id="start">开始扫码登录</button>
    <div id="output"></div>
    <script>
      const output = document.getElementById('output');
      const startButton = document.getElementById('start');

      function renderSession(session) {{
        const qrcodeImage = session.qrcode_data_url
          ? `<img src="${{session.qrcode_data_url}}" alt="qr" />`
          : '';
        const qrcodeUrl = session.qrcode_url
          ? `
              <p><strong>二维码页面：</strong> <a href="${{session.qrcode_url}}" target="_blank">${{session.qrcode_url}}</a></p>
              <p><a href="${{session.qrcode_url}}" target="_blank"><button type="button">打开二维码页面</button></a></p>
            `
          : '';
        output.innerHTML = `
          <p><strong>session_id:</strong> <code>${{session.session_id || ''}}</code></p>
          <p><strong>state:</strong> <code>${{session.state || ''}}</code></p>
          <p><strong>message:</strong> ${{session.message || ''}}</p>
          <p><strong>qrcode:</strong> <code>${{session.qrcode || ''}}</code></p>
          ${{qrcodeImage}}
          ${{qrcodeUrl}}
        `;
      }}

      async function pollStatus(sessionId) {{
        while (true) {{
          const response = await fetch(`/demo/login/status?session_id=${{encodeURIComponent(sessionId)}}`);
          const data = await response.json();
          renderSession(data.session || {{}});
          const state = data?.session?.state || '';
          if (state === 'completed' || state === 'expired' || state === 'cancelled') {{
            break;
          }}
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }}
      }}

      startButton.addEventListener('click', async () => {{
        output.innerHTML = '<p>正在生成二维码...</p>';
        const response = await fetch('/demo/login/start', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{ api_base_url: '{ILINK_API_BASE_URL}' }})
        }});
        const data = await response.json();
        renderSession(data.session || {{}});
        if (data?.session?.session_id) {{
          pollStatus(data.session.session_id);
        }}
      }});
    </script>
  </body>
</html>
"""


@app.post("/demo/login/start")
async def demo_login_start() -> JSONResponse:
    """发起二维码登录。"""
    data = await gateway_request(
        "POST",
        "/login/qr/start",
        {
            "api_base_url": ILINK_API_BASE_URL,
        },
    )
    session = data.get("session")
    if isinstance(session, dict):
        qrcode_value = str(session.get("qrcode_url") or session.get("qrcode") or "").strip()
        if qrcode_value:
            session["qrcode_data_url"] = build_qrcode_data_url(qrcode_value)
    return JSONResponse(data)


@app.get("/demo/login/status")
async def demo_login_status(session_id: str) -> JSONResponse:
    """查询登录状态。"""
    data = await gateway_request("GET", f"/login/qr/status?session_id={session_id}")
    session = data.get("session")
    if isinstance(session, dict):
        qrcode_value = str(session.get("qrcode_url") or session.get("qrcode") or "").strip()
        if qrcode_value:
            session["qrcode_data_url"] = build_qrcode_data_url(qrcode_value)
    return JSONResponse(data)


@app.post(GATEWAY_CALLBACK_PATH)
async def gateway_callback(request: Request) -> JSONResponse:
    """接收 gateway 推过来的微信事件，并回声回复文本。"""
    event = await request.json()
    text = str(event.get("text") or "").strip()
    account_id = str(event.get("account_id") or "").strip()
    to_user_id = str(event.get("user_id") or event.get("chat_id") or "").strip()
    context_token = str(event.get("context_token") or "").strip()
    chat_type = str(event.get("chat_type") or "c2c").strip()

    if account_id and to_user_id and text:
        await gateway_request(
            "POST",
            "/send",
            {
                "account_id": account_id,
                "to_user_id": to_user_id,
                "context_token": context_token,
                "chat_type": chat_type,
                "items": [
                    {
                        "type": "text",
                        "text": f"你刚刚说的是：{text}",
                    }
                ],
            },
        )
    return JSONResponse({"ok": True})
