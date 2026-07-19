# 测试报告与验收模板

## 1. 报告信息

| 字段 | 值 |
| --- | --- |
| 产品 | 中俄实时语音翻译 App |
| 版本 / build | `[填写]` |
| Git commit | `[填写完整 SHA]` |
| 测试环境 | `[local / staging / production candidate]` |
| API 版本 | `/v1` |
| Android 设备/系统 | `[填写]` |
| iPhone/iPad/系统 | `[填写]` |
| 阿里云地域/模型快照 | `[填写，不写 API Key]` |
| 测试时间 | `[开始时间]` 至 `[结束时间]` |
| 执行人 / 审核人 | `[填写]` |
| 最终结论 | `[PASS / PASS WITH RISKS / FAIL]` |

本文件既是当前交付的测试说明，也是发布候选的报告模板。每个“通过”必须附日志、截图、测试输出、视频或可重放步骤之一；“未执行”不能写成“通过”。

## 2. 当前仓库验证状态

当前开发环境已知：

- 2026-07-19 当前工作区已通过后端 `build`、`typecheck`、Prisma Client 生成、schema validate 与从空模型生成 schema SQL diff。当前共有 19 个正式迁移；GitHub CI 的现有证据只覆盖当时的前 16 个，新迁移必须在提交后的 CI PostgreSQL 任务中重新应用验证。
- 后端单元测试：34 个测试文件、228/228 通过，覆盖统一 `USER` 注册、旧 HOST/CUSTOMER Token 滚动兼容、旧客户端 role 输入不可提权，以及 AI 纪要的来源引用、提示注入边界、模型审计、幂等生成、陈旧任务接管、生成期间竞态、主持人批准和未批准禁止邮件分发。客户官网主脚本、账号脚本、Admin、Reset、H5 五个 JavaScript 文件均通过 `node --check`。客户官网账号注册/登录与 H5 安全回归合计 11/11 通过，并断言账号页不再显示或提交账号类型；官网、账号页/别名、法律页面、静态资源、`no-store`、CSP、robots 和 sitemap 也纳入 Fastify 路由单测。本轮未重跑 coverage，旧覆盖率数字不再作为当前代码证据。
- GitHub CI 已在 PostgreSQL 16 上通过当前加固版 API/Socket.IO 集成套件 13/13，包含 1 Host + 4 中文注册用户 + 1 俄语临时用户、权限隔离、并发、邀请、移出、断线补拉和结束后只读。CI 提供了 Redis 服务，但未启动两个 API 副本，不能外推为 Redis 跨实例已验证。
- `npm audit --omit=dev --json` 已成功执行：167 个生产依赖，0 个 low/moderate/high/critical 已知漏洞。
- 移动端上一版使用 Flutter `3.44.6` / Dart `3.12.2` 完成过本地 `dart analyze lib test` 0 issues和 GitHub CI `flutter analyze` 0 issues、`flutter test` 51/51。当前工作区新增了 AI 生成幂等键、批准按钮和分发前批准状态拦截，但本机没有 Flutter/Dart 命令，尚未对这批最新改动重跑 analyzer/test；必须由下一次 CI 关闭。
- Android debug APK 已使用 `API_BASE_URL`/`SOCKET_URL=https://www.ruscny.net` 和 `APP_LINK_HOST=www.ruscny.net` 在本地重新构建，merged manifest 的 HTTPS App Link host 已核验，当前 SHA-256 为 `4eecc8ad1f153d3cd3281900ab61e239fe3045781d69c3202fdb4f019104854d`。GitHub CI 另成功构建 Android API 36 debug APK 和无签名 iOS Simulator `Runner.app`。正式 API 尚未在该域名上线，因此这些内部产物仍不能作为生产登录验收包；AAB/IPA、发布签名、TestFlight 和真机安装仍未执行。
- 正式域名已确定为 `www.ruscny.net`，但 DNS、TLS 和生产服务尚未在本轮验证；阿里云生产凭据及 Apple/Google 开发者账号未提供，真实 ASR→MT→TTS、App Link/Universal Link 托管和 TestFlight 尚未执行。
- 本地单元/CI 使用 mock provider；mock 通过只证明编排与隔离，不证明中俄翻译质量。生产配置为 mock 会拒绝启动。

