import 'dart:convert';

import 'package:http/http.dart' as http;

class ModelProviderChoice {
  const ModelProviderChoice({
    required this.provider,
    required this.model,
    required this.contract,
  });

  factory ModelProviderChoice.fromJson(Map<String, Object?> json) {
    return ModelProviderChoice(
      provider: json['provider'] as String? ?? 'unknown',
      model: json['model'] as String? ?? 'unknown',
      contract: json['contract'] as String? ?? 'unknown',
    );
  }

  final String provider;
  final String model;
  final String contract;
}

class ModelRoutingProfile {
  const ModelRoutingProfile({
    required this.name,
    required this.asr,
    required this.translation,
    required this.tts,
    this.description,
  });

  factory ModelRoutingProfile.fromJson(Map<String, Object?> json) {
    return ModelRoutingProfile(
      name: json['name'] as String? ?? 'unknown',
      description: json['description'] as String?,
      asr: ModelProviderChoice.fromJson(
        json['asr'] as Map<String, Object?>? ?? const <String, Object?>{},
      ),
      translation: ModelProviderChoice.fromJson(
        json['translation'] as Map<String, Object?>? ??
            const <String, Object?>{},
      ),
      tts: ModelProviderChoice.fromJson(
        json['tts'] as Map<String, Object?>? ?? const <String, Object?>{},
      ),
    );
  }

  final String name;
  final String? description;
  final ModelProviderChoice asr;
  final ModelProviderChoice translation;
  final ModelProviderChoice tts;
}

class ModelRoutingSnapshot {
  const ModelRoutingSnapshot({
    required this.status,
    required this.profiles,
    required this.issues,
    this.activeProfile,
    this.sourceFile,
  });

  factory ModelRoutingSnapshot.fromJson(Map<String, Object?> json) {
    final rawProfiles = json['profiles'];
    return ModelRoutingSnapshot(
      status: json['status'] as String? ?? 'not_ready',
      activeProfile: json['activeProfile'] as String?,
      sourceFile: json['sourceFile'] as String?,
      profiles: rawProfiles is List
          ? rawProfiles
              .whereType<Map<String, Object?>>()
              .map(ModelRoutingProfile.fromJson)
              .toList()
          : const <ModelRoutingProfile>[],
      issues: (json['issues'] as List?)
              ?.whereType<String>()
              .toList(growable: false) ??
          const <String>[],
    );
  }

  final String status;
  final String? activeProfile;
  final String? sourceFile;
  final List<ModelRoutingProfile> profiles;
  final List<String> issues;

  ModelRoutingProfile? get activeProfileInfo {
    for (final profile in profiles) {
      if (profile.name == activeProfile) return profile;
    }
    return profiles.isEmpty ? null : profiles.first;
  }
}

class ModelRoutingClient {
  ModelRoutingClient({
    required Uri baseUrl,
    http.Client? client,
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client();

  final Uri _baseUrl;
  final http.Client _client;

  Future<ModelRoutingSnapshot> fetch() async {
    final response = await _client
        .get(_baseUrl.resolve('/models/routing'))
        .timeout(const Duration(seconds: 8));
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return ModelRoutingSnapshot.fromJson(json);
  }

  void close() {
    _client.close();
  }
}

Future<ModelRoutingSnapshot> fetchModelRouting(Uri baseUrl) async {
  final client = ModelRoutingClient(baseUrl: baseUrl);
  try {
    return await client.fetch();
  } finally {
    client.close();
  }
}
