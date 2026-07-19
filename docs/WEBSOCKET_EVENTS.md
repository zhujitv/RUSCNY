# WebSocket / Socket.IO 事件合同

## 1. 连接约定

- 协议：Socket.IO，生产环境必须经 TLS（`wss`/HTTPS）。
- 服务地址：Flutter 正式构建使用 `https://www.ruscny.net`。
- Socket.IO path：`/socket.io`。
- 实时通道只同步房间状态和翻译结果；第一版音频通过 HTTP multipart 上传，不通过 Socket.IO 发送。
- Access Token 通过 Socket.IO handshake 的 `auth.token` 传入，不放 URL、房间事件或日志。

Flutter 建连概念示例：

```dart
IO.io(
  socketUrl,
  IO.OptionBuilder()
      .setTransports(['websocket'])
      .setPath('/socket.io')
      .setAuth({'token': accessToken})
      .disableAutoConnect()
      .build(),
);
```

服务端在握手、每个受保护入站事件和每次房间广播前验证 Token、`sessionId` 会话代际、设备会话、GuestIdentity 与参与关系。Token 到期有独立定时断开；Guest 会话轮换/过期、参与者移除、设备撤销或账号停用后，旧连接停止接收并被断开。缺少当前会话声明的旧 Token 在认证迁移部署后会被拒绝；握手失败使用 `connect_error`。客户端最多执行一次认证恢复：正式账号轮换 Refresh Token，Guest 调用 `/auth/guest/refresh` 并轮换服务端 `sessionId`；成功后使用新 Access 重连，仍失败时清理当前会议 Token 并要求重新授权，不能无限重试。

## 2. 通用字段

所有时间使用 ISO 8601 UTC，例如 `2026-07-18T10:20:00.000Z`。所有 ID 是不可推断字符串。语言仅允许：

```text
zh  中文
ru  俄语
```

`sequence` 是同一 `conversationId` 内由服务端分配的单调递增整数，只对可进入历史时间线的消息有意义。客户端用 `messageId` 去重，用 `sequence` 排序；不得用本机时间决定顺序。

正式账号统一为 `USER`，不会通过 Socket 显示账号类型。事件里的 `participants[].role` 和 `speakerRole` 是当前会议的角色快照：创建者由服务端按 `Conversation.ownerId` 标记为 `HOST`，加入者为非主持人；它们不能用于推断用户在其他会议中的权限。

第一版事件名和方向：

| 事件 | 方向 | 作用 |
| --- | --- | --- |
| `room.join` | Client → Server | 认证后加入会议并提交最后 sequence |
| `room.joined` | Server → Client | 确认加入并返回缺失消息 |
| `room.leave` | Client → Server | 主动离开当前 Socket 房间 |
| `participant.joined` | Server → Room | 通知其他端有参与者加入 |
| `participant.updated` | Server → Room | 参会者本次会议资料已更新 |
| `participant.presence` | Server → Room | 在线、离线或主动离开状态变化 |
| `participant.removed` | Server → Room | Host 移出指定参会者并强制断开目标连接 |
| `invitation.rotated` | Server → Room/Host Subject | Guest 被移出后共享邀请已失效，Host 需重新生成 |
| `friend.presence` | Server → Friend Subjects | 好友在线状态变化 |
| `friend.request.created/responded` | Server → Subject | 好友申请新建/处理 |
| `friend.removed` | Server → Subject | 好友关系已删除 |
| `meeting.invitation.created/responded` | Server → Subject | App 内会议邀请新建/处理 |
| `translation.processing` | Server → Room | 一条音频提交已进入处理 |
| `translation.final` | Server → Room | 最终原文、译文和可用音频 |
| `translation.failed` | Server → Room | 该消息处理失败，可按错误类型重试 |
| `room.ended` | Server → Room | Host 已结束会议，房间转只读 |
| `room.error` | Server → Client | 加入或房间操作失败的稳定错误 |

## 3. `room.join`

客户端连接成功后发送：

```json
{
  "conversationId": "conv_123",
  "lastSequence": 34
}
```

- `conversationId` 必填。
- `lastSequence` 可选。首次进入传 `0` 或省略；重连时传本地已完整提交的最大连续 sequence，不是“见过的最大值”。
- Token 不放在事件载荷中，统一来自 handshake。

