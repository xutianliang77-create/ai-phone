import '../../../platform/http/on_device_egress.dart';
import 'dart:async';
import 'package:http/http.dart' as http;
import 'account_api_client.dart' show AccountApiClient, verifyAccountDeployment;
import '../../../platform/diagnostics/public_control_request_trace.dart';
import '../../../platform/diagnostics/control_transport_trace.dart';
import '../../../platform/http/observed_http_request.dart';
import 'account_auth_headers.dart';
import 'account_session_store.dart';

class ScopedAccountOperation {
  ScopedAccountOperation._(this.store, this.original, this.generation);
  final AccountSessionStore store;
  final AccountSession original;
  final int generation;
  static Future<ScopedAccountOperation> capture(
    AccountSessionStore store,
  ) async {
    if (store is! AccountSessionGeneration) {
      throw const AccountAuthRequiredException();
    }
    final epoch = (store as AccountSessionGeneration).generation,
        s = await store.load();
    if (s?.ownerId == null ||
        epoch != (store as AccountSessionGeneration).generation) {
      throw const AccountAuthRequiredException();
    }
    return ScopedAccountOperation._(store, s!, epoch);
  }

  Future<void> check() async {
    final s = await store.load();
    if ((store as AccountSessionGeneration).generation != generation ||
        s?.ownerId != original.ownerId ||
        s?.token != original.token) {
      throw const AccountAuthRequiredException();
    }
  }
}

