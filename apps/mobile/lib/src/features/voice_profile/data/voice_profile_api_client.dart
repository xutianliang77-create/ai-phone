import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../account/data/account_auth_headers.dart';
import '../../account/data/account_session_store.dart';

abstract class VoiceProfileClient {
  Future<VoiceProfile?> fetchMyProfile();
  Future<VoiceProfile> createMyProfile({
    required String consentVersion,
    required DateTime consentAcceptedAt,
  });
  Future<VoiceProfile> uploadReferenceAudio({
    required String audioBase64,
    required int durationMs,
    required String referenceTranscript,
    String mimeType = 'audio/wav',
  });
  Future<VoiceProfileTestAudio> testMyVoice({
    String language = 'zh',
    String? text,
    String variant = 'clone',
  });
  Future<VoiceProfile> deleteMyProfile();
}

class VoiceProfile {
  const VoiceProfile({
    required this.id,
    required this.displayName,
    required this.status,
    required this.voiceMode,
    required this.createdAt,
    required this.updatedAt,
    this.referenceAudioId,
    this.referenceQuality,
  });

  final String id;
  final String displayName;
  final String status;
  final String voiceMode;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? referenceAudioId;
  final VoiceReferenceQuality? referenceQuality;

  bool get ready => status == 'ready';

  factory VoiceProfile.fromJson(Map<String, Object?> json) {
    return VoiceProfile(
      id: json['id'] as String,
      displayName: json['displayName'] as String,
      status: json['status'] as String,
      voiceMode: json['voiceMode'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      referenceAudioId: json['referenceAudioId'] as String?,
      referenceQuality: json['referenceQuality'] is Map
          ? VoiceReferenceQuality.fromJson(
              Map<String, Object?>.from(json['referenceQuality'] as Map),
            )
          : null,
    );
  }
}

class VoiceReferenceQuality {
  const VoiceReferenceQuality({
    required this.accepted,
    required this.durationMs,
    required this.rmsDbfs,
    required this.clippingRatio,
    required this.silenceRatio,
  });

  final bool accepted;
  final int durationMs;
  final double rmsDbfs;
  final double clippingRatio;
  final double silenceRatio;

  factory VoiceReferenceQuality.fromJson(Map<String, Object?> json) {
    return VoiceReferenceQuality(
      accepted: json['accepted'] == true,
      durationMs: (json['durationMs'] as num).toInt(),
      rmsDbfs: (json['rmsDbfs'] as num).toDouble(),
      clippingRatio: (json['clippingRatio'] as num).toDouble(),
      silenceRatio: (json['silenceRatio'] as num).toDouble(),
    );
  }
}

class VoiceProfileTestAudio {
  const VoiceProfileTestAudio({
    required this.text,
    required this.language,
    required this.provider,
    required this.model,
    required this.voiceMode,
    required this.audio,
    this.voiceProfileId,
  });

  final String text;
  final String language;
  final String provider;
  final String model;
  final String voiceMode;
  final String? voiceProfileId;
  final VoiceProfileAudioPayload audio;

  factory VoiceProfileTestAudio.fromJson(Map<String, Object?> json) {
    return VoiceProfileTestAudio(
      text: json['text'] as String,
      language: json['language'] as String,
      provider: json['provider'] as String,
      model: json['model'] as String,
      voiceMode: json['voiceMode'] as String,
      voiceProfileId: json['voiceProfileId'] as String?,
      audio: VoiceProfileAudioPayload.fromJson(
        Map<String, Object?>.from(json['audio'] as Map),
      ),
    );
  }
}

class VoiceProfileAudioPayload {
  const VoiceProfileAudioPayload({
    required this.sampleRate,
    required this.data,
  });

  final int sampleRate;
  final String data;

  factory VoiceProfileAudioPayload.fromJson(Map<String, Object?> json) {
    return VoiceProfileAudioPayload(
      sampleRate: (json['sampleRate'] as num).toInt(),
      data: json['data'] as String,
    );
  }
}

class VoiceProfileApiClient implements VoiceProfileClient {
  VoiceProfileApiClient({
    required Uri baseUrl,
    http.Client? client,
    AccountSessionStore? accountSessionStore,
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client(),
        _accountSessionStore = accountSessionStore ?? accountStoreForDeployment(baseUrl);

  final Uri _baseUrl;
  final http.Client _client;
  final AccountSessionStore _accountSessionStore;

  @override
  Future<VoiceProfile?> fetchMyProfile() async {
    final json = await _getJson('/voice-profiles/me');
    return _profileFromJson(json['profile']);
  }

  @override
  Future<VoiceProfile> createMyProfile({
    required String consentVersion,
    required DateTime consentAcceptedAt,
  }) async {
    final json = await _postJson('/voice-profiles/me', <String, Object?>{
      'displayName': '我的声音',
      'consentAccepted': true,
      'consentVersion': consentVersion,
      'consentAcceptedAt': consentAcceptedAt.toUtc().toIso8601String(),
    });
    return _profileFromJson(json['profile'])!;
  }

  @override
  Future<VoiceProfile> uploadReferenceAudio({
    required String audioBase64,
    required int durationMs,
    required String referenceTranscript,
    String mimeType = 'audio/wav',
  }) async {
    final json = await _postJson(
      '/voice-profiles/me/reference-audio',
      <String, Object?>{
        'mimeType': mimeType,
        'durationMs': durationMs,
        'audioBase64': audioBase64,
        'referenceTranscript': referenceTranscript,
      },
    );
    return _profileFromJson(json['profile'])!;
  }

  @override
  Future<VoiceProfileTestAudio> testMyVoice({
    String language = 'zh',
    String? text,
    String variant = 'clone',
  }) async {
    final json = await _postJson(
      '/voice-profiles/me/test-audio',
      <String, Object?>{
        'language': language,
        'variant': variant,
        if (text != null) 'text': text,
      },
    );
    return VoiceProfileTestAudio.fromJson(json);
  }

  @override
  Future<VoiceProfile> deleteMyProfile() async {
    final response = await _client.delete(
      _baseUrl.resolve('/voice-profiles/me'),
      headers: await _authHeaders(),
    );
    return _profileFromJson(_decode(response)['profile'])!;
  }

  void close() => _client.close();

  Future<Map<String, Object?>> _getJson(String path) async {
    final response = await _client.get(
      _baseUrl.resolve(path),
      headers: await _authHeaders(),
    );
    return _decode(response);
  }

  Future<Map<String, Object?>> _postJson(
    String path,
    Map<String, Object?> body,
  ) async {
    final response = await _client.post(
      _baseUrl.resolve(path),
      headers: await _authHeaders(json: true),
      body: jsonEncode(body),
    );
    return _decode(response);
  }

  Map<String, Object?> _decode(http.Response response) {
    final json = jsonDecode(response.body) as Map<String, Object?>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw VoiceProfileApiException(
        'Voice Profile API failed: ${response.statusCode}',
        json,
      );
    }
    return json;
  }

  VoiceProfile? _profileFromJson(Object? value) {
    if (value == null) return null;
    return VoiceProfile.fromJson(Map<String, Object?>.from(value as Map));
  }

  Future<Map<String, String>> _authHeaders({bool json = false}) {
    return accountAuthorizationHeaders(
      _accountSessionStore,
      baseHeaders: json ? const {'content-type': 'application/json'} : const {},
    );
  }
}

class VoiceProfileApiException implements Exception {
  const VoiceProfileApiException(this.message, this.body);

  final String message;
  final Map<String, Object?> body;

  @override
  String toString() => message;
}
