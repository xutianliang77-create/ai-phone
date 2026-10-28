part of 'account_api_client.dart';

extension _AccountApiTransport on AccountApiClient {
  Future<ScopedAccountOperation> _currentToken(String token) async {
    final op = await ScopedAccountOperation.capture(createSessionStore());
    if (op.original.token != token) throw const AccountAuthRequiredException();
    return op;
  }
  Future<Map<String, Object?>> _get(String path, String token) async {
    final operation = onDeviceExecution ? await _currentToken(token) : null;
    final response = await _send(path, (deadline) async {
      if (deploymentId.isNotEmpty) {
        await _verifyIdentity(path, 'GET', deadline.remaining);
      }
      deadline.requireOpen();
      if (deploymentId.isNotEmpty) {
        return _boundRequest('GET', path, {
          'authorization': 'Bearer $token',
        }, deadline: deadline);
      }
      return _client.get(
        baseUrl.resolve(path),
        headers: {'authorization': 'Bearer $token'},
      );
    });
    await operation?.check();
    return _decode(response, path);
  }

  Future<Map<String, Object?>> _post(
    String path,
    Map<String, Object?> body, {
    String? token,
  }) async {
    final operation = onDeviceExecution && token != null && path != '/auth/logout' ? await _currentToken(token) : null;
    final response = await _send(path, (deadline) async {
      if (deploymentId.isNotEmpty) {
        await _verifyIdentity(path, 'POST', deadline.remaining);
      }
      deadline.requireOpen();
      if (deploymentId.isNotEmpty) {
        return _boundRequest(
          'POST',
          path,
          {
            'content-type': 'application/json',
            if (token != null) 'authorization': 'Bearer $token',
          },
          body: jsonEncode({
            ...body,
            if (path.startsWith('/auth/phone/')) 'deploymentId': deploymentId,
          }),
          deadline: deadline,
        );
      }
      return _client.post(
        baseUrl.resolve(path),
        headers: <String, String>{
          'content-type': 'application/json',
          if (token != null) 'authorization': 'Bearer $token',
        },
        body: jsonEncode({
          ...body,
          if (deploymentId.isNotEmpty && path.startsWith('/auth/phone/'))
            'deploymentId': deploymentId,
        }),
      );
    });
    await operation?.check();
    return _decode(response, path);
  }

  Future<http.Response> _send(
    String path,
    Future<http.Response> Function(_AccountRequestDeadline deadline) request,
  ) async {
    requireOnDeviceControlRequest(baseUrl, 'GET', baseUrl.resolve(path), null);
    final deadline = _AccountRequestDeadline();
    try {
      return await request(deadline).timeout(AccountApiClient.requestTimeout);
    } on TimeoutException {
      throw AccountApiException(
        '$path timed out after ${AccountApiClient.requestTimeout.inSeconds}s',
        const {
          'error': {'code': 'network_timeout'},
        },
      );
    } catch (error) {
      if (error is AccountApiException) rethrow;
      throw AccountApiException('$path network error: $error', const {
        'error': {'code': 'network_error'},
      });
    } finally {
      deadline.close();
    }
  }

  Future<http.Response> _boundRequest(
    String method,
    String path,
    Map<String, String> headers, {
    String? body,
    required _AccountRequestDeadline deadline,
  }) async {
    requireOnDeviceControlRequest(baseUrl, method, baseUrl.resolve(path), body);
    deadline.requireOpen();
    final request = http.AbortableRequest(
      method,
      baseUrl.resolve(path),
      abortTrigger: deadline.abort.future,
    )..followRedirects = false;
    request.headers.addAll(headers);
    if (body != null) request.body = body;
    final watch = Stopwatch()..start();
    try {
      final response = await http.Response.fromStream(
        await _client.send(request),
      );
      unawaited(
        recordPublicControlAttempt(
          path: path,
          phase: 'request',
          method: method,
          durationMs: watch.elapsedMilliseconds,
          timeoutMs: AccountApiClient.requestTimeout.inMilliseconds,
          httpStatus: response.statusCode,
        ),
      );
      return response;
    } catch (error) {
      unawaited(
        recordPublicControlAttempt(
          path: path,
          phase: 'request',
          method: method,
          durationMs: watch.elapsedMilliseconds,
          timeoutMs: AccountApiClient.requestTimeout.inMilliseconds,
          errorType: error.runtimeType.toString(),
        ),
      );
      rethrow;
    }
  }

  Future<void> _verifyIdentity(
    String path,
    String method,
    Duration timeout,
  ) async {
    final watch = Stopwatch()..start();
    var source = 'network';
    try {
      await verifyAccountDeployment(
        _client,
        baseUrl,
        deploymentId,
        timeout,
        onEvidence: (value) => source = value,
      );
      unawaited(
        recordPublicControlAttempt(
          path: path,
          phase: source == 'network' ? 'identity' : 'identity_$source',
          method: method,
          durationMs: watch.elapsedMilliseconds,
          timeoutMs: AccountApiClient.requestTimeout.inMilliseconds,
          httpStatus: source.startsWith('network') ? 200 : null,
        ),
      );
    } catch (error) {
      unawaited(
        recordPublicControlAttempt(
          path: path,
          phase: 'identity',
          method: method,
          durationMs: watch.elapsedMilliseconds,
          timeoutMs: AccountApiClient.requestTimeout.inMilliseconds,
          errorType: error.runtimeType.toString(),
        ),
      );
      rethrow;
    }
  }

  Map<String, Object?> _decode(http.Response response, String path) {
    final json = jsonDecode(response.body) as Map<String, Object?>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = json['error'];
      unawaited(
        recordAppleLoginFailure(
          path,
          response.statusCode,
          error is Map ? error['code'] : null,
        ),
      );
      throw AccountApiException('$path failed: ${response.statusCode}', json);
    }
    return json;
  }
}
