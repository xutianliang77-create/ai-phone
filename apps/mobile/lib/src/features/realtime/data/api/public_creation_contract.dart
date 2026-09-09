import 'dart:convert';
import 'public_creation_request_store.dart';
import 'realtime_session.dart';

const publicCreationScopeNotice =
    '公有在线当前按固定语种运行，朗读使用服务端配置声音；自动语种/反向、说话人和术语包尚未验收，未自动启用。';
bool _key(Object? value) =>
    value is String &&
    value.isNotEmpty &&
    value.length <= 240 &&
    value.trim() == value &&
    !RegExp(r'[\x00-\x1f\x7f]').hasMatch(value);
bool _plan(Object? value, bool voice) {
  if (value is! Map || value.length != 3) return false;
  for (final name in ['asr', 'translation', 'tts']) {
    final c = value[name];
    if (c is! Map) return false;
    if (name == 'tts' && !voice) {
      if (c.length != 1 || c['execution'] != 'disabled') return false;
    } else if (c.length != 3 ||
        c['execution'] != 'public' ||
        c['reason'] != 'online_selected' ||
        !_key(c['scopeKey'])) {
      return false;
    }
  }
  return true;
}

Uri _endpoint(Object? value) {
  if (value is! String) throw const FormatException('Invalid public endpoint');
  final uri = Uri.parse(value);
  if (uri.scheme != 'wss' ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty ||
      uri.hasQuery ||
      uri.hasFragment) {
    throw const FormatException('Invalid public endpoint');
  }
  return uri;
}

Map<String, Object?> publicCreationBody(Map<String, Object?> offer,
    {required String deploymentId,
    required String ownerId,
    required String mode,
    required String source,
    required String target,
    required bool voice}) {
  if (offer['contractVersion'] != 1 ||
      offer['deploymentId'] != deploymentId ||
      offer['ownerId'] != ownerId ||
      offer['status'] != 'configured_not_verified' ||
      offer['voiceOutput'] != voice ||
      !_key(offer['modelPolicyRevision']) ||
      !_plan(offer['executionPlan'], voice) ||
      offer['configurationRevision'] is! int ||
      (offer['configurationRevision'] as int) < 1 ||
      !const [16000, 24000].contains(offer['captureSampleRate']) ||
      voice && !_key(offer['voicePresetId'])) {
    throw const FormatException('Invalid public creation context');
  }
  _endpoint(offer['endpoint']);
  return {
    'mode': mode,
    'sourceLanguage': source,
    'targetLanguage': target,
    'voiceOutput': voice,
    'speakerAttribution': {'mode': 'off'},
    if (voice) 'voice': {'mode': 'preset', 'presetId': offer['voicePresetId']},
    'processing': {
      'contractVersion': 1,
      'processingMode': 'online',
      'modelPolicyRevision': offer['modelPolicyRevision'],
      'executionPlan': offer['executionPlan'],
      'languagePolicy': {
        'source': source,
        'target': target,
        'autoReverse': false,
        'revision': 1
      },
      'syncRequested': false
    }
  };
}

RealtimeSession publicCreationResponse(
    Map<String, Object?> json, Map<String, Object?> record,
    {required String ownerId, required String deploymentId, DateTime? now}) {
  now ??= DateTime.now();
  final body = record['body'] as Map<String, Object?>,
      expected = body['processing'],
      p = json['processing'];
  if (expected is! Map ||
      p is! Map ||
      p['contractVersion'] != 1 ||
      p['processingMode'] != 'online' ||
      p['modelPolicyRevision'] != expected['modelPolicyRevision'] ||
      publicCreationCanonical(p['executionPlan']) !=
          publicCreationCanonical(expected['executionPlan']) ||
      publicCreationCanonical(p['languagePolicy']) !=
          publicCreationCanonical(expected['languagePolicy']) ||
      publicCreationCanonical(p['syncPermission']) != '{"allowed":false}' ||
      !_key(p['publicGrantRef']) ||
      json['ownerId'] != ownerId ||
      json['deploymentId'] != deploymentId ||
      !_key(json['sessionId']) ||
      json['endpoint'] != record['endpoint'] ||
      json['captureSampleRate'] is! int ||
      !const [16000, 24000].contains(json['captureSampleRate']) ||
      json['maxDurationSeconds'] is! int ||
      (json['maxDurationSeconds'] as int) < 1 ||
      (json['maxDurationSeconds'] as int) > 14400) {
    throw const FormatException('Public creation response binding mismatch');
  }
  _endpoint(json['endpoint']);
  final expiry = DateTime.tryParse(json['expiresAt'] as String? ?? '');
  if (expiry == null || !expiry.isAfter(now)) {
    throw const FormatException('Public creation response expired');
  }
  final token = json['realtimeToken'];
  if (token is! String ||
      token.length > 4096 ||
      !RegExp(r'^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$').hasMatch(token)) {
    throw const FormatException('Invalid public token');
  }
  // Consistency only: the phone has no signing secret; Gateway still verifies HMAC.
  final claims = jsonDecode(utf8
      .decode(base64Url.decode(base64Url.normalize(token.split('.').first))));
  final runtime = claims is Map ? claims['publicRuntime'] : null;
  if (claims is! Map ||
      runtime is! Map ||
      runtime.length != 7 ||
      claims['sessionId'] != json['sessionId'] ||
      claims['userId'] != ownerId ||
      claims['mode'] != body['mode'] ||
      claims['sourceLanguage'] != body['sourceLanguage'] ||
      claims['targetLanguage'] != body['targetLanguage'] ||
      claims['voiceOutput'] != body['voiceOutput'] ||
      publicCreationCanonical(claims['voice']) !=
          publicCreationCanonical(body['voice']) ||
      publicCreationCanonical(claims['processing']) !=
          publicCreationCanonical(p) ||
      claims['expiresAt'] != expiry.millisecondsSinceEpoch ~/ 1000 ||
      claims['maxDurationSeconds'] != json['maxDurationSeconds'] ||
      runtime['deploymentId'] != deploymentId ||
      runtime['sampleRate'] != json['captureSampleRate'] ||
      ![runtime['leaseId'], runtime['captureId'], runtime['languagePolicyKey']]
          .every(_key) ||
      runtime['configurationRevision'] is! int ||
      runtime['configurationHash'] is! String ||
      !RegExp(r'^[a-f0-9]{64}$')
          .hasMatch(runtime['configurationHash'] as String)) {
    throw const FormatException('Public token and response differ');
  }
  return RealtimeSession.fromJson(
      {...json, 'publicScopeNotice': publicCreationScopeNotice});
}