最终交付前在本节追加实际命令、退出码和日期，不能删除上述未完成事实，除非已有对应证据。

## 3. 自动化命令

### 后端

```bash
npm ci
npm run db:generate
npm run build
npm run typecheck
npm test
npm run test:coverage
# 需要独立 PostgreSQL 且先完成 prisma migrate deploy；跨实例验证另需 Redis
npm run test:integration
```

记录：

```text
Node version: v22.23.1
Prisma Client generated: PASS (v6.19.3 in current install)
Prisma schema validate: PASS
Build / typecheck: PASS / PASS
Unit tests: 228 passed / 0 failed / 0 skipped (34 files)
Coverage: NOT RE-RUN for the current code
PostgreSQL migrations: LOCAL schema/diff PASS for 19 migrations; GitHub CI evidence currently covers only 16/16
PostgreSQL/Socket.IO integration: PASS in GitHub CI, 13/13
Redis adapter multi-instance integration: NOT RUN
GitHub CI execution: PASS for commit 5d1263e18ca2046b5b539a62c2db515d7f47686f (https://github.com/zhujitv/RUSCNY/actions/runs/29676541364)
Run date: 2026-07-19
```

已在真实 PostgreSQL 上通过的 13 个集成场景：跨主体隔离、并发 Refresh、旧设备会话撤销、六人混合身份并发加入、好友申请与 App 内会议邀请、发言者快照/按人导出/结构化纪要/移出隔离、加入与结束竞态、消息幂等和结束后只读、过期邀请、邀请轮换、Guest 会话代际、陈旧 `PROCESSING` 恢复、Socket 非法握手/授权补拉和设备撤销。未启用 Redis，不能把证据外推为跨 API 实例已通过。

### Flutter

