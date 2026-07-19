# iOS 构建与 TestFlight

## 1. 当前配置

- Flutter 工程：`apps/mobile`
- Bundle ID：`com.tooyei.translator`
- iOS deployment target：13.0。
- 邀请链接：`https://www.ruscny.net/join/<roomToken>`
- 自定义回退：`tooyei-translator://join/<roomToken>`

## 2. 前置条件

- macOS、兼容 Xcode，以及与 CI 一致的 Flutter `3.44.6`。
- Apple Developer Program 账号及 App Store Connect 权限。
- Bundle ID、Distribution Certificate、App Store Provisioning Profile。
- CocoaPods；如工程采用 Swift Package Manager，则按 Flutter 生成配置执行。
- 一台真实 iPhone。麦克风、静音模式、蓝牙、Universal Link 和 TestFlight 必须真机验收。

```bash
flutter doctor -v
cd apps/mobile
flutter pub get --enforce-lockfile
cd ios
pod install
open Runner.xcworkspace
```

仓库应提交 `Podfile`、`Runner.xcodeproj`、`Runner.xcworkspace`、`Flutter/AppFrameworkInfo.plist`、三套 xcconfig、资源目录、AppIcon 以及 `Runner/GeneratedPluginRegistrant.h/.m`。以下文件已从 Git 排除：`Flutter/Generated.xcconfig`、`Flutter/flutter_export_environment.sh`、`Pods/` 和 `.symlinks/`。先执行 `flutter pub get --enforce-lockfile` 再构建；插件变更时 Flutter 可能刷新 registrant，需将更新与 `pubspec.lock` 一同提交，不要手工伪造内容。

已用 Flutter `3.44.6` 生成 `pubspec.lock`，CI 会以 `--enforce-lockfile` 使用它。当前仍没有 CocoaPods `Podfile.lock`，因此 iOS 原生依赖仍不可完全复现；受控 macOS/CocoaPods 环境成功解析后必须提交该锁文件，再让 CI 以 deployment/lockfile 模式安装。

## 3. Info.plist 权限说明

至少提供清晰、与真实用途一致的文案：

```xml
<key>NSMicrophoneUsageDescription</key>
<string>用于录制您主动按住说话的语音，以完成中俄语音识别和翻译。</string>
<key>NSCameraUsageDescription</key>
<string>用于扫描主持人提供的会议二维码并加入翻译房间。</string>
```

如未来启用语音库选择、联系人或推送，再按实际功能添加权限。第一版不应预先请求未使用的权限。

App 必须在第一次实际使用录音/扫码时请求权限。拒绝后说明受影响功能；永久拒绝时提供前往 Settings 的入口。

## 4. 音频会话

录音时将 `AVAudioSession` 配为适合语音的 record/play-and-record 模式，结束录音后恢复播放配置。需要处理：

- 电话、Siri、闹钟和其他音频中断。
- 扬声器、听筒、蓝牙和耳机路由变化。
- 静音开关不代表媒体音量；自动播放前应给出音量提示。
- App 进入后台时终止未完成录音，第一版不声明后台持续录音模式。
- TTS 使用串行播放队列，手动重播不造成多段音频叠加。

若不需要后台音频，不要在 Signing & Capabilities 中启用 Audio background mode。

## 5. Universal Link

在 Runner 的 Associated Domains 中加入：

```text
applinks:www.ruscny.net
```

网站需提供无重定向的：

```text
https://www.ruscny.net/.well-known/apple-app-site-association
```

