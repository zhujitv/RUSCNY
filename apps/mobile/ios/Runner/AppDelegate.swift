import Flutter
import UIKit
import AVFoundation

@main
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    do {
      try AVAudioSession.sharedInstance().setCategory(
        .playAndRecord,
        mode: .spokenAudio,
        options: [.defaultToSpeaker, .allowBluetooth]
      )
    } catch {
      NSLog("Audio session will be configured by the Flutter audio plugins: \(error)")
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
