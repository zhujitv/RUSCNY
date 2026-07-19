# 会议纪要邮件分发代码审计（2026-07-19）

## 范围

审计范围覆盖 Prisma 模型和迁移、会议纪要来源边界、邮件分发 API、Resend adapter、持久 worker、参会权限/账号注销、Flutter/H5 数据流、隐私响应和自动化测试。结论只针对当前工作区代码，不代表生产环境已部署或真实邮件已送达。

## 已确认并修复

| 级别 | 问题 | 修复 |
| --- | --- | --- |
| 高 | 收件人选择和发送结果向主持人返回完整邮箱，超出完成分发所需的最小信息 | API 只返回 `emailHint`，真实邮箱仅保存在服务端；测试断言响应不含完整地址 |
| 高 | POST 同步等待全部外部邮件调用，收件人多或供应商慢时可能被网关超时，进程退出后没有主动恢复入口 | POST 改为快速写入 PostgreSQL 持久任务；独立 worker 启动和周期扫描 `PROCESSING`，App 用状态 GET 轮询 |
| 高 | 纪要只比较消息数量和最大序号；确认纠错原地更新文本时旧纪要可能仍被认为有效 | 增加 `sourceLatestMessageUpdatedAt` 来源边界和消息索引；查看、任务创建、worker 启动和每封发信前均重验 |
| 高 | 相同 `Idempotency-Key` 的并发创建可能由数据库唯一约束返回普通 409，而不是收敛到同一任务 | 捕获唯一键竞争后读取获胜任务，并重新校验纪要 revision 与收件人请求摘要 |
| 中 | 外部供应商可能已受理但进程尚未落库；长时间后重放同一请求可能超出供应商幂等窗口并形成重复邮件 | 每位收件人使用稳定供应商幂等键；陈旧 `SENDING` 只在安全窗口内恢复，超窗标记 `EMAIL_DELIVERY_UNKNOWN_RETRY_EXPIRED`，禁止自动重发 |
| 中 | 缺少邮件 adapter 的直接测试 | 新增单收件人请求、Authorization/幂等 header、429 映射和供应商原始错误不泄露测试 |

## 验证证据

- Prisma Client 生成、schema validate、从空模型生成 PostgreSQL schema SQL：通过。
- 后端 `typecheck`、`build`：通过。
- 后端自动化：30 个测试文件，196/196 通过。
- 纪要邮件、供应商与模板专项：15/15 通过。
- 客户官网账号注册/登录与 H5 回归：11/11 通过，相关 JavaScript 语法检查通过。
- `npm audit --omit=dev --json`：167 个生产依赖，0 个已知漏洞。
- 客户端目录未发现 `RESEND_API_KEY`、`EMAIL_FROM` 或 `EMAIL_PROVIDER` 服务端配置引用。

## 仍需真实环境关闭

- Flutter 3.44.6 / Dart 3.12.2 下直接 `dart analyze lib test` 0 问题、Flutter 测试 51/51、Android debug build 通过；`flutter analyze` 包装命令仍受中文工作区路径下 analysis-server LSP 截断影响，iOS build 未执行。
- 当前没有 PostgreSQL/Redis 测试连接；`202607190001`~`009` 尚未在真实数据库执行，多 API worker 的 CAS 行为需故障注入验证。
- Resend 发信域 SPF/DKIM、真实中俄邮箱、限流、垃圾邮件、退信和投诉 webhook 尚未验证；当前 `SENT` 只表示供应商已受理。
- 已进入外部邮件供应商处理中的邮件无法撤回；注销/撤权可阻止尚未开始的收件人，但生产验收仍应覆盖“撤权与供应商调用同时发生”的时间边界。
- 当前结构化纪要生成是确定性/主持人确认路径；生产级生成式 AI 摘要 provider、质量评测和人工复核仍未接入。
