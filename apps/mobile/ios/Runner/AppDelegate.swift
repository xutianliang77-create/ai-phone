import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private let coreMlNemotronAsrBridge = CoreMlNemotronAsrBridge()
  private let onDeviceTranslationBridge = OnDeviceTranslationBridge()
  private let speechOutputBridge = SpeechOutputBridge()
  private let pcmAudioOutputBridge = PcmAudioOutputBridge()
  private let ocrBridge = OcrBridge()
  private let storeKitBridge = StoreKitBridge()

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "CoreMlNemotronAsrBridge"
    ) {
      coreMlNemotronAsrBridge.register(messenger: registrar.messenger())
    }
    if let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "OnDeviceTranslationBridge"
    ) {
      onDeviceTranslationBridge.register(messenger: registrar.messenger())
    }
    if let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "SpeechOutputBridge"
    ) {
      speechOutputBridge.register(messenger: registrar.messenger())
    }
    if let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "PcmAudioOutputBridge"
    ) {
      pcmAudioOutputBridge.register(messenger: registrar.messenger())
    }
    if let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "OcrBridge"
    ) {
      ocrBridge.register(messenger: registrar.messenger())
    }
    if let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "StoreKitBridge"
    ) {
      storeKitBridge.register(messenger: registrar.messenger())
    }
  }
}
