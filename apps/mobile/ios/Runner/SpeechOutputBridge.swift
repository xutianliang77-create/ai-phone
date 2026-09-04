import AVFoundation
import Flutter
import Foundation

final class SpeechOutputBridge: NSObject, AVSpeechSynthesizerDelegate {
    private let audioSessionCoordinator: AudioSessionCoordinator
    private let audioSessionOwner = "system_tts"
    private let methodChannelName = "translation_mobile/speech_output"
    private let synthesizer = AVSpeechSynthesizer()
    private var pendingResult: FlutterResult?
    private var pendingResponse: [String: String]?
    private var pendingUtteranceId: UUID?
    private var pendingUtterance: AVSpeechUtterance?
    private var watchdogTimer: Timer?

    init(audioSessionCoordinator: AudioSessionCoordinator) {
        self.audioSessionCoordinator = audioSessionCoordinator
        super.init()
        synthesizer.delegate = self
        synthesizer.usesApplicationAudioSession = true
    }

    func register(messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(
            name: methodChannelName,
            binaryMessenger: messenger
        )
        channel.setMethodCallHandler { [weak self] call, result in
            self?.handle(call: call, result: result)
        }
    }

    private func handle(call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "speak":
            speak(call: call, result: result)
        case "stop":
            finishPendingSpeech(error: speechError("speech_cancelled", "Speech playback was cancelled."))
            synthesizer.stopSpeaking(at: .immediate)
            result(nil)
        default:
            result(FlutterMethodNotImplemented)
        }
    }

    private func speak(call: FlutterMethodCall, result: @escaping FlutterResult) {
        guard let text = stringArgument("text", from: call)?.trimmingCharacters(
            in: .whitespacesAndNewlines
        ), !text.isEmpty else {
            result(FlutterError(
                code: "nothing_to_speak",
                message: "No text was provided for speech output.",
                details: nil
            ))
            return
        }

        finishPendingSpeech(error: speechError("speech_cancelled", "Speech playback was replaced."))
        let language = (stringArgument("language", from: call) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "_", with: "-")
        guard !language.isEmpty, let voice = AVSpeechSynthesisVoice(language: language) else {
            result(speechError("speech_language_unavailable", "No system voice is available for \(language)."))
            return
        }
        do {
            try audioSessionCoordinator.beginPlayback(owner: audioSessionOwner)
        } catch {
            result(FlutterError(
                code: "audio_session_unavailable",
                message: error.localizedDescription,
                details: nil
            ))
            return
        }
        if synthesizer.isSpeaking || synthesizer.isPaused {
            synthesizer.stopSpeaking(at: .immediate)
        }
        let utterance = AVSpeechUtterance(string: text)
        let utteranceId = UUID()
        utterance.voice = voice
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        pendingUtteranceId = utteranceId
        pendingUtterance = utterance
        pendingResult = result
        pendingResponse = [
            "provider": "ios_system_tts",
            "language": language,
            "voiceLanguage": voice.language,
        ]
        scheduleWatchdog(for: utteranceId, text: text)
        synthesizer.speak(utterance)
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didFinish utterance: AVSpeechUtterance
    ) {
        guard pendingUtterance === utterance else { return }
        finishPendingSpeech()
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didCancel utterance: AVSpeechUtterance
    ) {
        guard pendingUtterance === utterance else { return }
        finishPendingSpeech(error: speechError("speech_cancelled", "Speech playback was cancelled."))
    }

    private func stringArgument(_ name: String, from call: FlutterMethodCall) -> String? {
        let arguments = call.arguments as? [String: Any]
        return arguments?[name] as? String
    }

    private func scheduleWatchdog(for utteranceId: UUID, text: String) {
        watchdogTimer?.invalidate()
        let estimatedSeconds = min(max(10.0, 5.0 + Double(text.count) * 0.18), 60.0)
        watchdogTimer = Timer.scheduledTimer(
            withTimeInterval: estimatedSeconds,
            repeats: false
        ) { [weak self] _ in
            guard let self = self, self.pendingUtteranceId == utteranceId else {
                return
            }
            self.finishPendingSpeech(error: speechError("speech_timeout", "Speech playback timed out."))
            self.synthesizer.stopSpeaking(at: .immediate)
        }
    }

    private func finishPendingSpeech(error: FlutterError? = nil) {
        watchdogTimer?.invalidate()
        watchdogTimer = nil
        pendingUtteranceId = nil
        pendingUtterance = nil
        audioSessionCoordinator.endPlayback(owner: audioSessionOwner)
        guard let result = pendingResult else { return }
        let response = pendingResponse
        pendingResult = nil
        pendingResponse = nil
        if let error { result(error) }
        else { result(response) }
    }
}

final class PcmAudioOutputBridge: NSObject, AVAudioPlayerDelegate {
    private let audioSessionCoordinator: AudioSessionCoordinator
    private let audioSessionOwner = "server_pcm_tts"
    private let methodChannelName = "translation_mobile/audio_output"
    private var player: AVAudioPlayer?
    private var pendingResult: FlutterResult?
    private var pendingResponse: [String: Any]?
    private var watchdogTimer: Timer?

