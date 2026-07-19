# 安全、隐私与数据隔离

## 1. 安全目标

首要安全目标是：任何主体都不能访问、推断或修改不属于其授权范围的客户、会议、消息、参与者、音频或导出文件。其次是保护账号令牌和阿里云、数据库、Redis 等服务端凭据，并把默认采集降到完成翻译所需的最低程度。

## 2. 认证与设备会话

- Access Token 使用短有效期，并至少包含 `sub`、`deviceId`、`sessionId`、`iat`、`exp` 和随机 `jti`；Guest 还绑定 GuestIdentity 与单个 `conversationId`。
- Refresh Token 每次使用后轮换，只在数据库保存不可逆哈希，并与同一 `sessionId` 会话族绑定；旧 Token 再次使用视为泄露并撤销该会话族。
- 每个设备建立独立 `UserDevice`，支持远程撤销；退出登录撤销服务端会话并清除本机安全存储。
- App 不保存密码。密码登录时服务端使用适当成本的 Argon2id 或 bcrypt 哈希。
- Guest 使用与正式账号同寿命的短期 Access、仅限一个会议的凭证。长会议通过 `guestPrincipalToken + conversationId + 严格匹配的 deviceId` 续期；服务端在行锁事务内重新验证会议、身份、参会关系和历史策略，轮换 `sessionId` 并断开旧 Socket。续期不接受共享邀请，因此邀请轮换不会中断已授权的长会议，也不会让被移除者用旧邀请重入。
- Guest 续期端点的未知主体、错误会议/设备、撤销、移除、到期和并发状态变更使用同一 401 错误，防止身份枚举。`guestPrincipalToken` 只放平台安全存储，不写 URL、日志、本地明文存储或崩溃报告。
- WebSocket 与 HTTP 共用同一认证和吊销检查。不要把长期 Token 放在 URL 查询参数、日志或崩溃报告中。

本轮会话族迁移部署后，不含 `sessionId` 的旧 Token 会被拒绝。客户端必须把这类 401/Socket 认证失败收敛为清理旧凭据并重新登录，不能无限刷新；发布计划应明确这次强制重新认证影响。

## 3. 服务端授权规则

每个请求按以下顺序处理：

1. 验证 Token、设备状态、用户状态和过期时间。
2. 从路径参数加载目标 Conversation 或 Contact。
3. 基于 `Conversation.ownerId`、Participant 和 GuestIdentity 等数据库关系判定创建者、注册参会者或临时参会者对该资源的权限。
4. 验证会议状态和历史授权期限。
5. 对嵌套资源验证外键归属，例如 Message 与 Participant 必须属于同一 Conversation。
6. 仅在全部验证通过后读写或调用外部供应商。

客户端传入的 `ownerId` 和角色字段应被忽略或拒绝。注册用户查询客户必须带服务端生成的 `ownerId = auth.userId` 条件；主持人权限必须由该会议的 `ownerId`/Participant 关系得出。非 owner 注册用户和 Guest 查询消息必须先通过参与关系和 `guestAccessExpiresAt` 获取允许的 Conversation 集合。

## 4. 数据库隔离约束

建议至少建立以下约束和索引：

- `Contact(ownerId, id)` 索引。
- `Conversation(ownerId, contactId, id)` 索引，`contactId` 创建后禁止更新。
- `Participant(conversationId, userId)` 和 `Participant(conversationId, guestIdentityId)` 索引。
- `TranslationMessage(conversationId, sequence)` 唯一约束。
- `TranslationMessage(conversationId, id)` 组合索引。
- `(conversationId, participantId, idempotencyKey)` 唯一约束。
- 外键保证 Participant、Message、Summary 不能指向不存在的 Conversation。

建议在数据库事务中分配会议内 sequence。若使用 PostgreSQL 行级安全策略，它是纵深防御，不代替应用层授权测试。

## 5. 房间与邀请安全

- `roomToken` 至少使用 128 bit 密码学安全随机数，数据库只保存其哈希；邀请 URL 中不出现数据库 ID。
- 房间码单独随机生成、短期有效并限速；同一 IP、设备和账号连续失败应触发退避或临时锁定。
- Host 轮换邀请时必须原子替换 roomToken/roomCode 哈希，响应只向 owner 返回新明文凭证并设置 `private, no-store`；提交后旧 token/code 立即拒绝，不能存在两个同时有效的邀请代际。
- 二维码和邀请链接可能被转发，因此加入仍需临时用户完整资料或正式账号、房间状态和服务端 Participant 关系验证。
- 一个会议允许一名 Host 和多名注册/临时 Participant。新加入/房间重连会产生 `participant.joined`，资料和在线状态通过 `participant.updated`/`participant.presence` 同步，Host 移出会产生 `participant.removed`；已移出的同一主体再次 join 直接返回 `PARTICIPANT_REMOVED`。
- 移出只撤销目标 Participant，不改变其他人的在线状态。正式用户的移出状态由 `(conversationId,userId)` 稳定关系拦截；临时 Guest 只持有可转发的共享邀请，因此移出 Guest 必须在同一 Conversation 行锁事务中撤销 GuestIdentity 并轮换共享 token/code 哈希，使用新 deviceId 也不能复用旧链接。新明文凭证不通过广播发送，Host 需主动重新生成。目标主体随后访问消息、人员、导出、纪要或 Socket 都必须重新走数据库关系验证。
- Host 结束会议后，HTTP 上传与 WebSocket 写事件都必须拒绝。