服务端处理顺序：验证用户/Guest 身份、会话代际、Conversation 状态、Participant 关系、Host/历史访问策略和设备限制；随后先把超过完整 provider 处理窗口的陈旧 `PROCESSING` 消息原子改为 `FAILED / PROCESSING_TIMEOUT`。Socket 进入房间后，正式账号按 `Conversation → User → UserDevice → Participant`、Guest 按 `Conversation → GuestIdentity → Participant` 锁顺序做最终权限复验，在同一事务内只把仍为 `ONLINE/OFFLINE` 且未移出、未离开的参会者置为在线，并生成人员与补拉消息快照；绝不会清空 `leftAt` 复活已退出身份。socket-participant 映射在事务提交前建立，因此移出/退出/结束若先获得锁，入会不会返回任何快照；入会若先完成，后续撤权可立即找到并断开目标。房间码和 `roomToken` 只用于 HTTP 加入流程，不能绕过此处授权。

## 4. `room.joined`

服务端只向发起加入的 Socket 发送：

```json
{
  "conversationId": "conv_123",
  "participantId": "p_123",
  "status": "ACTIVE",
  "latestSequence": 35,
  "hasMore": false,
  "participants": [
    {
      "id": "p_host",
      "role": "HOST",
      "displayName": "王经理",
      "company": "图远科技",
      "preferredLanguage": "zh",
      "presence": "ONLINE",
      "joinedAt": "2026-07-18T10:00:00.000Z",
      "lastSeenAt": "2026-07-18T10:20:00.000Z"
    },
    {
      "id": "p_123",
      "role": "GUEST",
      "displayName": "Ivan",
      "company": "Example LLC",
      "preferredLanguage": "ru",
      "presence": "ONLINE",
      "joinedAt": "2026-07-18T10:19:40.000Z",
      "lastSeenAt": "2026-07-18T10:20:00.000Z"
    }
  ],
  "missingMessages": [
    {
      "messageId": "msg_456",
      "conversationId": "conv_123",
      "participantId": "p_host",
      "speakerRole": "HOST",
      "speakerDisplayName": "王经理",
      "speakerCompany": "图远科技",
      "speakerLanguage": "zh",
      "sourceLanguage": "zh",
      "targetLanguage": "ru",
      "sourceText": "这个产品有库存。",
      "translatedText": "Этот товар есть в наличии.",
      "audioUrl": "https://www.ruscny.net/v1/audio/assets/tts-...?expires=...&signature=...",
      "status": "FINAL",
      "sequence": 35,
      "createdAt": "2026-07-18T10:20:00.000Z"
    }
  ]
}
```

`participants` 是完整会议人员快照，包含已在线、离线、离开和移出的历史 Participant；重连时客户端以稳定 participantId 对齐本地列表。`missingMessages` 包含 `sequence > lastSequence` 且当前主体有权读取的消息，按 sequence 升序，单次最多 500 条。进程中断遗留且超过 `max(120 秒, 4 × ALIYUN_REQUEST_TIMEOUT_MS)` 的 `PROCESSING` 会在查询前转为 `FAILED / PROCESSING_TIMEOUT`，避免客户端永久卡在处理中。`hasMore=true` 时客户端继续调用历史消息 HTTP 接口分页补齐；不能静默截断后直接宣布同步完成。

服务端同时支持 Socket.IO acknowledgement：`{ok:true,data:<上述响应>}`，但无 ack 回调的客户端仍会收到 `room.joined` 事件。

客户端先合并 `missingMessages`，确认连续 sequence，再把房间标为 LIVE。合并以 `messageId` 为主键，重复 final 更新 processing 占位而不是新增气泡。

## 5. `room.leave`

```json
{
  "conversationId": "conv_123"
}
```

此事件只让当前 Socket 离开实时房间，不代表整个 Participant 主动退出。同一 Participant 仍有其他 Socket 在房间时继续保持 `ONLINE`；最后一个 Socket 离开时标为 `OFFLINE`。用户明确退出会议必须调用 `POST /v1/conversations/:id/leave`，该 REST 操作才会把非 Host Participant 标为 `LEFT` 并断开其所有会议 Socket；Host 必须使用结束会议。

## 6. `participant.joined`

```json
{
  "conversationId": "conv_123",
  "participant": {
    "participantId": "p_123",
    "role": "GUEST",
    "displayName": "Ivan",
    "company": "Example LLC",
    "preferredLanguage": "ru",
    "presence": "ONLINE",
    "joinedAt": "2026-07-18T10:19:40.000Z"
  }
}
```

只包含当前会议显示所需的最小信息，不暴露手机号、邮箱、设备 ID、Token 或 Contact 备注。重复重连不应生成多个逻辑参与者；是否通知“新设备加入”由服务端设备策略决定。

`participant.updated` 与 `participant.presence` 使用相同的 `{conversationId, participant}` 结构。客户端以 participantId 覆盖本地对应行，不新增重复参会者。

## 7. `participant.removed`

```json
{
  "conversationId": "conv_123",
  "participantId": "p_123",
  "removedAt": "2026-07-18T10:30:00.000Z"
}
```

