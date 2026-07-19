# 阿里云语音识别、翻译与 TTS 接入

## 1. 生产选型结论

原始产品指令优先指定 Gummy Realtime。上线前的官方能力核对表明：`gummy-realtime-v1`/`gummy-chat-v1` 已出现在“其他（即将下线）”目录，官方生命周期页列出 2026-10-10 的旧语音模型弃用安排；同时不同官方页面对 Gummy 的中俄语音识别/翻译方向描述并不一致。因此，第一版生产默认链路应是：

```text
按住说话音频
  → Qwen3-ASR-Flash（显式 zh 或 ru）
  → Qwen-MT（Chinese ⇄ Russian，带术语）
  → Qwen3-TTS/CosyVoice（显式 Chinese 或 Russian）
```

Gummy 只作为可配置的实验/兼容适配器。只有在目标阿里云账号、北京地域、真实生产参数和中俄两方向语料均通过验收后才能启用；不得让 App 依赖 Gummy 私有事件格式。

该拆分链路更适合第一版“录一段、松开后处理”：每一步可以独立超时、降级和观测；当前 provider 尚未做内部退避重试。TTS 失败也不会丢失已经成功的原文与译文。

## 2. 服务开通

在阿里云百炼控制台完成：

1. 选择实际部署地域并创建独立业务空间；当前 provider 只发送 API Key，不发送 Workspace header，因此必须使用对目标模型/地域有效的 Key 与 endpoint。
2. 开通 Qwen3-ASR-Flash、Qwen-MT 和选定的 Qwen3-TTS/CosyVoice 模型。
3. 创建仅供后端使用的 API Key；开发、预发布、生产分别创建。
4. 确认每个模型在该地域、账号和业务空间可调用，记录 QPS、并发、音频大小、价格和告警阈值。
5. 用中文普通话与俄语样本分别验证识别、翻译和音色，不以控制台单句演示代替 API 验收。

API Key 不得写入 Flutter、二维码、邀请链接、WebSocket 载荷、日志或 Git。

## 3. 后端环境变量

```dotenv
TRANSLATION_PROVIDER=mock
ALIYUN_API_KEY=
ALIYUN_COMPATIBLE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
ALIYUN_DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/api/v1
ALIYUN_ASR_MODEL=qwen3-asr-flash
ALIYUN_TRANSLATION_MODEL=qwen-mt-flash
ALIYUN_TTS_MODEL=qwen3-tts-flash
ALIYUN_TTS_VOICE_ZH=
ALIYUN_TTS_VOICE_RU=
UPLOAD_MAX_BYTES=6000000
PUBLIC_API_URL=http://localhost:3000
AUDIO_STORAGE_DRIVER=local
AUDIO_LOCAL_DIRECTORY=storage/audio
AUDIO_URL_SIGNING_SECRET=
AUDIO_SIGNED_URL_TTL_SECONDS=900
S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
```

- 本地/CI 默认 `TRANSLATION_PROVIDER=mock`，避免测试误计费。
- 生产强制 `TRANSLATION_PROVIDER=aliyun`；mock、缺少 Key/音色、非 HTTPS 的公开/阿里云/S3 endpoint、local 音频存储或缺少 S3/签名密钥都会在启动配置校验时直接失败，不会静默回退。
- Compatible API、DashScope API 和模型名可配置，避免地域、专属域名或模型生命周期变化时重新发版。业务空间由目标 API Key 绑定；当前 provider 不读取 `ALIYUN_WORKSPACE_ID`。
- `ALIYUN_TTS_VOICE_ZH` 和 `ALIYUN_TTS_VOICE_RU` 必须分别是所选模型明确支持中文、俄语的音色；发布前以账号控制台为准。
- `UPLOAD_MAX_BYTES` 默认且最大为 6,000,000 字节；Qwen3-ASR 的 10 MB 上游请求上限还要容纳 Base64 膨胀和 JSON 封装，不能把二进制上传上限直接设为 10 MB。
- 阿里云 OSS 只支持 virtual-hosted-style 请求，因此使用 OSS 时保持 `S3_FORCE_PATH_STYLE=false`；`S3_ENDPOINT` 填地域服务 endpoint，bucket 只填在 `S3_BUCKET`，不要再把 bucket 名嵌入 endpoint。仅当 MinIO 等另一个 S3 兼容服务明确要求 path style 时才设为 `true`。

生产 Key 只放 Secret Manager；不要为了“预留”把当前实现不读取的 Workspace ID、旧 NLS AppKey/Token 写进部署环境，以免出现值已填写但链路实际仍未配置的假象。

## 4. 输入音频约定

第一版路由当前接受 WAV、M4A/AAC、MP3、Ogg/Opus，按上传大小、声明 MIME 和文件扩展名校验。它尚未解析魔数、实际编码或时长，也未在服务端转码；发布端必须让 Flutter 录音格式与目标 ASR 账号实测一致，且在补齐解码级校验前不能把扩展名校验描述为内容验证。

