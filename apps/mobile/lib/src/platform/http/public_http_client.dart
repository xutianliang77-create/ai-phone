import '../../features/account/data/account_session_store.dart';
import 'dart:io';

import 'package:cupertino_http/cupertino_http.dart';
import 'package:http/http.dart' as http;
import 'foundation_http_client.dart';
import 'deployment_identity_cache.dart';
import 'device_control_http_client.dart';

http.Client createDevicePermitHttpClient(Uri baseUrl) {
  if (Platform.isIOS &&
      const {'self_hosted', 'cloudflare'}.contains(configuredAccountBackend) &&
      (baseUrl.origin == Uri.parse(configuredAccountApiBaseUrl).origin ||
          baseUrl.origin == Uri.parse(configuredProcessingApiBaseUrl).origin)) {
    return attachPublicDeploymentIdentity(
      _nativePublicClient(),
      createIdentityTransport: _nativePublicClient,
    );
  }
  return DeviceControlHttpClient();
}

FoundationHttpClient _nativePublicClient() {
  final config = URLSessionConfiguration.ephemeralSessionConfiguration()
    ..cache = null
    ..httpShouldSetCookies = false
    ..waitsForConnectivity = false
    ..timeoutIntervalForRequest = const Duration(seconds: 30);
  return FoundationHttpClient(config);
}

/// Uses iOS URLSession for the configured public control service. Callers keep
/// their origin, identity, redirect, account-generation and deadline checks.
http.Client createPublicHttpClient(Uri baseUrl) {
  if (Platform.isIOS &&
      const {'self_hosted', 'cloudflare'}.contains(configuredAccountBackend) &&
      (baseUrl.origin == Uri.parse(configuredAccountApiBaseUrl).origin ||
          baseUrl.origin == Uri.parse(configuredProcessingApiBaseUrl).origin)) {
    return attachPublicDeploymentIdentity(
      _nativePublicClient(),
      createIdentityTransport: _nativePublicClient,
    );
  }
  return http.Client();
}
