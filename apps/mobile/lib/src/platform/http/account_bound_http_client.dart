import 'on_device_egress.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../features/account/data/account_session_store.dart';
import '../../features/account/data/account_scoped_http.dart';
import 'public_http_client.dart';

/// Same retained API and model protocol; account scope and redirects are bound.
class AccountBoundHttpClient extends http.BaseClient {
  AccountBoundHttpClient(this.base, this.store, {http.Client? inner})
    : inner = inner ?? createPublicHttpClient(base);
  final Uri base;
  final AccountSessionStore store;
  final http.Client inner;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requireAccountOrigin(
      Uri.parse(configuredAccountApiBaseUrl),
      configuredPublicDeploymentId,
    );
    if (request.url.origin != base.origin ||
        request.url.userInfo.isNotEmpty ||
        request.url.hasFragment) {
      throw const FormatException('account_origin_mismatch');
    }
    requireOnDeviceControlRequest(base,request.method,request.url,null);
    final hasAuth = request.headers.containsKey('authorization');
    final op = hasAuth ? await ScopedAccountOperation.capture(store) : null;
    if (hasAuth &&
        request.headers['authorization'] != 'Bearer ${op!.original.token}') {
      throw const FormatException('account_changed');
    }
    final bytes = await request.finalize().toBytes();
    final response = await scopedAccountRequest(
      inner,
      store,
      base,
      request.method,
      request.url,
      authenticated: hasAuth,
      operation: op,
      body: bytes.isEmpty ? null : utf8.decode(bytes),
      requestKey: request.headers['idempotency-key'],
      requestTimeout: const Duration(seconds: 8),
    );
    return http.StreamedResponse(
      Stream.value(response.bodyBytes),
      response.statusCode,
      headers: response.headers,
    );
  }

  @override
  void close() => inner.close();
}

http.Client accountBoundClient(
  Uri base,
  AccountSessionStore store,
  http.Client? inner,
) => selfHostedAccountEnabled
    ? inner is AccountBoundHttpClient &&
              inner.base == base &&
              identical(inner.store, store)
          ? inner
          : AccountBoundHttpClient(base, store, inner: inner)
    : inner ?? http.Client();