示例：

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["APPLE_TEAM_ID.com.tooyei.translator"],
        "components": [
          { "/": "/join/*", "comment": "Translation meeting invitations" }
        ]
      }
    ]
  }
}
```

文件使用 `application/json`，不带扩展名，必须填真实 Team ID。App 冷启动、热启动、未登录、登录后续跳、会议结束和 Token 过期都要测试。

客户端由 `app_links` 统一接管链接，因此 `Info.plist` 必须保留 `FlutterDeepLinkingEnabled=false`，避免 Flutter 默认处理器与插件重复消费邀请。

自定义 scheme 在 `CFBundleURLTypes` 中注册，仅作为可控回退；Universal Link 才是生产主入口。未安装 App 的网页实现与安全部署说明见 [`deploy/deep-links`](../deploy/deep-links/README.md)：页面短期保留 Token，安装后需回到同一链接再打开 App，不得把它夸大为商店自动传递的 deferred deep link。

`Runner.entitlements` 使用 `applinks:$(APP_LINK_HOST)`，默认值分别写在 Debug/Profile/Release xcconfig。Dart 的同名 `--dart-define` 不会自动改 Xcode build setting；发布流水线必须同时给对应 xcconfig/build setting 与 Dart define 注入同一个真实 host，并在该域名部署 AASA 文件。不能只改其中一处。

## 6. 运行与归档配置

开发：

```bash
cd apps/mobile
flutter run \
  --dart-define=API_BASE_URL=https://staging-api.example.com \
  --dart-define=SOCKET_URL=https://staging-api.example.com \
  --dart-define=APP_LINK_HOST=staging-translate.example.com
```

发布构建：

```bash
flutter clean
flutter pub get --enforce-lockfile
flutter analyze
flutter test
flutter build ipa --release \
  --dart-define=API_BASE_URL=https://www.ruscny.net \
  --dart-define=SOCKET_URL=https://www.ruscny.net \
  --dart-define=APP_LINK_HOST=www.ruscny.net
```

也可打开 `ios/Runner.xcworkspace`，选择 Any iOS Device (arm64)，执行 Product > Archive。Release scheme 必须使用正确 Team、Bundle ID 和 App Store profile。

不得将阿里云、JWT、数据库或 Redis Secret 放入 dart-define、Info.plist 或 xcconfig；App 内只能包含公开服务地址。

## 7. App Store Connect 与 TestFlight

1. 在 App Store Connect 创建 Bundle ID 对应的 App。
2. 更新 `pubspec.yaml` 的营销版本与 build number；每次上传的 build number 必须递增。
3. Xcode Organizer 执行 Validate App，再 Distribute App > App Store Connect > Upload；或使用生成的 IPA 和受控上传工具。
4. 填写加密出口合规、隐私问卷、麦克风/相机用途、第三方数据处理和账号注销说明。
5. 等待 processing，添加内部测试员；外部测试需提交 Beta App Review。
6. 在 TestFlight 安装包上执行完整中俄双端互通，不把本地 Debug 结果代替 TestFlight 结果。

TestFlight 测试说明至少写明：如何创建 Host、如何以 Guest 加入、测试房间有效期、麦克风用途，以及测试账号/审核联系方式。

## 8. App Review 必备

- App 内“设置 > 账号与安全 > 注销账号”可发现且可执行，不能只让用户发邮件。
- App 内可访问隐私政策和用户协议；App Store Connect 填写有效公开 URL。
- 登录是核心功能时，向审核提供可用账号或明确访客测试路径。
- 明确说明只在用户按住说话时录音，默认不保存完整原始录音。
- 若使用第三方登录，按 Apple 政策评估 Sign in with Apple；第一版仅邮箱/手机号时不因此强制增加第三方登录。
- 提交前生成并核对 Required Reason API/Privacy Manifest 报告，确认所有插件符合当前 App Store 要求。

## 9. 真机验收

- iPhone 与 Android 双向录音、文本和 TTS 同步。
- 相机二维码和 Universal Link 在 App 未运行/后台/前台三种状态工作。
- 登录或访客身份完成后恢复原邀请，不要求重新扫描。
- 静音开关、媒体音量、耳机、蓝牙、电话中断和锁屏行为明确。
- Wi-Fi/蜂窝切换后重新认证、补拉、去重和顺序正确。
- 会话结束、邀请过期、账号禁用和 Refresh Token 撤销立即生效。
- 账号注销入口、隐私政策、用户协议在发布包可用。

## 10. 当前构建状态

当前 Flutter `3.44.6` / Dart `3.12.2` 环境已完成静态检查和 51/51 Flutter 测试。GitHub CI 已在 macOS 15 上成功解析 CocoaPods/Swift Package 并构建无签名 iOS Simulator `Runner.app`。Apple 签名、真机 Archive、IPA、App Store Connect 和 TestFlight 仍未执行；Simulator 成功不能替代这些发布验收。
