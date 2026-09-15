import 'dart:convert';
import 'public_creation_request_store.dart';
import 'realtime_session.dart';

const publicCreationScopeNotice =
    '公有在线会在开始前按当前服务端资格核对语种、自动识别/反向与朗读声音；个人声音、说话人和术语包仍未在公有链路启用。丢失连接时安全结束并保留已确认记录，不自动重连或重放音频。';
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

/// The phone preserves the user's selected automatic pair. It sends neither a
/// guessed source language nor a supplier/model selection; the server decides
/// whether this exact pair is qualified for the current public configuration.
(String, String)? _automaticPair(
    {required String source,
    required String target,
    required (String, String)? automaticLanguagePair}) {
  if (source != 'auto' || automaticLanguagePair == null) {
    return null;
  }
  final pair = automaticLanguagePair;
  if (!_key(pair.$1) ||
      !_key(pair.$2) ||
      pair.$1 == pair.$2 ||
      ![pair.$1, pair.$2].contains(target)) {
    return null;
  }
  return pair;
}

String? publicCreationCapabilityBlocker(Map<String, Object?> offer,
    {required String source,
    required String target,
    required bool autoReverse,
    required (String, String)? automaticLanguagePair}) {
  final raw = offer['capability'];
  // Older private/test servers do not project public capability. The public
  // deployment always supplies it; this fallback preserves old protocol tests.
  if (raw == null) return null;
  if (raw is! Map ||
      raw.length != 4 ||
      raw['automaticLanguage'] is! bool ||
      raw['automaticReverse'] is! bool ||
      raw['qualifiedLanguagePairs'] is! List ||
      raw['status'] is! String) {
    throw const FormatException('Invalid public creation capability');
  }
  final pairs = <(String, String)>[];
  for (final rawPair in raw['qualifiedLanguagePairs'] as List) {
    if (rawPair is! Map ||
        rawPair.length != 2 ||
        rawPair['source'] is! String ||
        rawPair['target'] is! String) {
      throw const FormatException('Invalid public qualified language pair');
    }
    final pair = (rawPair['source'] as String, rawPair['target'] as String);
    if (!_key(pair.$1) ||
        !_key(pair.$2) ||
        pair.$1 == 'auto' ||
        pair.$1 == pair.$2 ||
        pairs.contains(pair)) {
      throw const FormatException('Invalid public qualified language pair');
    }
    pairs.add(pair);
  }
  if (raw['status'] == 'not_qualified') {
    return '当前在线组件组合尚未资格化，请调整朗读或等待服务端配置完成';
  }
  if (raw['status'] != 'qualified') {
    throw const FormatException('Invalid public creation capability status');
  }
  if (source == 'auto' && raw['automaticLanguage'] != true) {
    return '公有自动语种尚未验收，请选择服务端已资格化的固定语言对';
  }
  if (autoReverse && raw['automaticReverse'] != true) {
    return '公有自动反向尚未资格化，请关闭自动反向或等待服务端配置完成';
  }
  final automaticPair = _automaticPair(
      source: source,
      target: target,
      automaticLanguagePair: automaticLanguagePair);
  if (source == 'auto' || autoReverse) {
    if (source != 'auto' || automaticPair == null) {
      return '公有自动语言需要保留一个有效语言对，请重新选择源语言和目标语言';
    }
    final (first, second) = automaticPair;
    final bothDirections =
        pairs.contains((first, second)) && pairs.contains((second, first));
    if (autoReverse && !bothDirections) {
      return '当前在线未资格化该自动反向语言对，请选择服务端已资格化的固定语言对';
    }
    if (!autoReverse && !pairs.contains(automaticPair)) {
      return '当前在线未资格化该自动识别语言对，请选择服务端已资格化的固定语言对';
    }
    return null;
  }
  if (!pairs.contains((source, target))) {
    final labels = pairs.map((pair) => '${pair.$1}→${pair.$2}').join('、');
    return '当前在线未资格化该语言对；可用固定语言对：$labels';
  }
  return null;
}

Map<String, Object?> publicCreationBody(Map<String, Object?> offer,
    {required String deploymentId,
    required String ownerId,
    required String mode,
    required String source,
    required String target,
    required bool autoReverse,
    required (String, String)? automaticLanguagePair,
    required bool voice}) {
  final blocker = publicCreationCapabilityBlocker(offer,
      source: source,
      target: target,
      autoReverse: autoReverse,
      automaticLanguagePair: automaticLanguagePair);
  if (blocker != null) throw FormatException(blocker);
  final automaticPair = _automaticPair(
      source: source,
      target: target,
      automaticLanguagePair: automaticLanguagePair);
  if (offer['contractVersion'] != 1 ||
      offer['deploymentId'] != deploymentId ||
      offer['ownerId'] != ownerId ||
      !const ['configured_not_verified', 'qualified']
          .contains(offer['status']) ||
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
    if (autoReverse) 'autoReverseTargetLanguage': true,
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
        'autoReverse': autoReverse,
        if (automaticPair != null) 'pair': [automaticPair.$1, automaticPair.$2],
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
      (json['maxDurationSeconds'] != null &&
          (json['maxDurationSeconds'] is! int ||
              (json['maxDurationSeconds'] as int) < 1 ||
              (json['maxDurationSeconds'] as int) > 14400))) {
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
      (claims['autoReverseTargetLanguage'] == true) !=
          (body['autoReverseTargetLanguage'] == true) ||
      claims['voiceOutput'] != body['voiceOutput'] ||
      publicCreationCanonical(claims['voice']) !=
          publicCreationCanonical(body['voice']) ||
      publicCreationCanonical(claims['processing']) !=
          publicCreationCanonical(p) ||
      claims['expiresAt'] != expiry.millisecondsSinceEpoch ~/ 1000 ||
      (json['maxDurationSeconds'] == null
          ? claims.containsKey('maxDurationSeconds')
          : claims['maxDurationSeconds'] != json['maxDurationSeconds']) ||
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