    init(audioSessionCoordinator: AudioSessionCoordinator) {
        self.audioSessionCoordinator = audioSessionCoordinator
        super.init()
    }

    func register(messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(
            name: methodChannelName,
            binaryMessenger: messenger
        )
        channel.setMethodCallHandler { [weak self] call, result in
            self?.handle(call: call, result: result)
        }
    }

    private func handle(call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "playPcm":
            playPcm(call: call, result: result)
        case "stop":
            stop()
            result(nil)
        default:
            result(FlutterMethodNotImplemented)
        }
    }

    private func playPcm(call: FlutterMethodCall, result: @escaping FlutterResult) {
        guard let arguments = call.arguments as? [String: Any],
              let format = arguments["format"] as? String,
              format == "pcm16",
              let sampleRate = arguments["sampleRate"] as? Int,
              sampleRate == 16000 || sampleRate == 24000,
              let encoded = arguments["data"] as? String,
              let pcm = Data(base64Encoded: encoded),
              !pcm.isEmpty, pcm.count.isMultiple(of: 2) else {
            result(FlutterError(
                code: "invalid_pcm_audio",
                message: "PCM16 audio output payload is invalid.",
                details: nil
            ))
            return
        }

        stop()
        do {
            try audioSessionCoordinator.beginPlayback(owner: audioSessionOwner)
            let player = try AVAudioPlayer(data: wavData(fromPcm16: pcm, sampleRate: sampleRate))
            player.delegate = self
            self.player = player
            pendingResult = result
            pendingResponse = [
                "provider": "server_pcm_tts",
                "sampleRate": sampleRate,
            ]
            guard player.prepareToPlay() else {
                stop(error: speechError("pcm_audio_prepare_failed", "PCM audio could not be prepared."))
                return
            }
            guard player.play() else {
                stop(error: speechError("pcm_audio_start_failed", "PCM audio playback could not start."))
                return
            }
            scheduleWatchdog(duration: player.duration)
        } catch {
            audioSessionCoordinator.endPlayback(owner: audioSessionOwner)
            pendingResult = nil
            pendingResponse = nil
            result(FlutterError(
                code: "pcm_audio_playback_failed",
                message: error.localizedDescription,
                details: nil
            ))
        }
    }

    private func stop(error: FlutterError? = nil) {
        watchdogTimer?.invalidate()
        watchdogTimer = nil
        player?.stop()
        player = nil
        finishPending(error: error ?? speechError("pcm_audio_cancelled", "PCM playback was cancelled."))
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard self.player === player else { return }
        self.player = nil
        finishPending(error: flag ? nil : speechError("pcm_audio_playback_failed", "PCM playback did not finish successfully."))
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        guard self.player === player else { return }
        self.player = nil
        finishPending(error: speechError("pcm_audio_decode_failed", error?.localizedDescription ?? "PCM audio decoding failed."))
    }

    private func scheduleWatchdog(duration: TimeInterval) {
        watchdogTimer?.invalidate()
        let timeout = min(max(duration + 2.0, 5.0), 60.0)
        watchdogTimer = Timer.scheduledTimer(
            withTimeInterval: timeout,
            repeats: false
        ) { [weak self] _ in
            self?.stop(error: speechError("pcm_audio_timeout", "PCM playback timed out."))
        }
    }

    private func finishPending(error: FlutterError? = nil) {
        watchdogTimer?.invalidate()
        watchdogTimer = nil
        audioSessionCoordinator.endPlayback(owner: audioSessionOwner)
        guard let result = pendingResult else { return }
        let response = pendingResponse
        pendingResult = nil
        pendingResponse = nil
        if let error { result(error) }
        else { result(response) }
    }

    private func wavData(fromPcm16 pcm: Data, sampleRate: Int) -> Data {
        var data = Data()
        data.append("RIFF".data(using: .ascii)!)
        data.append(littleEndianUInt32(UInt32(36 + pcm.count)))
        data.append("WAVEfmt ".data(using: .ascii)!)
        data.append(littleEndianUInt32(16))
        data.append(littleEndianUInt16(1))
        data.append(littleEndianUInt16(1))
        data.append(littleEndianUInt32(UInt32(sampleRate)))
        data.append(littleEndianUInt32(UInt32(sampleRate * 2)))
        data.append(littleEndianUInt16(2))
        data.append(littleEndianUInt16(16))
        data.append("data".data(using: .ascii)!)
        data.append(littleEndianUInt32(UInt32(pcm.count)))
        data.append(pcm)
        return data
    }

    private func littleEndianUInt16(_ value: UInt16) -> Data {
        var littleEndian = value.littleEndian
        return Data(bytes: &littleEndian, count: MemoryLayout<UInt16>.size)
    }

    private func littleEndianUInt32(_ value: UInt32) -> Data {
        var littleEndian = value.littleEndian
        return Data(bytes: &littleEndian, count: MemoryLayout<UInt32>.size)
    }
}

private func speechError(_ code: String, _ message: String) -> FlutterError {
    FlutterError(code: code, message: message, details: nil)
}