当前已拒绝空文件、超过 `UPLOAD_MAX_BYTES`、不在白名单的声明 MIME/扩展名。最大按住时长主要由客户端限制；伪造 MIME、无法解码、异常容器和真实时长仍需服务端解码级校验，这是生产前必须关闭的安全项。上传缓冲只在请求内处理，不写入长期原始录音目录。

## 5. Qwen3-ASR-Flash

按住说话场景使用非实时 `qwen3-asr-flash` 即可；官方 OpenAI 兼容接口接受不超过 10 MB/5 分钟的单段音频。服务端将本地音频转为 `data:<mime>;base64,...`，调用兼容接口的 chat completions 端点，并根据用户按下的语言按钮显式传入 `asr_options.language`：

```json
{
  "model": "qwen3-asr-flash",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_audio",
          "input_audio": {
            "data": "data:audio/wav;base64,<BASE64>"
          }
        }
      ]
    }
  ],
  "asr_options": {
    "language": "ru"
  }
}
```

中文按钮传 `zh`，俄语按钮传 `ru`。第一版不传 `auto`，因为显式语言能避免把口音或专业缩写误判为其他语种。只接受最终转写文本；空白或质量不达标时返回 `ASR_NO_SPEECH` 或 `ASR_FAILED`，不进入 MT。

当前术语表不参与 ASR：服务端必须先拿到 ASR 文本，才能按命中文本选择术语并传给 Qwen-MT。当前 `qwen3-asr-flash` OpenAI 兼容 API 的 `asr_options` 不应被虚构成支持动态 hotword；在官方文档/目标账号明确提供可用字段前，专业词的 ASR 识别仍必须靠真实语料验收，不得宣称已有热词增强。

未来升级流式字幕时可更换为 `qwen3-asr-flash-realtime` 适配器，但不能改变 App 侧稳定的 `translation.processing/final/failed` 合同。

## 6. Qwen-MT 中俄翻译

ASR 成功后，严格由来源语言决定目标语言：

| sourceLanguage | source_lang | targetLanguage | target_lang |
| --- | --- | --- | --- |
| `zh` | `Chinese` | `ru` | `Russian` |
| `ru` | `Russian` | `zh` | `Chinese` |

请求必须带 `translation_options`。术语表按当前 Host 的 `ownerId` 查询，只加载启用且方向匹配的项，映射为官方字段：

```json
{
  "model": "qwen-mt-flash",
  "messages": [
    {
      "role": "user",
      "content": "这个产品使用 Unilin Click System。"
    }
  ],
  "translation_options": {
    "source_lang": "Chinese",
    "target_lang": "Russian",
    "terms": [
      { "source": "Unilin", "target": "Unilin" },
      { "source": "Click System", "target": "замковая система" }
    ]
  }
}
```

当前实现只在 ASR 完成后向 Qwen-MT 发送 `terms`，不向 ASR 发送热词，也不向 MT 发送 `domains`；按当前识别文本命中的启用术语最多 100 项。若 ASR 已把品牌/SKU 识别错，这个 MT 术语步骤不能保证修复。品牌、SKU、数字和单位保真仍需真实语料验收。

当前服务端只校验上游译文非空；目标语言、数字和关键 SKU 保真检查与自动修复重试尚未实现。发布前至少用验收语料人工阻断不合格模型/参数，后续若增加自动修复必须保持同一幂等消息并记录实际重试。

## 7. Qwen3-TTS / CosyVoice

只对最终译文合成，不合成 ASR 临时文本。第一版优先非实时 HTTP TTS，因为每轮文本已完整；需要更低首包延迟时再改 WebSocket，App 合同不变。

配置原则：

- 中文译文使用 `language_type=Chinese`。
- 俄语译文使用 `language_type=Russian`。
- `qwen3-tts-flash` 系列官方支持中文与俄语，但具体音色的语言支持仍需逐一验证。
- 上游音频会被服务端下载并写入本地或私有对象存储；当前保存 Content-Type 与随机对象 key，不记录时长或内容哈希。
- 播放速度优先由客户端播放器控制，不必为每个速度重复合成和存储。

阿里云 TTS 返回的临时 URL 不直接保存或发给 App。后端先验证协议与 host（仅接受 `aliyuncs.com`/`aliyun.com` 及其子域），禁止重定向，在供应商超时和 15 MB 上限内下载并验证非空音频；随后开发环境写本地目录，生产写启用服务端加密的私有 S3 兼容 bucket。数据库只保存 `asset:<opaque-key>`，Message DTO 返回 `PUBLIC_API_URL` 下默认 15 分钟有效的内部 HMAC 签名 URL；下载还需当前 Bearer Token 并每次重新校验会议权限。