Host 通过 `DELETE /v1/conversations/:conversationId/participants/:participantId` 触发。其余仍授权客户端保留该行并显示 `REMOVED`；被移出主体的 Socket 会被服务端断开，后续 REST、入站事件、重连和房间广播均重新验证权限，因此不能依赖被移出端自行处理该事件。注册用户的 Participant 封禁按用户与会议关系保留，再次 join 得到 `403 PARTICIPANT_REMOVED`。移出临时 Guest 时，服务端在同一 Conversation 行锁事务中撤销 GuestIdentity 并轮换共享 token/code 哈希，原二维码、链接和房间码立即失效；返回及广播 `invitationRotated=true`/`invitation.rotated`，但不广播新明文凭证。其他参会者不会被中断。

`invitation.rotated` 载荷为 `{conversationId, reason:"PARTICIPANT_REMOVED", credentialsAvailable:false}`。Host 收到后调用邀请轮换接口获取新的一次性明文，不能继续展示旧二维码。

## 8. `translation.processing`

HTTP 音频上传通过授权和幂等校验、创建消息后广播：

```json
{
  "conversationId": "conv_123",
  "messageId": "msg_456",
  "participantId": "p_host",
  "speakerRole": "HOST",
  "speakerDisplayName": "王经理",
  "speakerCompany": "图远科技",
  "speakerLanguage": "zh",
  "sourceLanguage": "zh",
  "targetLanguage": "ru",
  "status": "PROCESSING",
  "createdAt": "2026-07-18T10:20:00.000Z"
}
```

它不是最终历史内容，`sourceText`/`translatedText` 不应出现。客户端按 `messageId` 建立处理中占位，重复事件只更新状态。

## 9. `translation.final`

```json
{
  "conversationId": "conv_123",
  "messageId": "msg_456",
  "participantId": "p_host",
  "speakerRole": "HOST",
  "speakerDisplayName": "王经理",
  "speakerCompany": "图远科技",
  "speakerLanguage": "zh",
  "sourceLanguage": "zh",
  "targetLanguage": "ru",
  "sourceText": "这个产品有库存。",
  "translatedText": "Этот товар есть в наличии.",
  "audioUrl": "https://www.ruscny.net/v1/audio/assets/tts-...?expires=...&signature=...",
  "status": "FINAL",
  "sequence": 35,
  "startedAtMs": 0,
  "endedAtMs": 2150,
  "createdAt": "2026-07-18T10:20:00.000Z"
}
```

- 只广播供应商确认的最终识别与最终译文。
- `audioUrl` 可为 `null`；TTS 失败不能让已成功的文本消失。
- 当前 TTS 在 final 前同步尝试；失败时同一个 FINAL Message 可带 `errorCode=TTS_FAILED`、`audioUrl=null`。当前没有 `translation.audio.ready` 或独立 TTS 重试事件。
- URL 是服务端内部默认 15 分钟签名地址，不是阿里云临时 URL；播放请求还必须携带当前 Access Token，服务端每次重新校验会议权限。签名过期后重新获取 messages 或 `room.joined` 补拉数据以生成新地址。
- 收到相同 `messageId` 的 processing/final 顺序颠倒时，FINAL 状态不可回退。
- sequence 出现空洞时先缓存后续消息并触发补拉，不直接重排为连续。

## 10. `translation.failed`

```json
{
  "conversationId": "conv_123",
  "messageId": "msg_456",
  "participantId": "p_host",
  "speakerRole": "HOST",
  "speakerDisplayName": "王经理",
  "speakerCompany": "图远科技",
  "speakerLanguage": "zh",
  "status": "FAILED",
  "errorCode": "PROVIDER_TIMEOUT",
  "retryable": true,
  "createdAt": "2026-07-18T10:20:08.000Z"
}
```

允许对客户端暴露的错误码：

| errorCode | retryable | 客户端提示 |
| --- | --- | --- |
| `INVALID_AUDIO` | false | 录音无效，请重新按住说话 |
| `ASR_NO_SPEECH` | false | 未检测到有效语音 |
| `ASR_FAILED` | 视情况 | 识别失败，请重试 |
| `MT_FAILED` | true | 翻译失败，请重试 |
| `PROVIDER_TIMEOUT` | true | 服务超时，请稍后重试 |
| `PROCESSING_TIMEOUT` | true | 上次处理被中断且已超时，请重新提交 |
| `PROVIDER_RATE_LIMITED` | true | 当前繁忙，请稍后重试 |
| `ROOM_NOT_ACTIVE` | false | 会议已结束或过期 |
| `TTS_FAILED` | 不由本事件发送 | 当前作为 `translation.final` 的降级字段；独立语音重试端点尚未实现 |

