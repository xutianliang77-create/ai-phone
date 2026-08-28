import 'dart:convert';
import 'dart:math';

String newVoiceClientControlId(String prefix) {
  final random = Random.secure();
  final bytes = List<int>.generate(18, (_) => random.nextInt(256));
  final token = base64Url.encode(bytes).replaceAll('=', '');
  return '${prefix}_$token';
}
