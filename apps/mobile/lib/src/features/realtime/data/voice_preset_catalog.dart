import 'dart:convert';

import 'package:http/http.dart' as http;

const defaultRealtimeVoicePresetId = 'zh_female_natural';

class VoicePreset {
  const VoicePreset({
    required this.id,
    required this.zhLabel,
    required this.enLabel,
    required this.gender,
    required this.tone,
    required this.scenario,
    required this.accent,
    required this.languages,
  });

  factory VoicePreset.fromJson(Map<String, Object?> json) {
    final labels = json['labels'] as Map<String, Object?>? ?? const {};
    return VoicePreset(
      id: json['id'] as String? ?? '',
      zhLabel: labels['zh'] as String? ?? '',
      enLabel: labels['en'] as String? ?? '',
      gender: json['gender'] as String? ?? 'neutral',
      tone: json['tone'] as String? ?? 'natural',
      scenario: json['scenario'] as String? ?? 'conversation',
      accent: json['accent'] as String? ?? 'bilingual',
      languages: (json['languages'] as List<Object?>? ?? const [])
          .whereType<String>()
          .toList(growable: false),
    );
  }

  final String id;
  final String zhLabel;
  final String enLabel;
  final String gender;
  final String tone;
  final String scenario;
  final String accent;
  final List<String> languages;

  String label({required bool chinese}) => chinese ? zhLabel : enLabel;
}

class VoicePresetCatalog {
  const VoicePresetCatalog({
    required this.version,
    required this.defaultPresetId,
    required this.presets,
  });

  const VoicePresetCatalog.empty()
      : version = '',
        defaultPresetId = defaultRealtimeVoicePresetId,
        presets = const [];

  factory VoicePresetCatalog.fromJson(Map<String, Object?> json) {
    final presets = (json['presets'] as List<Object?>? ?? const [])
        .whereType<Map<String, Object?>>()
        .map(VoicePreset.fromJson)
        .where((preset) => preset.id.isNotEmpty)
        .toList(growable: false);
    return VoicePresetCatalog(
      version: json['version'] as String? ?? '',
      defaultPresetId: json['defaultPresetId'] as String? ??
          (presets.isEmpty ? defaultRealtimeVoicePresetId : presets.first.id),
      presets: presets,
    );
  }

  final String version;
  final String defaultPresetId;
  final List<VoicePreset> presets;

  VoicePreset? find(String id) {
    for (final preset in presets) {
      if (preset.id == id) return preset;
    }
    return null;
  }
}

class VoicePresetClient {
  VoicePresetClient({required Uri baseUrl, http.Client? client})
      : _baseUrl = baseUrl,
        _client = client ?? http.Client();

  final Uri _baseUrl;
  final http.Client _client;

  Future<VoicePresetCatalog> load() async {
    final response = await _client
        .get(_baseUrl.resolve('/voice-presets'))
        .timeout(const Duration(seconds: 8));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Voice presets unavailable');
    }
    return VoicePresetCatalog.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
    );
  }

  void close() => _client.close();
}
