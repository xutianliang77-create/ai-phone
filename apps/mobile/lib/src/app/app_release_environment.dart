void validateAppReleaseEnvironment({
  required String channel,
  required Uri apiBaseUrl,
  required String productProfile,
  required bool useMockAudio,
  required bool useDeviceAsr,
  required bool useLocalSessions,
  required bool useOnDeviceTranslation,
  String sourceLanguage = 'auto',
  String targetLanguage = 'zh',
  String voiceOutputMode = 'off',
}) {
  if (channel != 'restricted_instance' && channel != 'app_store') {
    throw StateError('Unknown distribution channel');
  }
  if (channel != 'app_store') return;
  if (productProfile != 'core_translation') {
    throw StateError(
        'Formal 1.0 requires the approved core_translation profile');
  }
  if (!isPublicReleaseApi(apiBaseUrl)) {
    throw StateError(
        'Formal 1.0 requires a public HTTPS API without credentials');
  }
  if (useMockAudio ||
      useDeviceAsr ||
      useLocalSessions ||
      useOnDeviceTranslation) {
    throw StateError('Formal 1.0 must use the existing online inference chain');
  }
  if (!const {'auto', 'zh', 'en'}.contains(sourceLanguage) ||
      !const {'zh', 'en'}.contains(targetLanguage) ||
      voiceOutputMode == 'my_voice') {
    throw StateError(
        'Formal 1.0 requires its approved language and voice scope');
  }
}

bool isPublicReleaseApi(Uri url) {
  if (url.scheme != 'https' ||
      url.userInfo.isNotEmpty ||
      url.hasQuery ||
      url.hasFragment) {
    return false;
  }
  final host = url.host.toLowerCase().replaceFirst(RegExp(r'\.$'), '');
  final parts = host.split('.');
  if (parts.length == 4 && parts.every((p) => int.tryParse(p) != null)) {
    final n = parts.map(int.parse).toList();
    final a = n[0], b = n[1], c = n[2];
    return n.every((v) => v >= 0 && v <= 255) &&
        !(a == 0 ||
            a == 10 ||
            a == 127 ||
            a >= 224 ||
            (a == 100 && b >= 64 && b <= 127) ||
            (a == 169 && b == 254) ||
            (a == 172 && b >= 16 && b <= 31) ||
            (a == 192 && (b == 168 || (b == 0 && (c == 0 || c == 2)))) ||
            (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100))) ||
            (a == 203 && b == 0 && c == 113));
  }
  if (host.contains(':')) {
    return RegExp(r'^[23]').hasMatch(host) && !host.startsWith('2001:db8:');
  }
  return host.length <= 253 &&
      parts.every((part) =>
          RegExp(r'^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$').hasMatch(part)) &&
      RegExp(r'^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$').hasMatch(host) &&
      !RegExp(r'(^|\.)(localhost|local|test|invalid|example)(\.|$)')
          .hasMatch(host) &&
      !RegExp(r'(^|\.)(internal|home|lan)$').hasMatch(host);
}