/// Original account scope/generation, shared by public billing and history.
/// Redirects and stale responses never forward/rebind the account Bearer.
Future<http.Response> scopedAccountRequest(
  http.Client client,
  AccountSessionStore store,
  Uri baseUrl,
  String method,
  Uri uri, {
  String? body,
  String? requestKey,
  bool authenticated = true,
  ScopedAccountOperation? operation,
  Duration requestTimeout = AccountApiClient.requestTimeout,
}) async {
  requireOnDeviceControlRequest(baseUrl, method, uri, body);
  await operation?.check();
  final issuer = Uri.parse(configuredAccountApiBaseUrl);
  requireAccountOrigin(issuer, configuredPublicDeploymentId);
  final processing =
      configuredAccountBackend == 'cloudflare' &&
      !onDeviceExecution &&
      baseUrl.toString().replaceFirst(RegExp(r'/+$'), '') ==
          configuredProcessingApiBaseUrl.replaceFirst(RegExp(r'/+$'), '');
  if ((baseUrl.origin != issuer.origin && !processing) ||
      baseUrl.scheme != 'https' ||
      baseUrl.userInfo.isNotEmpty ||
      baseUrl.hasQuery ||
      baseUrl.hasFragment ||
      uri.origin != baseUrl.origin ||
      uri.userInfo.isNotEmpty ||
      uri.hasFragment) {
    throw const AccountAuthRequiredException();
  }
  final epoch = store is AccountSessionGeneration
      ? (store as AccountSessionGeneration).generation
      : -1;
  final before = authenticated ? await store.load() : null;
  if (authenticated &&
      (epoch < 0 ||
          before?.ownerId == null ||
          before!.deploymentId != configuredPublicDeploymentId ||
          before.issuerOrigin != issuer.origin)) {
    throw const AccountAuthRequiredException();
  }
  Future<void> check() async {
    if (!authenticated) return;
    final current = await store.load();
    if ((store as AccountSessionGeneration).generation != epoch ||
        current?.token != before!.token ||
        current?.ownerId != before.ownerId ||
        !(DateTime.tryParse(before.expiresAtIso)?.isAfter(DateTime.now()) ??
            false)) {
      throw const AccountAuthRequiredException();
    }
  }

  final timeout = requestTimeout;
  final budgetWatch = Stopwatch()..start();
  final watch = Stopwatch()..start();
  final diagnosticId = newControlDiagnosticId(path: uri.path);
  final diagnosticWatch = Stopwatch()..start();
  var phase = 'identity';
  void trace({int? status, Object? error, http.Response? response}) {
    unawaited(
      recordPublicControlAttempt(
        path: uri.path,
        phase: phase,
        method: method,
        durationMs: watch.elapsedMilliseconds,
        timeoutMs: timeout.inMilliseconds,
        httpStatus: status,
        errorType: error?.runtimeType.toString(),
        serverTimingsMs: parsePublicServerTiming(
          response?.headers['server-timing'],
        ),
        serverDatabaseCalls: int.tryParse(
          response?.headers['x-wujie-d1-calls'] ?? '',
        ),
      ),
    );
  }

  try {
    var identitySource = 'network';
    await verifyAccountDeployment(
      client,
      issuer,
      configuredPublicDeploymentId,
      timeout,
      onEvidence: (source) => identitySource = source,
    );
    if (identitySource != 'network') phase = 'identity_$identitySource';
    trace(status: identitySource.startsWith('network') ? 200 : null);
  } catch (error) {
    trace(error: error);
    rethrow;
  }
  await check();
  // Authenticated GETs can trigger server-side Apple credential refresh and
  // state writes. They must not be automatically replayed after a timeout.
  final remaining = timeout - budgetWatch.elapsed;
  if (remaining <= Duration.zero) {
    throw TimeoutException('Control request deadline elapsed');
  }
  final abort = Completer<void>();
  void diagnostic(
    String stage, {
    int? status,
    int? errorCode,
    String? errorDomain,
    String? errorType,
    String? cfRay,
    String? serverCode,
    List<Map<String, Object?>>? metrics,
  }) {
    recordControlTransportEvent(
      id: diagnosticId,
      path: uri.path,
      phase: stage,
      method: method,
      elapsedMs: diagnosticWatch.elapsedMilliseconds,
      attempt: 1,
      status: status,
      errorCode: errorCode,
      errorDomain: errorDomain,
      errorType: errorType,
      cfRay: cfRay,
      serverCode: serverCode,
      metrics: metrics,
    );
  }

  final http.Request request = diagnosticId == null
      ? http.AbortableRequest(method, uri, abortTrigger: abort.future)
      : ObservedHttpRequest(
          method,
          uri,
          abortTrigger: abort.future,
          onNativeObservation: (event) => diagnostic(
            event.phase,
            errorCode: event.errorCode,
            errorDomain: event.errorDomain,
            metrics: event.metrics,
          ),
        );
  request.followRedirects = false;
  request.headers.addAll({
    'content-type': 'application/json',
    if (authenticated) 'authorization': 'Bearer ${before!.token}',
    if (requestKey != null) 'idempotency-key': requestKey,
    if (diagnosticId != null) 'x-wujie-diagnostic-id': diagnosticId,
  });
  if (body != null) request.body = body;
  phase = 'request';
  watch.reset();
  diagnostic('request_started');
  try {
    final response = await (() async {
      final stream = await client.send(request), bytes = <int>[];
      await for (final chunk in stream.stream) {
        if (bytes.length + chunk.length > 8 * 1024 * 1024) {
          throw const FormatException('Public response too large');
        }
        bytes.addAll(chunk);
      }
      return http.Response.bytes(
        bytes,
        stream.statusCode,
        headers: stream.headers,
      );
    })().timeout(remaining);
    await check();
    await operation?.check();
    trace(status: response.statusCode, response: response);
    diagnostic(
      'request_completed',
      status: response.statusCode,
      cfRay: response.headers['cf-ray'],
      serverCode: diagnosticId == null
          ? null
          : controlDiagnosticServerCode(
              response.statusCode,
              response.bodyBytes,
            ),
    );
    return response;
  } catch (error) {
    trace(error: error);
    diagnostic('request_failed', errorType: error.runtimeType.toString());
    rethrow;
  } finally {
    if (!abort.isCompleted) abort.complete();
  }
}
