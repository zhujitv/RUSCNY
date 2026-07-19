# 中俄实时语音翻译 App 文档

本目录是当前多人会议版本交付、部署和验收的统一入口。范围包括：中文与俄语双向翻译、按住说话、多台设备共享房间、App/H5 注册或临时参会、好友与 App 内邀请、明确发言者归属、翻译纠错审核、服务器管理后台、单次会议隔离、历史记录、TXT/Markdown 导出、结构化会议纪要及主持人逐人邮件分发。

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [产品与架构](./PRODUCT_ARCHITECTURE.md) | 产品范围、角色、系统边界、核心数据流和架构决策 |
| [HTTP API 合同](./API_CONTRACT.md) | REST 端点、请求响应、权限、幂等与错误码 |
| [WebSocket 事件](./WEBSOCKET_EVENTS.md) | 房间连接、事件载荷、顺序、断线续传与错误处理 |
| [安全、隐私与数据隔离](./SECURITY_PRIVACY_DATA_ISOLATION.md) | 认证、授权、密钥、存储、审计和隔离规则 |
| [Android 构建](./ANDROID_BUILD.md) | 本地调试、签名、APK/AAB、App Link 与发布检查 |
| [iOS 与 TestFlight](./IOS_TESTFLIGHT.md) | 签名、权限、Universal Link、归档与 TestFlight |
| [后端部署](./BACKEND_DEPLOYMENT.md) | Node.js、PostgreSQL、Redis、反向代理、迁移和运维 |
| [客户应用官网](./CUSTOMER_WEBSITE.md) | 官网、双语内容、法律页面、下载状态、同源路由和发布阻断项 |
| [服务器管理后台](./ADMIN_CONSOLE.md) | 管理员引导、用户/会议运营、密码重置、审计与监控边界 |
| [浏览器参会与深链接](../deploy/deep-links/README.md) | H5 临时参会、同源路由、App Link/Universal Link 和浏览器验收 |
| [阿里云 Gummy 与 TTS](./ALIYUN_GUMMY_TTS.md) | 服务开通、服务端接入、参数、失败处理和验收 |
| [测试报告](./TEST_REPORT.md) | 测试计划、隔离矩阵、真机互通和交付报告模板 |
| [纪要邮件代码审计](./CODE_AUDIT_2026-07-19.md) | 邮件分发审计范围、已修复问题、验证证据和真实环境待关闭项 |
| [当前限制](./KNOWN_LIMITATIONS.md) | 当前仓库验证状态、当前版本边界和发布前阻断项 |
| [隐私政策](./PRIVACY_POLICY.md) | 面向用户的第一版隐私政策模板 |
| [用户协议](./TERMS_OF_SERVICE.md) | 面向用户的第一版服务协议模板 |
| [账号注销与数据删除](./ACCOUNT_DELETION.md) | App 内入口、身份校验、处理流程和后台实现要求 |

## 文档状态约定

- “必须”表示发布前验收条件。
- “建议”表示默认实施方案，可在风险评审后替换。
- 正式公开域名已确定为 `www.ruscny.net`；发布前必须完成 HTTPS、DNS、同源反向代理和 App/Universal Link 关联文件验证。
- 隐私政策和用户协议是产品交付模板，不构成法律意见；上线前必须由运营主体和法律顾问补齐主体、联系方式、地域与第三方清单。
- API 与 WebSocket 文档定义目标合同。若代码实现与文档不一致，发布前必须统一，不能依赖客户端猜测兼容。
