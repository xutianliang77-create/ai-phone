import 'dart:convert';
import '../../features/account/data/account_session_store.dart';

/// Product control metadata only. Content transports cannot silently become a
/// fallback when a native resource, recognizer or translator fails.
void requireOnDeviceControlRequest(
  Uri base,
  String method,
  Uri uri,
  String? body,
) {
  if (!onDeviceExecution) return;
  final configured = Uri.tryParse(configuredAccountApiBaseUrl);
  const paths = {
    '/auth/deployment',
    '/auth/apple/request',
    '/auth/apple/login',
    '/auth/logout',
    '/account/me',
    '/account/export',
    '/account/delete',
    '/account/consents',
    '/billing/products',
    '/billing/entitlement',
    '/billing/ledger',
    '/billing/subscription/sync',
    '/v10/device/configuration',
    '/v10/device/challenge',
    '/v10/device/register',
    '/v10/device/acquire',
    '/v10/device/renew',
    '/v10/device/close',
    '/v10/device/resolve',
  };
  if (configured == null ||
      uri.scheme != 'https' ||
      uri.origin != configured.origin ||
      base.origin != configured.origin ||
      !paths.contains(uri.path) ||
      uri.userInfo.isNotEmpty ||
      uri.hasQuery ||
      uri.hasFragment ||
      !{'GET', 'POST'}.contains(method)) {
    throw const FormatException('on_device_control_path_forbidden');
  }
  if (body != null && body.isNotEmpty) {
    final value = jsonDecode(body);
    void check(Object? v) {
      if (v is Map) {
        for (final e in v.entries) {
          if (const {
            'text',
            'sourceText',
            'translatedText',
            'audio',
            'audioData',
            'image',
            'images',
            'segments',
            'transcript',
            'history',
            'prompt',
            'diagnosticText',
          }.contains(e.key)) {
            throw const FormatException('business_content_upload_forbidden');
          }
          check(e.value);
        }
      } else if (v is List) {
        for (final x in v) {
          check(x);
        }
      }
    }

    check(value);
  }
}