重新请求消息列表或 Socket `room.join` 补拉会为同一 asset ref 生成新 URL。删除会议时，服务端在数据库事务内写入不依赖 Message 外键的 `AudioDeletionJob` 后再删除会议，提交后由 worker 删除本地/S3 资产，失败会指数退避重试。账号注销保留共享会议 TTS，不因单一参会者注销破坏他人历史。TTS 已持久化、但因竞态未能提交到最终 Message 时，请求路径先直接删除，失败后写入同一持久队列。当前对象 key 尚未区分 provisional，生产 bucket 仍必须配置符合保留政策的最大生命周期，覆盖数据库与对象存储同时不可用的极端窗口。TTS 生成、下载或持久化失败时：

1. 原文和译文仍以 `FINAL` 保存和广播。
2. `audioUrl` 为空，并附加可重试的音频状态。
3. 客户端保留文本并提示语音不可用，不得把整条翻译改成失败。
4. 独立 TTS 重试端点尚未实现；在它落地前不能展示可点击但无后端能力的“重试语音”。

## 8. 可选 Gummy 适配器

若业务决定评估 Gummy：

1. 仅在服务端增加 provider adapter，不改 Flutter 事件和数据模型。
2. 使用北京地域 API Key，并先检查目标账号仍有模型权限与配额。
3. 分别以明确 `source_language=zh`/目标 `ru` 和 `source_language=ru`/目标 `zh` 做 API 级验证。
4. 验证来源原文、目标译文、最终句标识、时间戳、热词、音频格式、最长按住时长和并发限流。
5. 临时结果不入库；只在句末最终结果完成后写 TranslationMessage。
6. 保留 ASR→MT 默认链路作为可切换回退，并准备在官方下线前完成迁移。

如果任一方向不受目标账号支持、模型处于下线窗口或输出不稳定，保持 `ALIYUN_ASR_MODEL` + `ALIYUN_TRANSLATION_MODEL` 拆分链路，不做客户端补丁绕过。

## 9. 失败、重试与错误映射

| 阶段 | 可重试 | 对外错误码 | 处理 |
| --- | --- | --- | --- |
| 音频校验失败 | 否 | `INVALID_AUDIO` | 立即拒绝，不调用供应商 |
| 无有效语音 | 通常否 | `ASR_NO_SPEECH` | 提示重新按住说话 |
| 连接超时/429/5xx | 可由客户端用同一幂等键重试 | `PROVIDER_TIMEOUT` / `PROVIDER_RATE_LIMITED` / `PROVIDER_FAILED` | 当前 provider 单次调用不做内部退避重试 |
| ASR 业务错误 | 视错误码 | `ASR_FAILED` | 消息 FAILED，可重新提交 |
| MT 空结果 | 否 | `MT_FAILED` | 不生成 TTS；语言/数字质量校验尚未自动化 |
| TTS 失败 | 后续能力 | `TTS_FAILED` | 文本 FINAL，音频缺失；独立重试端点尚未实现 |
| 鉴权或模型无权限 | 否 | `PROVIDER_CONFIGURATION_ERROR` | 告警，健康检查失败 |

不要无限重试，也不要在同一次请求内跨 provider 静默生成不同语义结果。当前代码没有 provider 内部重试；客户端重试必须复用 `Idempotency-Key`。供应商请求 ID、耗时和阶段可以记录，音频、完整文本和 Key 不进普通日志。

## 10. 发布前供应商验收

- 至少 50 条中文与 50 条俄语真实业务短句，覆盖口音、环境噪声、数字、价格、单位、型号和地板术语。
- 逐条比对 ASR 原文、MT 译文、TTS 发音；记录人工可接受率和 P50/P95 延迟。
- 验证 SPC、WPC、LVT、EIR、IXPE、MOQ、OEM、ODM、Unilin、Välinge、Tooyei 等术语。
- 验证 5mm、0.5mm、2000 m²、6.8 USD/m²、日期和付款比例不被改写。
- 压测不超过账号配额；验证 429、超时、模型无权限、余额不足和网络中断。
- 验证非阿里云/重定向 URL 被拒绝、上游临时 URL 不入库、内部签名 URL 过期、本地/S3 删除、日志脱敏和成本告警。
- 将最终模型快照、地域、音色、参数和验收日期写入测试报告。

## 11. 官方参考

- [阿里云百炼语音识别模型与 Gummy 下线提示](https://help.aliyun.com/zh/model-studio/asr-model/)
- [Qwen3-ASR API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)
- [Qwen-MT API 与 terms 术语字段](https://help.aliyun.com/zh/model-studio/qwen-mt-api)
- [Qwen3-TTS/CosyVoice 支持语言与模型](https://help.aliyun.com/zh/model-studio/tts-model)
- [Gummy 实时语音翻译（仅用于能力核验）](https://help.aliyun.com/zh/model-studio/real-time-speech-translation/)
- [模型生命周期与下线机制](https://help.aliyun.com/zh/model-studio/model-depreciation)
- [阿里云 OSS 与 Amazon S3 的兼容性（请求样式）](https://www.alibabacloud.com/help/en/oss/developer-reference/compatibility-with-amazon-s3)

阿里云模型能力、价格、限流和生命周期会变化；发布与每次模型切换前必须重新核对目标地域的官方文档和控制台，不应只依赖本文快照。
