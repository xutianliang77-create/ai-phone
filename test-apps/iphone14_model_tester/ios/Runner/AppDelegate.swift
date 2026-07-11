import AVFoundation
import Flutter
import NaturalLanguage
import Speech
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private let nativeProbe = NativeSpeechProbe()

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "IPhone14ModelTesterNativeProbe"
    ) else {
      return
    }
    let messenger = registrar.messenger()
    let methodChannel = FlutterMethodChannel(
      name: "iphone14_model_tester/native",
      binaryMessenger: messenger
    )
    methodChannel.setMethodCallHandler { [weak self] call, result in
      self?.nativeProbe.handle(call: call, result: result)
    }
    let eventChannel = FlutterEventChannel(
      name: "iphone14_model_tester/events",
      binaryMessenger: messenger
    )
    eventChannel.setStreamHandler(nativeProbe)
  }
}

final class NativeSpeechProbe: NSObject, FlutterStreamHandler {
  private var eventSink: FlutterEventSink?
  private var audioEngine: AVAudioEngine?
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var speechRecognizer: SFSpeechRecognizer?
  private let synthesizer = AVSpeechSynthesizer()
  private let coreMlNemotronProvider = CoreMlNemotronTestProvider()
  private let coreMlQwen3AsrProvider = CoreMlQwen3AsrTestProvider()
  private let remoteAsrProvider = RemoteAsrTestProvider()
  private var activeProviderId = "apple_speech"
  private var activeModelId = "ios_sfspeechrecognizer"

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
    eventSink = events
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    eventSink = nil
    return nil
  }

  func handle(call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "requestPermissions":
      requestPermissions(result: result)
    case "startSpeech":
      startSpeech(arguments: call.arguments, result: result)
    case "stopSpeech":
      if activeProviderId == "coreml_nemotron" {
        Task { [weak self] in
          guard let self else { return }
          let response = await self.coreMlNemotronProvider.stop(emit: self.emit)
          DispatchQueue.main.async {
            result(response)
          }
        }
      } else if activeProviderId == "coreml_qwen3_asr" {
        Task { [weak self] in
          guard let self else { return }
          let response = await self.coreMlQwen3AsrProvider.stop(emit: self.emit)
          DispatchQueue.main.async {
            result(response)
          }
        }
      } else if activeProviderId == "remote_asr" {
        Task { [weak self] in
          guard let self else { return }
          let response = await self.remoteAsrProvider.stop(emit: self.emit)
          DispatchQueue.main.async {
            result(response)
          }
        }
      } else {
        stopSpeech(finishRecognition: true)
        result(["stopped": true])
      }
    case "detectLanguage":
      let text = (call.arguments as? [String: Any])?["text"] as? String ?? ""
      result(["language": detectLanguage(text)])
    case "speak":
      speak(arguments: call.arguments, result: result)
    case "saveResultJsonl":
      saveResultJsonl(arguments: call.arguments, result: result)
    case "loadControlJson":
      loadControlJson(result: result)
    case "status":
      result(status())
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func requestPermissions(result: @escaping FlutterResult) {
    SFSpeechRecognizer.requestAuthorization { speechStatus in
      AVAudioSession.sharedInstance().requestRecordPermission { micGranted in
        DispatchQueue.main.async {
          result([
            "speech": Self.speechStatusName(speechStatus),
            "microphone": micGranted ? "granted" : "denied",
            "canRecord": micGranted,
            "canRecognize": speechStatus == .authorized
          ])
        }
      }
    }
  }

  private func startSpeech(arguments: Any?, result: @escaping FlutterResult) {
    stopSpeech(finishRecognition: false)
    let args = arguments as? [String: Any]
    let providerId = args?["providerId"] as? String ?? "apple_speech"
    let modelId = args?["modelId"] as? String ?? "ios_sfspeechrecognizer"
    activeProviderId = providerId
    activeModelId = modelId

    if providerId == "coreml_nemotron" {
      Task { [weak self] in
        guard let self else { return }
        let response = await self.coreMlNemotronProvider.start(
          arguments: arguments,
          emit: self.emit
        )
        DispatchQueue.main.async {
          result(response)
        }
      }
      return
    }
    if providerId == "coreml_qwen3_asr" {
      Task { [weak self] in
        guard let self else { return }
        let response = await self.coreMlQwen3AsrProvider.start(
          arguments: arguments,
          emit: self.emit
        )
        DispatchQueue.main.async {
          result(response)
        }
      }
      return
    }
    if providerId == "remote_asr" {
      let response = remoteAsrProvider.start(
        arguments: arguments,
        emit: emit
      )
      result(response)
      return
    }
    guard providerId == "apple_speech" else {
      result(FlutterError(
        code: "provider_unsupported",
        message: "Unsupported ASR provider: \(providerId)",
        details: nil
      ))
      return
    }

    let localeId = args?["localeId"] as? String ?? "zh-CN"
    let locale = Locale(identifier: localeId)
    guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
      result(FlutterError(code: "speech_unavailable", message: "SFSpeechRecognizer unavailable for \(localeId)", details: nil))
      return
    }
    speechRecognizer = recognizer

    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if #available(iOS 16.0, *) {
      request.addsPunctuation = true
    }
    recognitionRequest = request
    audioEngine = engine

    do {
      let audioSession = AVAudioSession.sharedInstance()
      try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers])
      try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

      let inputNode = engine.inputNode
      let format = inputNode.outputFormat(forBus: 0)
      inputNode.removeTap(onBus: 0)
      inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        request.append(buffer)
      }

      recognitionTask = recognizer.recognitionTask(with: request) { [weak self] speechResult, error in
        guard let self else { return }
        if let speechResult {
          let text = speechResult.bestTranscription.formattedString
          self.emit([
            "type": "speech",
            "text": text,
            "isFinal": speechResult.isFinal,
            "language": self.detectLanguage(text),
            "providerId": self.activeProviderId,
            "modelId": self.activeModelId,
            "timestampMs": Self.nowMs()
          ])
        }
        if let error {
          self.emit([
            "type": "error",
            "message": error.localizedDescription,
            "providerId": self.activeProviderId,
            "modelId": self.activeModelId,
            "timestampMs": Self.nowMs()
          ])
        }
      }

      engine.prepare()
      try engine.start()
      emit([
        "type": "started",
        "localeId": localeId,
        "providerId": providerId,
        "modelId": modelId,
        "timestampMs": Self.nowMs()
      ])
      result([
        "started": true,
        "localeId": localeId,
        "providerId": providerId,
        "modelId": modelId
      ])
    } catch {
      stopSpeech(finishRecognition: false)
      result(FlutterError(code: "speech_start_failed", message: error.localizedDescription, details: nil))
    }
  }

  private func stopSpeech() {
    stopSpeech(finishRecognition: false)
  }

  private func stopSpeech(finishRecognition: Bool) {
    let wasActive = audioEngine?.isRunning == true || recognitionTask != nil || recognitionRequest != nil
    recognitionRequest?.endAudio()
    if finishRecognition {
      recognitionTask?.finish()
    } else {
      recognitionTask?.cancel()
    }
    recognitionTask = nil
    recognitionRequest = nil
    if let engine = audioEngine {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
    }
    audioEngine = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    if wasActive {
      emit([
        "type": "stopped",
        "providerId": activeProviderId,
        "modelId": activeModelId,
        "timestampMs": Self.nowMs()
      ])
    }
  }

  private func detectLanguage(_ text: String) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "und" }
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(trimmed)
    return recognizer.dominantLanguage?.rawValue ?? "und"
  }

  private func speak(arguments: Any?, result: FlutterResult) {
    let args = arguments as? [String: Any]
    let text = args?["text"] as? String ?? ""
    let language = args?["language"] as? String ?? "zh-CN"
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      result(["spoken": false, "reason": "empty_text"])
      return
    }
    if synthesizer.isSpeaking {
      synthesizer.stopSpeaking(at: .immediate)
    }
    do {
      let audioSession = AVAudioSession.sharedInstance()
      try audioSession.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
      try audioSession.setActive(true)
    } catch {
      emit([
        "type": "error",
        "message": "TTS audio session failed: \(error.localizedDescription)",
        "timestampMs": Self.nowMs()
      ])
      result(FlutterError(code: "tts_audio_session_failed", message: error.localizedDescription, details: nil))
      return
    }
    let utterance = AVSpeechUtterance(string: text)
    let voice = Self.preferredVoice(language: language)
    utterance.voice = voice
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate
    utterance.volume = 1.0
    emit([
      "type": "tts.voices.available",
      "requestedLanguage": language,
      "voices": Self.voiceDiagnostics(language: language),
      "timestampMs": Self.nowMs()
    ])
    emit([
      "type": "tts.voice.selected",
      "requestedLanguage": language,
      "voiceName": voice?.name ?? "",
      "voiceLanguage": voice?.language ?? "",
      "voiceIdentifier": voice?.identifier ?? "",
      "voiceQuality": voice?.quality.rawValue ?? -1,
      "timestampMs": Self.nowMs()
    ])
    emit([
      "type": "tts.requested",
      "text": text,
      "language": language,
      "timestampMs": Self.nowMs()
    ])
    synthesizer.speak(utterance)
    result(["spoken": true, "language": language])
  }

  private func saveResultJsonl(arguments: Any?, result: FlutterResult) {
    let args = arguments as? [String: Any]
    let jsonl = args?["jsonl"] as? String ?? ""
    let runId = Self.safeFileName(args?["runId"] as? String ?? "manual")
    do {
      let documentsUrl = try FileManager.default.url(
        for: .documentDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      let latestUrl = documentsUrl.appendingPathComponent("latest-results.jsonl")
      let runUrl = documentsUrl.appendingPathComponent("\(runId).jsonl")
      try jsonl.write(to: latestUrl, atomically: true, encoding: .utf8)
      try jsonl.write(to: runUrl, atomically: true, encoding: .utf8)
      result([
        "saved": true,
        "latestPath": latestUrl.path,
        "runPath": runUrl.path,
        "bytes": jsonl.utf8.count
      ])
    } catch {
      result(FlutterError(code: "result_save_failed", message: error.localizedDescription, details: nil))
    }
  }

  private func loadControlJson(result: FlutterResult) {
    do {
      let documentsUrl = try FileManager.default.url(
        for: .documentDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      let controlUrl = documentsUrl.appendingPathComponent("control-next.json")
      guard FileManager.default.fileExists(atPath: controlUrl.path) else {
        result(["exists": false])
        return
      }
      let json = try String(contentsOf: controlUrl, encoding: .utf8)
      result(["exists": true, "json": json, "path": controlUrl.path])
    } catch {
      result(FlutterError(code: "control_read_failed", message: error.localizedDescription, details: nil))
    }
  }

  private func status() -> [String: Any] {
    [
      "speechRecognizerAvailable": SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))?.isAvailable ?? false,
      "isRecording": audioEngine?.isRunning ?? false,
      "activeProviderId": activeProviderId,
      "activeModelId": activeModelId,
      "coreMlNemotron": coreMlNemotronProvider.status(),
      "coreMlQwen3Asr": coreMlQwen3AsrProvider.status(modelId: activeModelId),
      "remoteAsr": remoteAsrProvider.status(),
      "timestampMs": Self.nowMs()
    ]
  }

  private func emit(_ payload: [String: Any]) {
    DispatchQueue.main.async { [weak self] in
      self?.eventSink?(payload)
    }
  }

  private static func speechStatusName(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }

  private static func nowMs() -> Int {
    Int(Date().timeIntervalSince1970 * 1000)
  }

  private static func safeFileName(_ value: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
    return String(value.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" })
  }

  private static func preferredVoice(language: String) -> AVSpeechSynthesisVoice? {
    let systemDefault = AVSpeechSynthesisVoice(language: language)
    guard language == "zh-CN" else { return systemDefault }

    let ranked = AVSpeechSynthesisVoice.speechVoices()
      .filter { $0.language == language || $0.language.hasPrefix("\(language)-") }
      .sorted { voiceScore($0) > voiceScore($1) }
    return ranked.first ?? systemDefault
  }

  private static func voiceScore(_ voice: AVSpeechSynthesisVoice) -> Int {
    let key = "\(voice.name) \(voice.identifier)".lowercased()
    let language = voice.language.lowercased()
    var score = voice.quality.rawValue
    if language == "zh-cn" { score += 500 }
    if language.contains("u-sd") { score -= 300 }
    if language.contains("cnsc") { score -= 500 }
    if key.contains("ting") { score += 100 }
    if key.contains("yu-shu") || key.contains("yushu") { score += 90 }
    if key.contains("mandarin") { score += 20 }
    if key.contains("sichuan") || key.contains("四川") { score -= 200 }
    if key.contains("cantonese") || key.contains("yue") { score -= 100 }
    return score
  }

  private static func voiceDiagnostics(language: String) -> [[String: Any]] {
    AVSpeechSynthesisVoice.speechVoices()
      .filter { $0.language.hasPrefix("zh") || $0.language == language }
      .map {
        [
          "name": $0.name,
          "language": $0.language,
          "identifier": $0.identifier,
          "quality": $0.quality.rawValue,
          "score": voiceScore($0)
        ]
      }
  }
}

extension NativeSpeechProbe: AVSpeechSynthesizerDelegate {
  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
    emit([
      "type": "tts.started",
      "text": utterance.speechString,
      "language": utterance.voice?.language ?? "",
      "timestampMs": Self.nowMs()
    ])
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    emit([
      "type": "tts.finished",
      "text": utterance.speechString,
      "language": utterance.voice?.language ?? "",
      "timestampMs": Self.nowMs()
    ])
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    emit([
      "type": "tts.cancelled",
      "text": utterance.speechString,
      "language": utterance.voice?.language ?? "",
      "timestampMs": Self.nowMs()
    ])
  }
}
