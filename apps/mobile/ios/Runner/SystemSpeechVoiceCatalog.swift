import AVFoundation

enum SystemSpeechVoiceCatalog {
  static func descriptor(_ voice: AVSpeechSynthesisVoice) -> SystemSpeechVoiceDescriptor {
    var personal = false, novelty = false
    if #available(iOS 17.0, *) {
      personal = voice.voiceTraits.contains(.isPersonalVoice)
      novelty = voice.voiceTraits.contains(.isNoveltyVoice)
    }
    return SystemSpeechVoiceDescriptor(identifier: voice.identifier, name: voice.name,
      language: voice.language, quality: voice.quality.rawValue, personal: personal, novelty: novelty)
  }
  static func resolve(language: String, identifier: String? = nil) -> AVSpeechSynthesisVoice? {
    guard let normalized = SystemSpeechVoicePolicy.normalized(language) else { return nil }
    if let identifier {
      guard let voice = AVSpeechSynthesisVoice(identifier: identifier),
            SystemSpeechVoicePolicy.eligible(descriptor(voice), language: normalized) else { return nil }
      return voice // A stale/mismatched pinned voice never falls back.
    }
    let preferred = AVSpeechSynthesisVoice(language: normalized)?.identifier
    let candidates = SystemSpeechVoicePolicy.candidates(AVSpeechSynthesisVoice.speechVoices().map(descriptor),
      language: normalized, preferredIdentifier: preferred)
    for candidate in candidates {
      if let voice = resolve(language: normalized, identifier: candidate.identifier) { return voice }
    }
    return nil
  }
  static func payload(language: String, voice: AVSpeechSynthesisVoice?) -> [String: Any] {
    var data: [String: Any] = ["protocolVersion": 1, "provider": "ios_system_tts",
      "language": language, "canSpeak": voice != nil, "availableOnDevice": voice != nil,
      "offlineVerified": false, "qualityQualified": false,
      "reason": voice == nil ? "speech_voice_unavailable" : "voice_available_on_device"]
    if let voice {
      data["voiceIdentifier"] = voice.identifier
      data["voiceName"] = voice.name
      data["voiceLanguage"] = voice.language
      data["voiceQuality"] = voice.quality.rawValue
      data["voicePolicy"] = "apple_system_standard_v1"
    }
    return data
  }
}
