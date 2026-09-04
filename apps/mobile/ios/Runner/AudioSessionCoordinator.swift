import AVFoundation
import Flutter
import Foundation

final class AudioSessionCoordinator: NSObject, FlutterStreamHandler {
  private enum Role { case capture, playback }
  private let eventChannelName = "translation_mobile/audio_session/events"
  private let methodChannelName = "translation_mobile/audio_session"
  private let flutterCaptureOwner = "flutter_realtime_capture"
  private let session = AVAudioSession.sharedInstance()
  private let lock = NSLock()
  private var captureOwners = Set<String>()
  private var captureVoiceProcessing = [String: Bool]()
  private var playbackOwners = Set<String>()
  private var configured = false
  private var interrupted = false
  private var eventSink: FlutterEventSink?
  private weak var lastInvalidatedEngine: AVAudioEngine?

  override init() {
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: session
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleRouteChange(_:)),
      name: AVAudioSession.routeChangeNotification,
      object: session
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleEngineConfigurationChange(_:)),
      name: .AVAudioEngineConfigurationChange,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  func register(messenger: FlutterBinaryMessenger) {
    FlutterMethodChannel(name: methodChannelName, binaryMessenger: messenger)
      .setMethodCallHandler { [weak self] call, result in
        self?.handle(call: call, result: result)
      }
    FlutterEventChannel(name: eventChannelName, binaryMessenger: messenger)
      .setStreamHandler(self)
  }

  private func handle(call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "beginCapture":
      do {
        let arguments = call.arguments as? [String: Any]
        let voiceProcessing = arguments?["voiceProcessing"] as? Bool ?? true
        try beginCapture(
          owner: flutterCaptureOwner,
          voiceProcessing: voiceProcessing
        )
        result(nil)
      } catch {
        result(FlutterError(
          code: "audio_session_unavailable",
          message: error.localizedDescription,
          details: nil
        ))
      }
    case "endCapture":
      endCapture(owner: flutterCaptureOwner)
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  func onListen(
    withArguments arguments: Any?,
    eventSink events: @escaping FlutterEventSink
  ) -> FlutterError? {
    eventSink = events
    emit([
      "type": "route.changed",
      "route": currentRoute(),
    ])
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    eventSink = nil
    return nil
  }

  func beginCapture(owner: String, voiceProcessing: Bool = true) throws {
    try begin(
      owner: owner,
      role: .capture,
      voiceProcessing: voiceProcessing
    )
  }

  func endCapture(owner: String) {
    end(owner: owner, role: .capture)
  }

  func beginPlayback(owner: String) throws {
    try begin(owner: owner, role: .playback)
  }

  func endPlayback(owner: String) {
    end(owner: owner, role: .playback)
  }

  private func begin(
    owner: String,
    role: Role,
    voiceProcessing: Bool = true
  ) throws {
    lock.lock()
    defer { lock.unlock() }
    if contains(owner: owner, role: role) { return }
    insert(owner: owner, role: role)
    if role == .capture {
      captureVoiceProcessing[owner] = voiceProcessing
    }
    do {
      try activateLocked()
    } catch {
      remove(owner: owner, role: role)
      throw error
    }
  }

  private func end(owner: String, role: Role) {
    lock.lock()
    defer { lock.unlock() }
    remove(owner: owner, role: role)
    if captureOwners.isEmpty && playbackOwners.isEmpty {
      deactivateLocked()
    }
  }

  private func contains(owner: String, role: Role) -> Bool {
    role == .capture ? captureOwners.contains(owner) : playbackOwners.contains(owner)
  }

  private func insert(owner: String, role: Role) {
    if role == .capture { captureOwners.insert(owner) }
    else { playbackOwners.insert(owner) }
  }

  private func remove(owner: String, role: Role) {
    if role == .capture {
      captureOwners.remove(owner)
      captureVoiceProcessing.removeValue(forKey: owner)
    }
    else { playbackOwners.remove(owner) }
  }

  private func activateLocked() throws {
    guard !interrupted else { return }
    if !configured {
      let voiceProcessing = captureOwners.isEmpty ||
        captureVoiceProcessing.values.contains(true)
      if voiceProcessing {
        try session.setCategory(
          .playAndRecord,
          mode: .voiceChat,
          options: [.allowBluetooth, .defaultToSpeaker]
        )
      } else {
        try session.setCategory(
          .playAndRecord,
          mode: .measurement,
          options: [.allowBluetooth, .defaultToSpeaker, .mixWithOthers]
        )
      }
      try session.setPreferredIOBufferDuration(0.02)
      configured = true
    }
    try session.setActive(true)
  }

  private func deactivateLocked() {
    guard configured && !interrupted else { return }
    do {
      try session.setActive(false, options: .notifyOthersOnDeactivation)
      configured = false
    } catch {
      emit([
        "type": "session.error",
        "message": error.localizedDescription,
      ])
    }
  }

  @objc private func handleInterruption(_ notification: Notification) {
    guard let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: rawType) else {
      return
    }
    if type == .began {
      withLock {
        interrupted = true
        configured = false
      }
      emit(["type": "interruption.began"])
      return
    }
    let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
    let shouldResume = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
      .contains(.shouldResume)
    var reactivated = false
    withLock {
      interrupted = false
      if shouldResume && (!captureOwners.isEmpty || !playbackOwners.isEmpty) {
        reactivated = (try? activateLocked()) != nil
      }
    }
    emit([
      "type": "interruption.ended",
      "shouldResume": shouldResume && reactivated,
    ])
  }

  @objc private func handleRouteChange(_ notification: Notification) {
    emit([
      "type": "route.changed",
      "route": currentRoute(),
    ])
  }

  @objc private func handleEngineConfigurationChange(_ notification: Notification) {
    guard let engine = notification.object as? AVAudioEngine else { return }
    // The engine notification runs on an internal queue; never tear it down there.
    DispatchQueue.main.async { [weak self, weak engine] in
      guard let self, let engine, !engine.isRunning else { return }
      var shouldRebuild = false
      self.withLock {
        guard self.captureOwners.contains(self.flutterCaptureOwner),
              !self.interrupted, self.lastInvalidatedEngine !== engine else { return }
        self.lastInvalidatedEngine = engine
        shouldRebuild = true
      }
      if shouldRebuild {
        self.eventSink?(["type": "capture.invalidated"])
      }
    }
  }

  private func currentRoute() -> String {
    let types = session.currentRoute.outputs.map(\.portType)
    if types.contains(.bluetoothA2DP) || types.contains(.bluetoothHFP) ||
        types.contains(.bluetoothLE) {
      return "bluetooth"
    }
    if types.contains(.headphones) || types.contains(.headsetMic) {
      return "headphones"
    }
    if types.contains(.builtInSpeaker) { return "speaker" }
    if types.contains(.builtInReceiver) { return "receiver" }
    return "other"
  }

  private func emit(_ event: [String: Any]) {
    DispatchQueue.main.async { [weak self] in
      self?.eventSink?(event)
    }
  }

  private func withLock(_ operation: () -> Void) {
    lock.lock()
    defer { lock.unlock() }
    operation()
  }
}
