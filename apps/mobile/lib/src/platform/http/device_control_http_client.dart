import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'deployment_identity_cache.dart';

/// Each proof exchange has an independently owned platform TLS session, with
/// normal certificate validation. Closing one response cannot cancel another.
class DeviceControlHttpClient extends http.BaseClient
    implements DeploymentIdentityRetryTransport {
  DeviceControlHttpClient({http.Client Function()? createConnection})
    : _createConnection = createConnection ?? _newTcp,
      _tcpConnection = createConnection == null;
  static http.Client _newTcp() =>
      IOClient(HttpClient()..connectionTimeout = const Duration(seconds: 8));
  final http.Client Function() _createConnection;
  final bool _tcpConnection;
  final _active = <http.Client>{};
  bool _closed = false;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (_closed) throw http.ClientException('Device control client closed');
    final inner = _createConnection();
    _active.add(inner);
    request.followRedirects = false;
    if (_tcpConnection) request.headers['connection'] = 'close';
    try {
      final response = await inner.send(request);
      Stream<List<int>> body() async* {
        try {
          yield* response.stream;
        } finally {
          _active.remove(inner);
          inner.close();
        }
      }

      return http.StreamedResponse(
        body(),
        response.statusCode,
        headers: response.headers,
        request: response.request,
        contentLength: response.contentLength,
        isRedirect: response.isRedirect,
        persistentConnection: false,
        reasonPhrase: response.reasonPhrase,
      );
    } catch (_) {
      _active.remove(inner);
      inner.close();
      rethrow;
    }
  }

  @override
  void renewIdentityConnection() {
    // Every send already has a fresh connection. No other in-flight work is canceled.
  }
  @override
  void close() {
    _closed = true;
    for (final client in _active.toList()) {
      client.close();
    }
    _active.clear();
  }
}
