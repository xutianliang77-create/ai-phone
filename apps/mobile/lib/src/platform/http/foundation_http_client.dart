import 'dart:async';

import 'package:cupertino_http/cupertino_http.dart';
import 'package:http/http.dart' as http;
import 'package:objective_c/objective_c.dart';
import 'deployment_identity_cache.dart';
import 'observed_http_request.dart';

/// Bounded public JSON control traffic over URLSession completion handlers.
/// Redirects remain disabled, and close cancels outstanding native tasks.
class FoundationHttpClient extends http.BaseClient
    implements DeploymentIdentityRetryTransport {
  FoundationHttpClient(URLSessionConfiguration config)
    : _config = config,
      _session = _newSession(config);

  final URLSessionConfiguration _config;
  URLSession _session;
  static URLSession _newSession(URLSessionConfiguration config) =>
      URLSession.sessionWithConfiguration(
        config,
        onRedirect: (_, __, ___, ____) => null,
      );
  @override
  void renewIdentityConnection() {
    if (_closed) throw http.ClientException('Client is closed');
    final previous = _session;
    _session = _newSession(_config);
    // Existing account operations retain their original tasks and outcomes.
    // Newly dispatched requests use the new session after metadata succeeds.
    previous.finishTasksAndInvalidate();
  }

  final _tasks = <URLSessionTask, Completer<http.StreamedResponse>>{};
  bool _closed = false;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (_closed) throw http.ClientException('Client is closed', request.url);
    var aborted = false;
    URLSessionTask? nativeTask;
    Completer<http.StreamedResponse>? pending;
    void observe(String phase, {int? errorCode}) {
      if (request is ObservedHttpRequest) {
        request.observeNative(phase, errorCode: errorCode);
      }
    }

    if (request case http.Abortable(:final abortTrigger?)) {
      unawaited(
        abortTrigger.then((_) {
          aborted = true;
          final active = nativeTask;
          if (active != null) {
            observe('native_cancel_requested');
            active.cancel();
            // The native completion callback can arrive later. Cancellation
            // must release this Future now, without allowing late completion
            // to complete it twice or retain a cancelled logical request.
            final result = pending;
            if (result != null && !result.isCompleted) {
              result.completeError(http.RequestAbortedException(request.url));
            }
          }
        }),
      );
    }
    final body = await request.finalize().toBytes();
    if (aborted) throw http.RequestAbortedException(request.url);
    if (_closed) throw http.ClientException('Client is closed', request.url);
    final bodyless = request.method == 'GET' || request.method == 'HEAD';
    if (bodyless && body.isNotEmpty) {
      throw http.ClientException('GET/HEAD body is not allowed', request.url);
    }
    final native = MutableURLRequest.fromUrl(request.url);
    request.headers.forEach((key, value) {
      if (!bodyless ||
          ![
            'content-length',
            'transfer-encoding',
          ].contains(key.toLowerCase())) {
        native.setValueForHttpHeaderField(key, value);
      }
    });
    if (body.isNotEmpty) native.httpBody = body.toNSData();
    native.httpMethod = request.method;
    final result = Completer<http.StreamedResponse>();
    pending = result;
    late final URLSessionTask task;
    task = _session.dataTaskWithCompletionHandler(native, (
      data,
      response,
      error,
    ) {
      _tasks.remove(task);
      nativeTask = null;
      observe('native_task_completed', errorCode: error?.code);
      if (result.isCompleted) return;
      try {
        if (aborted) {
          result.completeError(http.RequestAbortedException(request.url));
        } else if (error != null) {
          result.completeError(NSErrorClientException(error, request.url));
        } else if (response is HTTPURLResponse) {
          final bytes = data?.toList() ?? <int>[];
          final headers = response.allHeaderFields.map(
            (key, value) => MapEntry(key.toLowerCase(), value),
          );
          result.complete(
            http.StreamedResponse(
              Stream.value(bytes),
              response.statusCode,
              contentLength: bytes.length,
              headers: headers,
              request: request,
              isRedirect:
                  response.statusCode >= 300 &&
                  response.statusCode < 400 &&
                  headers.containsKey('location'),
            ),
          );
        } else {
          result.completeError(
            http.ClientException('Invalid HTTP response', request.url),
          );
        }
      } catch (error, stack) {
        if (!result.isCompleted) result.completeError(error, stack);
      }
    });
    nativeTask = task;
    _tasks[task] = result;
    observe('native_task_started');
    task.resume();
    return result.future;
  }

  @override
  void close() {
    if (_closed) return;
    _closed = true;
    for (final entry in _tasks.entries.toList()) {
      entry.key.cancel();
      if (!entry.value.isCompleted) {
        entry.value.completeError(http.ClientException('Client is closed'));
      }
    }
    _tasks.clear();
    _session.finishTasksAndInvalidate();
  }
}
