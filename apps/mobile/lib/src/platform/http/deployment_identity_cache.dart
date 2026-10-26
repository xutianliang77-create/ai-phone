import '../../features/account/data/account_session_store.dart';
import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

/// A fresh connection for subsequent sends, without canceling unrelated
/// requests already in flight. Only read-only deployment metadata retries use it.
abstract interface class DeploymentIdentityRetryTransport {
  void renewIdentityConnection();
}

class DeploymentIdentityFailure implements Exception {
  const DeploymentIdentityFailure(this.metadata);
  final Map<String, Object?> metadata;
}

class DeploymentIdentityEvidence {
  const DeploymentIdentityEvidence(this.source);
  // network, network_retry, cache, joined; never an authorization receipt.
  final String source;
}

class DeploymentIdentityCache {
  DeploymentIdentityCache({
    int Function()? nowMs,
    this.lifetimeMs = 60000,
    http.Client? transport,
  }) : _nowMs = nowMs ?? (() => _clock.elapsedMilliseconds),
       _transport = transport;
  static final _clock = Stopwatch()..start();
  final int Function() _nowMs;
  final int lifetimeMs;
  final http.Client? _transport;
  final _verified = <String, int>{};
  final _pending = <String, Future<bool>>{};
  String _key(Uri base, String deployment) =>
      jsonEncode([base.origin, deployment]);

  void remember(Uri base, String deployment) {
    _verified[_key(base, deployment)] = _nowMs() + lifetimeMs;
  }

  void forget(Uri base, String deployment) {
    _verified.remove(_key(base, deployment));
  }

  Future<DeploymentIdentityEvidence> verify(
    http.Client client,
    Uri base,
    String deployment,
    Duration timeout, {
    bool forceRefresh = false,
    bool refreshCached = false,
    http.Client? transportOverride,
  }) async {
    final key = _key(base, deployment);
    final waiting = forceRefresh ? null : _pending[key];
    if (waiting != null) {
      await waiting.timeout(timeout);
      return const DeploymentIdentityEvidence('joined');
    }
    if (!forceRefresh && !refreshCached && (_verified[key] ?? -1) > _nowMs()) {
      return const DeploymentIdentityEvidence('cache');
    }
    final fresh = _readIdentityWithRetry(
      transportOverride ?? _transport ?? client,
      base,
      deployment,
      timeout,
    );
    if (!forceRefresh) _pending[key] = fresh;
    try {
      final retried = await fresh;
      remember(base, deployment);
      return DeploymentIdentityEvidence(retried ? 'network_retry' : 'network');
    } catch (_) {
      forget(base, deployment);
      rethrow;
    } finally {
      if (identical(_pending[key], fresh)) _pending.remove(key);
    }
  }

  Future<bool> _readIdentityWithRetry(
    http.Client client,
    Uri base,
    String deployment,
    Duration timeout,
  ) async {
    if (client is! DeploymentIdentityRetryTransport ||
        timeout <= const Duration(seconds: 10)) {
      await _readIdentity(client, base, deployment, timeout);
      return false;
    }
    final watch = Stopwatch()..start();
    const attemptLimit = Duration(seconds: 10);
    final half = Duration(microseconds: timeout.inMicroseconds ~/ 2);
    final first = half < attemptLimit ? half : attemptLimit;
    try {
      await _readIdentity(client, base, deployment, first);
      return false;
    } catch (error) {
      // An identity mismatch or redirect is a policy rejection, not a retry.
      if (error is! TimeoutException && error is! http.ClientException) rethrow;
      final allocatedRemaining = timeout - first;
      final actualRemaining = timeout - watch.elapsed;
      final remaining = allocatedRemaining < actualRemaining
          ? allocatedRemaining
          : actualRemaining;
      if (remaining <= Duration.zero) rethrow;
      final second = remaining < const Duration(seconds: 10)
          ? remaining
          : const Duration(seconds: 10);
      (client as DeploymentIdentityRetryTransport).renewIdentityConnection();
      await _readIdentity(client, base, deployment, second);
      return true;
    }
  }

  Future<void> _readIdentity(
    http.Client client,
    Uri base,
    String deployment,
    Duration timeout,
  ) async {
    final abort = Completer<void>();
    final request = http.AbortableRequest(
      'GET',
      base.resolve('/auth/deployment'),
      abortTrigger: abort.future,
    )..followRedirects = false;
    late final http.Response response;
    try {
      response = await (() async => http.Response.fromStream(
        await client.send(request),
      ))().timeout(timeout);
    } finally {
      if (!abort.isCompleted) abort.complete();
    }
    Object? decoded;
    if (response.statusCode == 200 && response.bodyBytes.length <= 65536) {
      try {
        decoded = jsonDecode(response.body);
      } on FormatException {
        /* reject */
      }
    }
    final reported = decoded is Map ? decoded['deploymentId'] : null;
    if (response.statusCode != 200 ||
        reported != deployment ||
        (selfHostedAccountEnabled &&
            (decoded is! Map ||
                decoded['backend'] != configuredAccountBackend ||
                decoded['bundleId'] != configuredPublicBundleId ||
                (onDeviceExecution && (decoded['execution'] != 'on_device' || decoded['controlContract'] != 'v10-device-license-v1')) ||
                (configuredAccountBackend == 'cloudflare' && !onDeviceExecution &&
                    decoded['processingApiBaseUrl'] !=
                        configuredProcessingApiBaseUrl)))) {
      throw DeploymentIdentityFailure({
        'statusCode': response.statusCode,
        'reportedDeploymentId': reported is String ? reported : null,
        'contentType': response.headers['content-type'],
        'responseBytes': response.bodyBytes.length,
      });
    }
  }
}

final _identityCaches = Expando<DeploymentIdentityCache>();
DeploymentIdentityCache? _publicProcessIdentity;

// Only the app's fixed-origin native client factory shares public metadata.
// Injected clients retain isolated caches. No tokens, balances, challenges,
// permits, account authorization, or expiry extensions are cached here.
T attachPublicDeploymentIdentity<T extends http.Client>(
  T client, {
  required http.Client Function() createIdentityTransport,
}) {
  // The public metadata transport lives with this process, not an account page.
  // Disposing a page cannot cancel shared verification needed by another caller.
  _identityCaches[client] = _publicProcessIdentity ??= DeploymentIdentityCache(
    lifetimeMs: 120000,
    transport: createIdentityTransport(),
  );
  return client;
}

DeploymentIdentityCache deploymentIdentityCache(http.Client client) =>
    _identityCaches[client] ??= DeploymentIdentityCache();

void attachDeploymentIdentityForTesting(
  http.Client client,
  DeploymentIdentityCache cache,
) {
  _identityCaches[client] = cache;
}