```bash
cd apps/mobile
flutter doctor -v
flutter pub get --enforce-lockfile
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

记录：

```text
Flutter/Dart version: 3.44.6 / 3.12.2
Dart analyze lib test: PASS, 0 issues locally; `flutter analyze`: PASS in GitHub CI
Flutter tests: 51 passed / 0 failed
Flutter line coverage: NOT RE-RUN after localization changes (previously 278/996)
pubspec.lock: generated; CI configured with --enforce-lockfile
Android debug compile verification: PASS with `https://www.ruscny.net`; manifest host verified
iOS Simulator debug build: PASS in GitHub CI; signed device Archive/IPA/TestFlight NOT RUN
Current temporary APK SHA-256: 4eecc8ad1f153d3cd3281900ab61e239fe3045781d69c3202fdb4f019104854d
```

## 4. 核心验收矩阵

| ID | 场景 | 期望 | 结果 | 证据/缺陷 |
| --- | --- | --- | --- | --- |
| AUTH-01 | 任意用户注册/登录，旧客户端尝试提交 HOST/CUSTOMER | 始终创建统一 `USER` 账号并返回短期 Access 与设备 Refresh 会话；界面无账号类型选择 | 自动化通过 | 后端注册兼容测试、官网和 Flutter 注册页测试 |
| AUTH-02 | Refresh Token 轮换 | 新 Token 生效，旧 Token 重用被拒绝/撤销 | 未执行 | |
| AUTH-03 | 退出/远程撤销设备 | 本机 Token 清除，服务端会话不可再用 | 未执行 | |
| AUTH-04 | 部署会话族迁移后使用旧无 `sessionId` Token | HTTP/Socket 均拒绝，App 清理旧 Token 并要求重新登录，不循环刷新 | 未执行 | |
| AUTH-05 | Guest Access 到期后长会话续期 | 不使用旧邀请，重新验证 principal/设备/会议/参会关系，轮换代际并重连 | 单元测试通过 | 后端活动/会后历史/隐私错误/CAS 与 Flutter 401 单飞恢复 |
| AUTH-06 | Guest 续期与显式 logout 并发 | 无论谁先取得锁，logout 后当前代际不再可用 | 单元测试通过 | Conversation 首锁顺序及当前 generation 到期的确定性竞争测试 |
| L10N-01 | 系统语言为俄文/中文/其他语言 | 分别显示俄文/中文/中文；设置中可固定中文或俄文并持久化 | 自动化通过 | 仍需中俄系统真机视觉验收 |
| WEB-01 | 访问 `www.ruscny.net/` 并切换中文/俄文 | 官网首页、功能、多人会议、下载状态和页脚完整切换，无缺失键 | 自动化通过 | 文案完整性测试；仍需生产域名浏览器视觉验收 |
| WEB-02 | 访问官网、账号页、隐私、协议、robots、sitemap 和分享卡片 | 同源返回正确类型、安全头与公开链接；官网不暴露管理入口 | 自动化通过 | Fastify 路由单测 + Web 11/11 |
| WEB-03 | 在 `/account` 切换注册/登录并填写完整资料 | 中俄字段完整且不显示账号类型；同源调用正式认证 API；Token 仅在当前标签页；刷新可续签、退出撤销会话 | 代码与自动化通过 | 双语/字段/API/存储/DOM sink/`no-store` 已验证；真实 PostgreSQL、HTTPS 和跨 App 账号登录待测 |
| CONTACT-01 | 任一注册用户创建/编辑/搜索自己的客户 | 只影响自己的客户 | 未执行 | |
| CONV-01 | 任一注册用户选择自己的客户创建会议 | `ownerId` 取认证主体、创建者 Participant 为 HOST，并返回 QR 数据、邀请 URL、房间码 | 单元测试通过 | 真实 PostgreSQL 待复测 |
| CONV-02 | 创建后尝试更改 contactId | 服务端拒绝 | 未执行 | |
| CONV-03 | Host 轮换邀请后分别使用新旧 token/code | 新凭证可用；旧 token 和旧 code 立即失效；并发轮换不覆盖较新结果 | 未执行 | |
| JOIN-01 | 注册用户扫码/链接/房间码加入他人会议 | 登录后恢复原邀请并进入正确会议；不改变账号类型 | 未执行 | |
| JOIN-02 | Guest 快速加入 | 仅获当前会议权限 | 未执行 | |
| JOIN-03 | 1 Host + 4 中文注册用户 + 1 俄语临时用户并发加入 | 6 个稳定 Participant，语言分别正确 | 自动化通过 | 真实 PostgreSQL 集成测试；真机仍未执行 |
| WEB-01 | 未安装 App 的临时用户用邀请链接或房间码加入 H5 | 必填姓名/公司/语言；邀请从地址栏和日志脱敏；仅获单会议权限 | 代码与单元测试通过 | 同源路由/CSP/Guest 认证已验证；正式 HTTPS 浏览器待测 |
| WEB-02 | H5 录音、重连、TTS、导出、结束或被移出 | WebM/MP4/Ogg 可提交；取消不误上传；消息与纠错状态不回滚；权限立即变化 | 代码与单元测试通过 | 仍需 iOS Safari、Android Chrome 和真实 ASR/TTS |
| SOCIAL-01 | 搜索/申请/接受/好友列表/App 内邀请 | 好友关系和待处理会议邀请正确，接受后直接参会 | 自动化通过 | 真实 PostgreSQL 集成测试 |
| ROOM-01 | Android Host + iPhone Guest | 双端加入、presence 正确 | 未执行 | |
| ROOM-02 | Host 移出指定参会者 | 目标 Socket 断开并失去读写/重连权限；移出 Guest 时旧共享链接/房间码同事务失效，主持人重新生成后其他人可继续加入 | 单元测试通过 | 当前加固版真实 PostgreSQL、Redis 跨实例与真机仍未执行 |
| ROOM-03 | 参会者改名后查看旧发言 | 历史仍显示发言当时姓名、公司和语言 | 自动化通过 | 消息不可变快照集成测试 |
| TRANS-01 | Host 中文按住说话 | 最终中文原文、俄语译文、俄语 TTS 同步 | 未执行 | |
| TRANS-02 | 注册参会者俄语按住说话 | 最终俄语原文、中文译文、中文 TTS 同步 | 未执行 | |
| TRANS-03 | 自动播放关闭/手动重播 | 不自动播放，可按 message 重播 | 未执行 | |
| TRANS-04 | 翻译失败/进程中断超时 | 普通失败返回稳定错误码；陈旧 `PROCESSING` 在读取或 Socket join 前收敛为 `FAILED / PROCESSING_TIMEOUT` | 未执行 | |
| REVIEW-01 | 主持人或实际发言者修改/重译并确认或拒绝 | 原始供应商文本保留；revision CAS、幂等、身份快照和实时状态正确 | 单元与 Flutter 测试通过 | 真实多人设备与真实 MT/TTS 待测 |
| REVIEW-02 | 纠错或术语入库与结束/离会/移出/撤销并发 | 服务端事务重验后拒绝陈旧写；仅当前 CONFIRMED revision 可入术语库 | 单元测试通过 | 确定性锁序测试；真实 PostgreSQL 压测待执行 |
| WS-01 | 断网后恢复 | 带 lastSequence 重入、补拉、无重复 | 未执行 | |
| WS-02 | 乱序/重复事件 | messageId 去重，sequence 正确 | 未执行 | |
| END-01 | Host 结束会议 | 双端只读，后续上传被服务端拒绝 | 未执行 | |
| HISTORY-01 | Host 筛选/详情/复制/导出 | 只返回授权会议，TXT/Markdown 含时间/姓名/公司/语言并可按发言者整理 | 自动化通过 | Flutter exporter 单测 + PostgreSQL API 集成测试 |
| SUMMARY-01 | AI 生成/读取会议纪要 | 保留参会人员和逐条发言归属，按 conversationId 隔离；模型结论引用来源 sequence，生成期间变化不保存 | 自动化通过 | 阿里云真实账号与中俄商务会议质量验收待执行 |
| SUMMARY-EMAIL-01 | 主持人选择参会者逐人发送纪要 | 收件地址由服务端关系解析；只返回脱敏提示；逐人发送；保存每位收件人的成功/失败状态 | 自动化通过 | Resend 发信域、真实中俄邮箱、退信与垃圾邮件待预发布验证 |
| SUMMARY-EMAIL-02 | 纪要过期/纠错、非主持人、已移出/无邮箱人员尝试发送 | 创建任务与每封发信前重验；拒绝或标记不可选，不泄露其他会议及完整邮箱 | 自动化通过 | 真实 PostgreSQL 并发与供应商限流待测 |
| SUMMARY-EMAIL-03 | API 返回后进程重启、相同幂等键并发、陈旧发送 claim | PostgreSQL worker 恢复；同请求收敛；超出供应商幂等安全窗口不自动重放 | 自动化通过 | 两个真实 API 副本、故障注入和 Resend 真实幂等行为待测 |
| HISTORY-02 | Guest 权限到期 | 不能通过 REST、Socket 或旧 URL 查看 | 未执行 | |
| DELETE-01 | Host 删除会议 | 事务内写入 `AudioDeletionJob` 后删除会议；提交后对象删除支持 CAS 抢占、陈旧锁恢复和退避重试 | 单元测试通过 | 需真实 PostgreSQL 与 bucket 的部分失败和恢复演练 |
| DELETE-02 | 注册用户/Guest 注销 | 10 分钟近期认证或密码确认；结束该用户作为 owner 的活动会议，匿名化/解除主体关联并撤销会话，保留共享会议的消息、participantId 和顺序 | 单元测试通过 | 完整跨存储 deletion request 查询状态和备份传播仍未实现 |
| DELETE-03 | TTS 已持久化但最终消息提交失败 | 请求路径立即尝试删除，直接删除失败则持久入队重试 | 单元测试通过 | 当前 key 未区分 provisional，仍需生命周期兜底和真实故障演练 |
| ADMIN-01 | 普通 `USER`、会议主持人或 Guest 访问管理 API | 只有服务端 `isSystemAdmin` 或不可复用 User ID 白名单可进入 | 单元测试通过 | 管理权限每请求从数据库重读；预发布浏览器待测 |
| ADMIN-02 | 停用/强退/一次性重置密码/结束会议 | 事务化写业务状态和管理审计；立即撤销会话或广播结束 | 单元测试通过 | 真实 PostgreSQL、Socket、多管理员并发与受信渠道流程待测 |

## 5. 数据隔离测试（发布阻断）

为每个主体创建独立 Token，不允许通过直接改数据库假装权限通过。

| ID | 攻击/竞态步骤 | 必须结果 | 结果 |
| --- | --- | --- | --- |
| ISO-01 | Host A 用 Contact B 的 ID 读取/修改/建会 | 404 或 403，且不泄露 B 详情 | 未执行 |
| ISO-02 | 注册参会者 A 把 URL 的 conversationId 换成 B | 拒绝，数据库无读审计成功事件 | 未执行 |
| ISO-03 | Participant A 向 Conversation B 上传音频 | 拒绝，供应商未被调用 | 未执行 |
| ISO-04 | Message A ID 配合 Conversation B 路径读取/TTS | 拒绝，不返回 message 存在性 | 未执行 |
| ISO-05 | 会议 A 的 lastSequence 用于会议 B 补拉 | 只返回 B 授权范围，不能串消息 | 未执行 |
| ISO-06 | Guest 过期或被移出后保持旧 Socket/签名 URL | 连接/刷新拒绝；音频下载因 Bearer 与会议权限重验立即拒绝，不等签名过期 | 音频权限单测通过；真实 PostgreSQL/Socket 未执行 |
| ISO-07 | Host 结束与上传同时到达 | 状态事务决定，结束后无 FINAL 新消息 | 未执行 |
| ISO-08 | 同一 Idempotency-Key 并发上传两次 | 只生成一个 messageId/sequence | 未执行 |
| ISO-09 | 修改请求体 ownerId/contactId/role | 服务端忽略或拒绝，不能提升权限 | 未执行 |
| ISO-10 | 会议纪要请求尝试传入或混合多个 conversationId | 拒绝，只读取路径指定且已授权的单个会议 | 自动化通过 |
| ISO-11 | 非主持人发邮件，或客户端提交任意邮箱/其他会议 participantId/distributionId | 拒绝或 404；收件地址和任务状态只从当前会议服务端关系解析 | 自动化通过 |

任何 ISO 项失败，最终结论必须是 FAIL。

## 6. API 与认证测试

- 正常/缺失/畸形/过期 Bearer Token。
- 用户禁用、设备撤销、Refresh 重放、并发刷新、会话代际不匹配、旧无 `sessionId` Token 和时钟边界。
- 所有写请求的 schema 校验、未知字段、超长字符串和非法枚举。
- 分页游标篡改、极限 limit、空列表和稳定排序。
- 音频 MIME/文件头不符、空、过短、超长、超大小和解码炸弹。
- 房间码暴力猜测限流、邀请随机性、邀请轮换后旧 token/code 失效、过期/结束/人数上限。
- 幂等键缺失、重复、跨用户/跨会议复用。
- 导出权限、文件名注入、公式/Markdown 内容和大会议内存占用。
- 删除和结束 API 的重复调用与并发竞态。

## 7. WebSocket 测试

- Handshake auth：缺失、过期、撤销、禁用和 Guest token。
- `room.join`：首次、重复、错误会议、已结束、已过期和历史只读。
- `room.joined.missingMessages`：0 条、1 条、大于单页、sequence 空洞。
- `room.joined.participants` 快照、`participant.removed` 更新、被移除主体强制断开及旧连接不再接收。
- processing → final、processing → failed、进程中断后陈旧 processing 在 join 补拉前转 `PROCESSING_TIMEOUT`、final 重复、final 先于 processing。
- 多 API 实例经 Redis adapter 跨实例广播一次且仅一次。
- Redis 短暂断开后的降级/恢复行为；永久消息仍可从 PostgreSQL 补拉。
- App 前后台、Wi-Fi/蜂窝切换、服务端滚动重启和负载均衡 idle timeout。

## 8. 阿里云质量与性能

测试集至少包括 50 条中文和 50 条俄语真实业务短句。不得上传无授权客户语音做测试。

| 指标 | 目标 | 中文结果 | 俄语结果 |
| --- | --- | --- | --- |
| ASR 人工可接受率 | `[产品填写]` | 未执行 | 未执行 |
| MT 人工可接受率 | `[产品填写]` | 未执行 | 未执行 |
| 数字/单位保真率 | 100% 关键样本 | 未执行 | 未执行 |
| 术语保真率 | 100% 指定术语 | 未执行 | 未执行 |
| 端到端 P50 | `[填写]` | 未执行 | 未执行 |
| 端到端 P95 | `[填写]` | 未执行 | 未执行 |
| TTS 首次可播放 P95 | `[填写]` | 未执行 | 未执行 |

覆盖词：SPC、WPC、LVT、EIR、IXPE、Wear Layer、Click System、Unilin、Välinge、MOQ、OEM、ODM、Container、Pallet、Packing、Thickness、Square Meter、Tooyei。

覆盖值：5mm、0.5mm、2000 m²、6.8 USD/m²、日期、百分比、型号、邮箱和电话号码。记录所用 ASR/MT/TTS 模型快照、地域、音色、参数、账号限流与测试成本。

## 9. 真机矩阵

| 组合 | 网络 | 场景 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| Android → iPhone | Wi-Fi | 中文/俄语双向 | 未执行 | |
| iPhone → Android | 蜂窝/Wi-Fi | 双向切换 | 未执行 | |
| Android → Android | 弱网 | 断线补拉 | 未执行 | |
| iPhone → iPhone | 弱网 | 断线补拉 | 未执行 | |
| Android 多厂商 | Wi-Fi | 权限、后台、蓝牙 | 未执行 | |
| iPhone + 耳机 | Wi-Fi | 录放音路由/中断 | 未执行 | |

每个组合测试：首次/永久拒绝麦克风、相机扫码、App Link/Universal Link 冷/热启动、未登录续跳、静音/媒体音量、来电、锁屏、后台、蓝牙、自动播放队列和手动重播。

## 10. 安全与隐私测试

- Secret 扫描：Git、APK/AAB/IPA、source map、日志和崩溃报告无密钥。
- TLS、证书、HSTS、CORS、代理信任、上传限制和安全响应头。
- roomToken 高熵且数据库只存哈希；房间码限速。
- 普通日志无 Token、房间令牌、音频和完整翻译正文。
- 原始上传音频只在单次请求内存缓冲中处理，不生成长期文件；成功/失败/超时均会释放请求缓冲。
- TTS bucket 私有、签名 URL 到期、生命周期规则生效。
- App 内隐私政策、用户协议、录音告知和账号注销入口可用。
- 注销覆盖设备、PostgreSQL、Redis、对象存储和备份删除账本。

## 11. 性能与容量

在不超过供应商账号配额的前提下，记录：

```text
并发房间：[ ]
并发音频上传：[ ]
单会议消息数：[ ]
HTTP P50/P95/P99：[ ]
Socket 广播 P50/P95/P99：[ ]
ASR / MT / TTS P50/P95/P99：[ ]
错误率 / 429：[ ]
PostgreSQL CPU/连接/锁：[ ]
Redis 内存/延迟/淘汰：[ ]
API CPU/内存/事件循环延迟：[ ]
```

必须测试大历史分页和导出，避免一次加载全部消息导致服务或 App 内存峰值。

## 12. 缺陷清单

| 缺陷 ID | 严重度 | 描述 | 复现步骤 | 状态 | 负责人/版本 |
| --- | --- | --- | --- | --- | --- |
| `[BUG-001]` | `[Blocker/Critical/Major/Minor]` | `[填写]` | `[填写]` | `[Open/Fixed/Verified]` | `[填写]` |

Blocker/Critical 未关闭不得发布。Major 需要产品、安全和技术负责人明确书面接受；已知限制不能代替缺陷修复或隐藏未测试项。

## 13. 最终签署

```text
自动化测试：[PASS/FAIL]
数据隔离：[PASS/FAIL]
Android 真机：[PASS/FAIL]
iOS/TestFlight：[PASS/FAIL]
跨平台互通：[PASS/FAIL]
阿里云中俄链路：[PASS/FAIL]
隐私/账号注销：[PASS/FAIL]
生产部署与回滚演练：[PASS/FAIL]

结论：[PASS / PASS WITH RISKS / FAIL]
未解决风险：[填写]
测试负责人：[填写/日期]
技术负责人：[填写/日期]
产品负责人：[填写/日期]
```
