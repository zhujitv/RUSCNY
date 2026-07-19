# App Link / Universal Link 与浏览器参会

本目录包含域名关联示例和 `/join` 浏览器客户端源文件。H5 客户端会调用 Guest 认证、Socket.IO、音频上传和导出 API，必须与 Fastify API 同源部署。本目录不包含真实证书指纹或 Apple Team ID，发布前必须替换。

## 域名关联文件

在公网站点根目录建立 `.well-known`，把示例复制并改名：

```text
assetlinks.json.example
  → site/.well-known/assetlinks.json
apple-app-site-association.example
  → site/.well-known/apple-app-site-association
```

最终地址：

- `https://www.ruscny.net/.well-known/assetlinks.json`
- `https://www.ruscny.net/.well-known/apple-app-site-association`
- `https://www.ruscny.net/join/<roomToken>`

两个 association 地址必须用 HTTPS 直接返回 `200`，不可重定向，并返回 `application/json`。Android 指纹来自 Play App Signing/实际发布证书；iOS `appID` 是 `Team ID + Bundle ID`。不得把 `REPLACE_*` 占位值部署到生产。

## H5 参会能力

Fastify 直接在 `/join`、`/join/` 和 `/join/<roomToken>` 返回 `site/join` 文件。页面会：

- 从路径读取 16–256 位 base64url 邀请凭证，立即用 `history.replaceState` 从地址栏移除；API 请求日志同时脱敏为 `/join/[redacted]`。
- 仅在第一方 `sessionStorage` 保留邀请、Guest principal 和本次浏览器会话，不加载第三方脚本或分析 SDK。
- 允许临时用户确认姓名、公司和中文/俄语后直接加入，显示完整参会者、在线状态、发言人快照、原文、译文和纠错状态。
- 使用 Socket.IO 自动重连，以 `sequence` 通过 REST 分页补拉缺失消息，以 `messageId + reviewRevision` 拒绝迟到的旧状态。
- 在 Access Token 失效后，使用 Guest principal 调用 `/v1/auth/guest/refresh` 单飞续期；该路径不依赖可能已轮换的公共邀请。
- 通过 `MediaRecorder` 录制 MP4/WebM/Opus/Ogg，以幂等键上传。TTS 和 TXT 导出由 JavaScript 携带 Bearer 获取，不把 Access Token 放入 URL。
- 会议结束立即进入只读；被移出或离会后清除当前 Access Token 并停止实时通信。
- 只在用户明确点击“在 App 中打开”后，才通过 `tooyei-translator://join/<token>` 把邀请交给本机系统。

浏览器录音需要 HTTPS（`localhost` 开发例外）。录音编码由浏览器决定；上线前需在 iOS Safari 和 Android Chrome 分别验证麦克风授权、WebM/MP4 上传、锁屏/切后台和真实供应商 ASR。

## 托管与路由（必须同源）

Fastify API 直接托管 H5，是默认与推荐的生产路径。`PUBLIC_APP_URL` 必须指向这个对外 HTTPS origin；同一 origin 必须同时把以下路径转发给 API：

- `/`、`/privacy`、`/terms` 和官网静态资源；
- `/admin` 和 `/reset-password`；
- `/join` 和 `/join/*`；
- `/v1/*`；
- `/socket.io/*`，包括 WebSocket Upgrade。

`site/vercel.json` 现在只为 `.well-known` 关联文件提供响应头，故意不再把 `/join/:token` rewrite 到独立静态页，避免部署出无法调用 `/v1` 和 `/socket.io` 的假可用页面。如果基础设施仍使用 Vercel/CDN 作入口，必须在该生产项目完成上述三组同源反代并实测 WebSocket；不能直接把 `deploy/deep-links/site` 当成完整会议站点发布。

邀请 URL 不得进入 CDN 长期访问日志、分析 SDK、错误上报或 Referer。边缘平台无法关闭 path 日志时，必须路径脱敏、最短保留和严格限制访问。

## 验证

```bash
curl -i https://www.ruscny.net/.well-known/assetlinks.json
curl -i https://www.ruscny.net/.well-known/apple-app-site-association
curl -i https://www.ruscny.net/join/test_token_1234567890
curl -i https://www.ruscny.net/join/app.js
curl -i https://www.ruscny.net/socket.io/socket.io.js
```

上线验收要同时覆盖：中/俄浏览器语言跟随与手动切换；链接和房间码加入；临时身份必填；实时参会者与发言者快照；录音、幂等重试、TTS 和导出；断线补拉；Token 续期；会议结束、过期、离会与被移出后的立即权限变化。关联文件和 H5 不能替代服务端权限验证。
