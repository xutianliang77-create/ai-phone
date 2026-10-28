import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private let audioSessionCoordinator = AudioSessionCoordinator()
  private let v10LicenseBridge=V10DeviceLicenseBridge()
  private lazy var v10SubscriptionBridge=V10SubscriptionBridge(license:v10LicenseBridge)
  private lazy var appleSpeechBridge=V10AppleSpeechBridge(coordinator:audioSessionCoordinator,license:v10LicenseBridge)
  private let onDeviceTranslationBridge = OnDeviceTranslationBridge()
  private lazy var speechOutputBridge = SpeechOutputBridge(
    audioSessionCoordinator: audioSessionCoordinator
  )
  private lazy var pcmAudioOutputBridge = PcmAudioOutputBridge(
    audioSessionCoordinator: audioSessionCoordinator
  )
  private let ocrBridge = OcrBridge()
  private let storeKitBridge = StoreKitBridge()
  private let controlProofBridge = SharedControlProofBridge()
  private let appleAccountBridge = AppleAccountBridge()

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let r=engineBridge.pluginRegistry.registrar(forPlugin:"V10SubscriptionBridge"){v10SubscriptionBridge.register(messenger:r.messenger())}
    if let registrar=engineBridge.pluginRegistry.registrar(forPlugin:"V10DeviceLicenseBridge") {v10LicenseBridge.register(messenger:registrar.messenger())}
    onDeviceTranslationBridge.currentLicense={[weak self] in guard let self else{throw V10LicenseFailure("authorization_required")};return try self.v10LicenseBridge.currentLeaseId()}
    onDeviceTranslationBridge.authorizationCheck={[weak self] source,target,lease in guard let self else{throw V10LicenseFailure("authorization_required")};try self.v10LicenseBridge.require(component:"translation",language:source,target:target,leaseId:lease)}
    speechOutputBridge.authorizationCheck={[weak self] language in guard let self else{throw V10LicenseFailure("authorization_required")};try self.v10LicenseBridge.require(component:"tts",language:language)}
    ocrBridge.currentLicense={[weak self] in guard let self else{throw V10LicenseFailure("authorization_required")};return try self.v10LicenseBridge.currentLeaseId()}
    ocrBridge.authorizationCheck={[weak self] lease in guard let self else{throw V10LicenseFailure("authorization_required")};try self.v10LicenseBridge.require(component:"ocr",leaseId:lease)}
    v10LicenseBridge.onStop={[weak self] in guard let self else{return false};self.onDeviceTranslationBridge.stopForLicense();self.speechOutputBridge.stopForLicense();self.ocrBridge.stopForLicense();return await self.appleSpeechBridge.stopForLicense()}

    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "SharedControlProofBridge") {
      controlProofBridge.register(messenger:registrar.messenger())
    }
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "AppleAccountBridge") {
      appleAccountBridge.register(messenger: registrar.messenger(), presenter: { registrar.viewController })
    }
    if let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "AudioSessionCoordinator"
    ) {
      audioSessionCoordinator.register(messenger: registrar.messenger())
    }
    if let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "V10AppleSpeechBridge"
    ) {
      appleSpeechBridge.register(messenger: registrar.messenger())
    }
    if let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "OnDeviceTranslationBridge"
    ) {
      onDeviceTranslationBridge.register(messenger: registrar.messenger(),presenter:{registrar.viewController})
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
    if Bundle.main.object(forInfoDictionaryKey:"WujieExecutionMode") as? String != "on_device",let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "StoreKitBridge"
    ) {
      storeKitBridge.register(messenger: registrar.messenger())
    }
  }
}
