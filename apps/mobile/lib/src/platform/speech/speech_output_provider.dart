import 'package:flutter/services.dart';
import '../../features/account/data/account_session_store.dart'
    show onDeviceExecution;
import 'system_voice_preferences.dart';

class SpeechOutputResult {
  const SpeechOutputResult({required this.provider, required this.language});

  final String provider;
  final String language;
}

abstract class SpeechOutputProvider {
  Future<SpeechOutputResult> speak({
    required String text,
    required String language,
  });

  Future<void> stop();
}

abstract interface class SpeechOutputPreparation {
  Future<void> prepareVoice(String language);
}

class SystemSpeechOutputProvider
    implements SpeechOutputProvider, SpeechOutputPreparation {
  SystemSpeechOutputProvider({
    MethodChannel? channel,
    SystemVoicePreferences? preferences,
    bool? useVoicePreferences,
  }) : _channel = channel ?? const MethodChannel(_channelName),
       _preferences = preferences ?? SystemVoicePreferences.shared,
       _useVoicePreferences = useVoicePreferences ?? onDeviceExecution;

  static const _channelName = 'translation_mobile/speech_output';

  final MethodChannel _channel;
  final SystemVoicePreferences _preferences;
  final bool _useVoicePreferences;

  Future<List<SystemVoice>> voices(String language) async {
    final values =
        await _channel.invokeListMethod<Object?>('voices', {
          'language': language,
        }) ??
        const [];
    return values
        .whereType<Map>()
        .map((v) => SystemVoice.fromMap(v))
        .toList(growable: false);
  }

  Future<Map<String, Object?>> _arguments(String language) async {
    final identifier = _useVoicePreferences
        ? await _preferences.selected(language)
        : null;
    return {
      'language': language,
      if (identifier != null) 'voiceIdentifier': identifier,
    };
  }

  @override
  Future<void> prepareVoice(String language) async {
    final p = await _channel.invokeMapMethod<String, Object?>(
      'prepare',
      await _arguments(language),
    );
    if (p?['canSpeak'] != true || p?['availableOnDevice'] != true) {
      throw StateError('本机系统声音未就绪，请先准备语言资源。');
    }
  }

  @override
  Future<SpeechOutputResult> speak({
    required String text,
    required String language,
  }) async {
    final result = await _channel.invokeMapMethod<String, Object?>(
      'speak',
      <String, Object?>{'text': text, ...await _arguments(language)},
    );
    return SpeechOutputResult(
      provider: result?['provider'] as String? ?? 'system_tts',
      language: result?['language'] as String? ?? language,
    );
  }

  @override
  Future<void> stop() async {
    await _channel.invokeMethod<void>('stop');
  }
}

class SystemVoice {
  const SystemVoice({
    required this.identifier,
    required this.name,
    required this.language,
    required this.quality,
  });
  factory SystemVoice.fromMap(Map value) => SystemVoice(
    identifier: value['identifier'] as String,
    name: value['name'] as String,
    language: value['language'] as String,
    quality: value['quality'] as int,
  );
  final String identifier;
  final String name;
  final String language;
  final int quality;
}
