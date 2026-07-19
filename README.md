# 中俄实时语音翻译 App

面向 Android 与 iOS 的中俄双向“按住说话”翻译产品。一个会议支持一名主持人和多名注册或临时参会者；可通过 App 内好友邀请、二维码、邀请链接或房间码加入。主持人可管理参会者，被移出者立即失去连接、发言和重连权限。原文、译文、发言者快照及目标语言语音通过实时房间同步，并按企业和单次会议严格隔离保存。

正式注册账号只有一种类型，注册页面不显示账号类型。任一注册用户创建会议时，服务端以该用户写入 `Conversation.ownerId`，并赋予其该会议的主持人 Participant 角色；用户加入别人创建的会议时不会获得对方会议的主持权限。

App 界面提供中文和俄文。首次安装默认跟随手机系统语言：俄文系统显示俄文，中文及其他系统语言显示中文；用户也可在“设置 → 应用语言”中固定选择中文或 `Русский`，选择会保存在本机并立即应用。

## 仓库结构

- `apps/mobile`：Flutter 客户端，共用 Android / iOS 代码。
- `apps/customer-web`：`www.ruscny.net` 的中俄双语客户官网、正式账号注册/登录页、法律页面和分享卡片。
- `services/api`：TypeScript API、WebSocket、认证、数据权限、翻译/TTS 与私有音频资产层。
- `apps/admin-web`：与 API 同源交付的中俄双语服务器管理后台和一次性密码重置页。
- `deploy/deep-links/site/join`：与 API 同源交付的中俄双语浏览器临时参会页。
- `docs`：API、实时事件、安全、部署、移动端构建、隐私与测试说明。
- `docker-compose.yml`：本地 PostgreSQL、Redis 与 API。

## 本地启动

1. 复制 `.env.example` 为 `.env`，填写三个认证密钥；本地可保留 `TRANSLATION_PROVIDER=mock` 和 `AUDIO_STORAGE_DRIVER=local`。
2. 启动 PostgreSQL 与 Redis：`docker compose up -d postgres redis`。
3. 使用 Node `22.23.1` / npm `10.9.x`，按根锁文件安装并初始化后端：`npm ci && npm run db:generate && npm run db:migrate`。
4. 启动 API：`npm run dev`。
5. 在 `apps/mobile` 使用 CI 固定的 Flutter `3.44.6` 执行 `flutter pub get --enforce-lockfile`，然后用 `--dart-define=API_BASE_URL=http://<局域网地址>:3000` 启动 App；`SOCKET_URL` 省略时会取同一 API origin，分离实时域名时才单独传入。

也可执行 `docker compose up --build api`：Compose 从仓库根 lockfile 构建，先等待 PostgreSQL、运行一次 `prisma migrate deploy`，成功后再启动 API。根 `.env` 必须先存在；该 Compose 会显式以 `NODE_ENV=development` 启动 API，并暴露固定开发端口/弱密码，不是生产模板。

本轮认证迁移把正式账号和 Guest Token 绑定到服务端 `sessionId` 会话代际；Guest 的短期 Access 到期后，使用安全存储中的 principal capability、会议范围和原设备 ID 执行受控续期，不再依赖长期 Guest Access。升级后，旧版本签发且不含该声明的 Token 会被拒绝并要求重新登录。客户端对一批 401 只执行一次认证恢复，不应无限重试。

Mock 翻译适配器只用于开发和自动化测试；生产配置为 mock 会直接拒绝启动。正式环境还必须配置 Redis、HTTPS `PUBLIC_API_URL`、独立音频签名密钥和私有 S3 兼容对象存储。TTS 上游临时 URL 只由后端下载，数据库保存内部 asset ref，App 收到默认 15 分钟有效的内部签名 URL；播放仍必须携带当前 Access Token，服务端每次重新校验会议权限。

正式公开 origin 已确定为 `https://www.ruscny.net`：客户官网使用 `/`，注册/登录使用 `/account`，App API 使用 `/v1`，Socket.IO 使用 `/socket.io`，浏览器参会使用 `/join`，管理后台使用 `/admin`，Android/iOS 域名关联文件使用 `/.well-known`。生产反向代理必须把这些路径同源转发到对应服务。

删除会议时，服务端在同一 PostgreSQL 事务内写入 `AudioDeletionJob` 并删除会议；事务提交后由多实例安全的 worker 删除本地/S3 TTS 对象，失败会指数退避重试。最终消息未能提交的 TTS 先直接清理，直接删除失败也会写入同一队列；生产 bucket 仍需配置合法保留期内的生命周期兜底。账号注销采用软删除/匿名化，不会破坏其他参会者有权保留的共享会议记录。

## 当前版本边界

当前版本采用松开后整段上传，不做连续同传、自动语言识别、重叠发言自动分离或长期保存原始录音。每台设备绑定一个稳定 Participant，以保存明确的发言归属；结构化会议纪要按 `conversationId` 保存和隔离，生产级生成式摘要仍需真实模型、质量评测和人工复核流程。

## 验证

后端：`npm run build && npm run typecheck && npm test`。仓库 CI 另配置 PostgreSQL/Redis、`prisma migrate deploy`、API/Socket 集成套件和生产 Docker target 构建；没有 GitHub Actions 运行记录前，只能称为“已配置”，不能称为 CI 已通过。

Flutter：`cd apps/mobile && flutter analyze && flutter test`

2026-07-19 当前工作区证据：Prisma Client generate、schema validate、schema SQL diff、后端 build/typecheck 均通过，30 个后端测试文件共 196/196 通过；生产依赖审计为 0 个已知漏洞，客户官网账号注册/登录与 H5 Web 回归 11/11 通过。Flutter 3.44.6 / Dart 3.12.2 下 `dart analyze lib test` 为 0 问题、Flutter 测试 51/51 通过；使用正式域名参数的 Android debug APK 已重新构建。`flutter analyze` 包装命令在当前中文工作区路径触发 analysis-server LSP 截断异常，但直接 Dart analyzer 已通过；iOS 尚未构建。当前机器没有可用的 PostgreSQL/Redis 连接，因此当前 16 个正式迁移中的 `202607190001`~`009` 尚未在真实数据库执行，PostgreSQL/Socket.IO 集成套件与 Redis 跨实例也未重跑。完整证据与未验证边界见 `docs/TEST_REPORT.md`。

真机、App Link、Universal Link、TestFlight 与阿里云生产翻译仍需使用真实域名、开发者账号和供应商凭据完成最终验收。未安装 App 的安全下载引导页与 association 模板位于 `deploy/deep-links`；详见 `docs`。