不得把供应商响应正文、堆栈、Secret 或内部网络信息发送给 App。

## 10.1 `translation.review.updated`

人工纠错提案、重新翻译、确认或拒绝提交后广播。载荷沿用完整 FINAL Message DTO，并增加当前纠错摘要：

```json
{
  "conversationId": "conv_123",
  "messageId": "msg_456",
  "participantId": "p_host",
  "status": "FINAL",
  "sourceText": "这个产品有现货。",
  "translatedText": "Этот товар есть в наличии.",
  "originalSourceText": "这个产品有库存。",
  "originalTranslatedText": "Этот товар есть в наличии.",
  "reviewStatus": "PENDING",
  "reviewRevision": 2,
  "pendingCorrection": {
    "revision": 2,
    "sourceText": "这个产品有现货。",
    "translatedText": "Товар имеется на складе."
  },
  "correction": {
    "id": "corr_789",
    "revision": 2,
    "kind": "MANUAL",
    "status": "PENDING",
    "actorParticipantId": "p_host",
    "actorDisplayName": "王经理"
  }
}
```

客户端仍按 `messageId` 合并，但同为 FINAL 时必须优先较大的 `reviewRevision`；revision 相同时还必须按 `CONFIRMED/REJECTED > PENDING > UNREVIEWED` 保留更完整状态，不能让延迟到达的提案事件覆盖确认/拒绝结果。`sourceText/translatedText` 始终是最后确认版本；`PENDING` 提案只从 `pendingCorrection` 展示。确认或拒绝后该字段为 `null`。事件只发给当时仍通过服务端会议权限复验的 Socket；断线期间的最终状态由 `room.joined.missingMessages` 或 REST 消息补拉恢复。

## 11. `room.ended`

```json
{
  "conversationId": "conv_123",
  "endedAt": "2026-07-18T11:00:00.000Z"
}
```

客户端立即停止录音和新上传，结束当前未提交的本地音频，把界面切换为只读。服务端仍必须拒绝竞态中到达的 HTTP 上传；不能只依赖 App 停止按钮。

## 12. 断线重连算法

1. 显示“连接断开/正在重连”，立即禁止开始新录音。
2. Socket.IO 退避重连；若认证失败，执行一次 Refresh Token 轮换并重建连接。
3. 连接成功后发送 `room.join` 与本地最大连续 `lastSequence`。
4. 收到 `room.joined` 后先合并 `missingMessages`。
5. 以 `messageId` 去重，以 `sequence` 排序，并检查空洞。
6. 同步完成后恢复 LIVE 和按住说话。
7. 若会议已结束/过期/权限撤销，则停止重连并进入只读或离开房间。

客户端离线期间已经录完但尚未上传的原始音频第一版不应长期排队；提示用户网络恢复后重新说，避免隐私和重复提交风险。

## 13. 错误与协议版本

握手错误通过 `connect_error` 返回用户可理解的 message，并在 `error.data.code` 提供稳定 code。加入失败同时通过 acknowledgement 和 `room.error` 返回：

```json
{
  "code": "CONVERSATION_NOT_FOUND",
  "message": "会议不存在"
}
```

当前 `room.error` 不含 requestId；生产排障如需关联，应在协议中向后兼容地新增该字段，不能发送堆栈或内部异常。
同一 Socket 在 10 秒内最多发起 8 次入会；同一会议已有未完成的入会时返回 `ROOM_JOIN_IN_PROGRESS`，超限返回 `ROOM_JOIN_RATE_LIMITED`。客户端应等待本次 acknowledgement，不应并发重复调用。

服务端对未知字段可以忽略，对缺失必填字段必须拒绝；事件删除、字段类型改变或语义改变属于破坏性变更，需要新协议版本。新增可选字段保持向后兼容。

## 14. 必测场景

- 未认证、Token 过期、设备撤销和用户禁用时握手失败。
- 合法 Token 但未参与该会议时 `room.join` 失败。
- Guest 历史期限过期后无法重连补拉。
- Host 移除参与者后，Host 收到 `participant.removed`，目标连接断开且旧 Token 不能继续读写该会议。
- 顺序重复 `room.join` 不重复 Participant，不重复消息；并发重复返回 `ROOM_JOIN_IN_PROGRESS`且不启动第二组数据库查询。
- processing/final 重复、乱序和断线跨越时只显示一条最终消息。
- sequence 空洞能补拉；大量缺失消息不会静默截断。
- Host 结束与音频上传竞态时，结束后的写入失败。
- 多 API 实例经 Redis 广播时，双方仍只收到一次事件。