## 6. 密钥和基础设施

- `ALIYUN_API_KEY`、JWT 密钥、数据库密码、Redis 密码、APNs/FCM 私钥只存在于服务端 Secret Manager 或部署平台密钥存储。
- 生产、预发布和开发使用不同密钥与数据库，不共享 Redis 命名空间。
- 所有公网链路使用 TLS 1.2 或更高；数据库和 Redis 优先使用私网与 TLS。
- Secret 不提交 Git、不写入 Flutter `--dart-define`、不打印到启动日志。
- 密钥按最小权限创建、设轮换周期，并记录最后轮换人和时间。

## 7. 最小化收集与保留

当前版本默认保存：最终原文、最终译文、不可变发言者姓名/公司/语言快照、participantId、语言方向、时间、状态、供应商请求追踪 ID、参会者用于接收纪要的邮箱快照、邮件分发状态，以及可选的短期 TTS 音频。

当前版本默认不保存：完整原始录音、临时识别结果、静音/无效音频、通讯录和与当前会议无关的设备内容。当前后端把单段上传读入请求内存缓冲并直接发给供应商，不写临时音频文件，因此也没有“定时清理临时目录”的实现；进程内缓冲会随请求结束释放。若后续为转码落盘，必须再增加成功/失败/崩溃路径清理和遗留文件定时任务。

TTS 音频应设置明确的自动过期时间；URL 使用短期签名，不能公开永久可猜。数据库备份的保留周期、删除传播时间和恢复权限必须写入生产运维记录。

## 8. 用户告知与同意

进入会议且首次录音前显示：

> 本次交流将进行语音识别、翻译并保存文字记录。当前版本默认不保存完整原始录音。

用户需主动确认后才能开启麦克风。AI 会议纪要只在主持人明确操作后处理其有权访问的单次会议，并将最终文本、发言人身份快照和时间发送给隐私政策列明的阿里云百炼；不默认跨会议合并。若未来增加录音保存、声纹或跨会议分析，必须另行告知用途、保存期和第三方，并取得所需授权。

## 9. 日志与审计

可以记录：请求 ID、内部用户/会议 ID、事件类型、状态码、耗时、供应商请求 ID、重试次数和错误类别。

不得记录：Access/Refresh Token、房间令牌、验证码、密码、API Key、数据库 URL、完整原文/译文、原始音频或带签名音频 URL。排障需要内容样本时必须经过授权并脱敏。

审计至少覆盖：登录、刷新、设备撤销、客户增删改、会议创建/结束/删除、历史授权变更、导出、纪要邮件分发、账号注销和管理员数据操作。

服务器管理权限与统一注册账号、单次会议主持人角色分离，并在每次请求重新从数据库验证。`AdminAuditLog` 只保存操作人/对象/动作/非敏感 metadata、request ID、IP 和时间，不得保存密码或任何 Token。管理员签发的密码重置 Token 只以带 Pepper 的摘要入库，使用一次后撤销全部设备会话。

## 10. 数据删除

- Host 删除会议时，服务端级联删除或匿名化该会议消息、参与者、结构化纪要和 TTS 对象；操作需二次确认并审计。
- 非 owner 注册参会者和 Guest 无权删除创建者的完整会议，但可请求删除自己的账号或个人资料，冲突数据按适用法律和运营主体政策处理。
- 会议删除在同一事务内写入持久 `AudioDeletionJob` 并删除业务记录，对象删除由多实例安全的 worker 在提交后重试。未提交消息的 TTS 直接清理失败后也入队。账号注销采用匿名化保留共享会议记录；备份、第三方与完整跨存储可审计 deletion request 仍属发布加固项。
- 备份中的数据在备份生命周期内自然过期，恢复时必须重新应用删除清单。

会议纪要邮件只能由该会议的注册主持人发起。服务端根据数据库中的 Participant 与 User/GuestIdentity 关系解析收件邮箱，不接受客户端提供任意地址；客户端和主持人只能看到脱敏邮箱提示。每位收件人独立发送，禁止使用公开的 To/CC 列表。已移出、撤销、删除、过期或没有邮箱的主体不可选。持久 worker 在排队和每封发送前重验纪要来源及权限；发送记录和状态查询按 `conversationId` 隔离，账号注销时清除邮件收件人快照并使尚未发送的任务失败。

## 11. 发布前隔离测试门槛

以下任一失败都阻断发布：

1. Host A 读取或修改 Host B 的 Contact。
2. 注册参会者 A 使用合法 Token 访问未获授权的 Conversation B。
3. 更换路径中的 `conversationId` 后仍可读取 Message 或导出。
4. Participant 属于会议 A，却能向会议 B 提交音频。
5. 已结束或过期会议仍能加入或发送。
6. Guest 历史授权过期后仍能通过缓存 URL 或 WebSocket 补拉获取数据。
7. 同一音频幂等重试生成多条消息。
8. 会议纪要接口可跨 `conversationId` 读取或混合其他会议消息。
9. 非主持人发送会议纪要，或客户端注入任意收件地址、已移出人员邮箱。
10. TTS 签名 URL 超期后仍可公开访问。
11. 日志、崩溃报告或构建产物中出现任何 Secret。
