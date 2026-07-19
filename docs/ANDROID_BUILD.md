# Android 构建与发布

## 1. 当前配置

- Flutter 工程：`apps/mobile`
- applicationId：`com.tooyei.translator`
- minSdk：跟随 Flutter `3.44.6` 的 `flutter.minSdkVersion`，当前为 24（Android 7.0）。
- 最低能力：录音、播放、扫码、HTTPS/WSS、App Link、安全存储、前后台恢复。
- 运行时公共配置通过 `--dart-define` 注入，禁止注入任何服务端 Secret。

## 2. 开发环境

CI 固定使用 Flutter `3.44.6`；本地/发布机必须使用同版本（升级应单独提交并重新验证），并安装：

- Android Studio 与 Android SDK。
- JDK 17。
- 一个 Android 8.0 或更高的主验收真机，并补测最低支持的 Android 7.0/API 24；语音、相机、链接跳转和音量行为不应只用模拟器验收。

检查环境：

```bash
flutter doctor -v
cd apps/mobile
wrapper_jar="$(mktemp)"
curl --fail --location --silent --show-error \
  https://raw.githubusercontent.com/gradle/gradle/v8.11.1/gradle/wrapper/gradle-wrapper.jar \
  --output "$wrapper_jar"
echo "2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046  $wrapper_jar" \
  | shasum -a 256 --check
install -m 0644 "$wrapper_jar" android/gradle/wrapper/gradle-wrapper.jar
chmod +x android/gradlew
flutter pub get --enforce-lockfile
flutter analyze
flutter test
```

仓库提交 `gradlew`/`gradlew.bat`、Gradle `8.11.1` properties 与 distribution SHA-256，但不提交二进制 `gradle-wrapper.jar`。CI 从 Gradle `v8.11.1` 标签源码下载 wrapper JAR 并核对官方 SHA-256；源码脚本在本地 jar 缺失时也可使用 Flutter SDK 缓存。不要复制临时工程的 `gradlew` 覆盖仓库自定义脚本，也不要对现有工程执行可能覆盖 Manifest/Gradle 配置的 `flutter create .`。wrapper 补齐只解决构建入口，不代表 APK 已构建成功。

当前 CI 已锁定 Flutter `3.44.6`、JDK 17、AGP `8.10.1`、Gradle `8.11.1` 和 Node `22.23.1`。该 Flutter SDK 当前提供 `compileSdk`/`targetSdk` 36 和 `minSdk` 24；AGP 8.10 支持 API 36，并要求至少 Gradle 8.11.1 与 JDK 17。本项目采用 8.10.1 的补丁版本，不冒进 AGP 9。已用该 Flutter 版本生成 `pubspec.lock`，CI 执行 `flutter pub get --enforce-lockfile`；依赖或 Flutter SDK 变更必须显式更新锁文件，并重新核对这些 SDK 默认值与 Android 工具链兼容性。

版本依据：[Android 官方 AGP 8.10 发布说明](https://developer.android.com/build/releases/agp-8-10-0-release-notes)、[Gradle 官方 distribution 与 wrapper JAR SHA-256](https://gradle.org/release-checksums/)。Gradle `8.11.1` all ZIP 应为 `89d4e70e4e84e2d2dfbb63e4daa53e21b25017cc70c37e4eea31ee51fb15098a`，wrapper JAR 应为 `2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`；CI 从 Gradle `v8.11.1` 标签源码下载 JAR，因为 `services.gradle.org/distributions/gradle-8.11.1-wrapper.jar` 实际返回 404。

## 3. 运行时配置

开发示例：

```bash
flutter run \
  --dart-define=API_BASE_URL=http://10.0.2.2:3000 \
  --dart-define=SOCKET_URL=http://10.0.2.2:3000 \
  --dart-define=APP_LINK_HOST=www.ruscny.net
```

仓库的 debug source set 允许明文 HTTP，便于模拟器使用 `10.0.2.2` 或真机访问局域网开发服务器；main/release 保持 `usesCleartextTraffic=false`。真机不能用 `localhost` 访问电脑，应使用同一局域网可达地址。生产构建必须使用 HTTPS/WSS：

```bash
flutter build appbundle --release \
  --dart-define=API_BASE_URL=https://www.ruscny.net \
  --dart-define=SOCKET_URL=https://www.ruscny.net \
  --dart-define=APP_LINK_HOST=www.ruscny.net
```

这些值会进入安装包，只能放公开地址。`ALIYUN_API_KEY`、JWT Secret、数据库和 Redis 凭据绝不能传给 Flutter。

## 4. 权限和系统配置

App 原生名称和 Flutter 界面均提供中文、俄文。默认跟随系统语言；俄文系统使用俄文，中文及其他系统语言回落中文。用户可在“设置 → 应用语言”中覆盖为中文或 `Русский`。发布前应分别切换 Android 系统语言，并核对桌面名称、界面、权限提示、隐私政策和用户协议。

发布前核对 `android/app/src/main/AndroidManifest.xml` 至少声明：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
```

Android 13 及以上只有在真正启用推送时才请求 `POST_NOTIFICATIONS`。不要为了预留功能在首次启动索要权限。

麦克风和相机必须在使用功能前即时请求；拒绝后提供说明和“打开系统设置”，永久拒绝不能陷入重复弹窗。录音期间进入后台、来电、其他 App 抢占麦克风时应安全结束当前录音且不上传无效文件。

## 5. App Link

目标链接：

```text
https://www.ruscny.net/join/<roomToken>
```

Android Manifest 的对应 Activity 需要 `VIEW`、`BROWSABLE`、`DEFAULT` 和 `android:autoVerify="true"`，scheme 为 `https`、host 为生产域名、pathPrefix 为 `/join/`。

客户端由 `app_links` 统一接管链接，因此 Activity 内必须保留 `flutter_deeplinking_enabled=false`，避免 Flutter 3.27+ 的默认 Deep Link handler 与插件重复消费同一邀请。

构建脚本会解码 Flutter 传给 Gradle 的 `dart-defines`，并把同一个 `APP_LINK_HOST` 写入 Android Manifest placeholder，因此上述 `--dart-define` 同时驱动 Dart 路由和原生 verified-link host。原生单独构建也可通过 Gradle project property `APP_LINK_HOST`（例如受控环境的 `ORG_GRADLE_PROJECT_APP_LINK_HOST`）覆盖，其优先级更高。非默认 staging 域名必须同时部署对应 `assetlinks.json`并检查最终 merged manifest，不能只验证 Dart 页面。

网站需提供：

```text
https://www.ruscny.net/.well-known/assetlinks.json
```

示例结构：

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.tooyei.translator",
      "sha256_cert_fingerprints": ["RELEASE_CERT_SHA256"]
    }
  }
]
```

必须填写 Play App Signing 和实际发布证书所需的 SHA-256 指纹，并使用 `Content-Type: application/json`、无重定向公开访问。验证：

```bash
adb shell pm verify-app-links --re-verify com.tooyei.translator
adb shell pm get-app-links com.tooyei.translator
adb shell am start -a android.intent.action.VIEW \
  -d 'https://www.ruscny.net/join/test-token'
```

未安装 App 时，网页应展示下载引导并保留邀请 Token；自定义回退 scheme 为 `tooyei-translator://join/<token>`，但不能代替已验证 HTTPS App Link。

## 6. 发布签名

当前 `build.gradle.kts` 没有内置 release signingConfig，属于等待 CI/发布机注入的未签名状态；仅创建 `key.properties` 不会自动生效。发布负责人必须以不提交 Secret 的方式补齐 Gradle signingConfig 或由受控 CI 签名，并验证产物证书。

创建单独的上传密钥并离线备份。`key.properties` 与 keystore 不得提交 Git。建议从 CI Secret 或受控发布机注入：

```properties
storePassword=...
keyPassword=...
keyAlias=upload
storeFile=/absolute/secure/path/upload-keystore.jks
```

发布前确认 release 构建使用 release signingConfig，而不是 debug key。若使用 Google Play，启用 Play App Signing 并保存上传密钥恢复资料。

## 7. 生成产物

```bash
cd apps/mobile
flutter clean
flutter pub get --enforce-lockfile
flutter analyze
flutter test
flutter build apk --release \
  --dart-define=API_BASE_URL=https://www.ruscny.net \
  --dart-define=SOCKET_URL=https://www.ruscny.net \
  --dart-define=APP_LINK_HOST=www.ruscny.net
flutter build appbundle --release \
  --dart-define=API_BASE_URL=https://www.ruscny.net \
  --dart-define=SOCKET_URL=https://www.ruscny.net \
  --dart-define=APP_LINK_HOST=www.ruscny.net
```

典型输出：

- APK：`build/app/outputs/flutter-apk/app-release.apk`
- AAB：`build/app/outputs/bundle/release/app-release.aab`

记录 SHA-256、版本号、Git commit、Flutter 版本、构建时间和 dart-define 域名。AAB 上传 Play Console 的 internal testing 后，必须从商店测试轨道安装一次，不能只侧载 APK。

## 8. 发布前真机清单

- 中文与俄语分别录制，松开后只生成一条消息。
- Android 与 iPhone 加入同一会议并双向同步。
- 扫码、App Link、未登录后登录继续加入。
- 拒绝/永久拒绝麦克风和相机权限的提示正确。
- 锁屏、切后台、来电、蓝牙耳机切换、静音和音量行为可解释。
- Wi-Fi/蜂窝切换、断网重连、Token 过期、缺失消息补拉无重复。
- 安装包中搜索不到 API Key、JWT Secret、数据库 URL 和签名密码。
- Android 小屏、主流分辨率和至少两家厂商真机无阻断问题。

## 9. 当前构建状态

2026-07-19 当前工作区执行 `dart analyze apps/mobile/lib apps/mobile/test`，结果 0 issues；`flutter test` 50/50 通过。Android SDK 36、Temurin JDK 17.0.19 与 Gradle 8.11.1 已完成当前代码的 debug APK 编译验证，构建默认 API/Socket 为 `https://www.ruscny.net`，merged manifest 的 verified-link host 也已核对为 `www.ruscny.net`；内部构建 SHA-256 为 `4837e7ac101fa2a66601d51dfc56eb35d59b04c58078410dde5aa89e388ab4ab`。正式 API 尚未在该域名上线，因此此内部包未复制为对外测试包。`artifacts/zh-ru-translator-phone-test.apk` 仍是指向旧局域网开发服务的历史包；正式 API 部署后必须再构建 release APK/AAB。iOS build 仍未执行。
