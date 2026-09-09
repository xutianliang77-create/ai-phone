import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';
import 'public_creation_resolution.dart';

String publicCreationCanonical(Object? value) {
  if (value is List) return '[${value.map(publicCreationCanonical).join(',')}]';
  if (value is Map) {
    final keys = value.keys.cast<String>().toList()..sort();
    return '{${keys.map((k) => '${jsonEncode(k)}:${publicCreationCanonical(value[k])}').join(',')}}';
  }
  return jsonEncode(value);
}

String publicCreationHash(Object? value) =>
    sha256.convert(utf8.encode(publicCreationCanonical(value))).toString();

bool _containsCredential(Object? value) {
  if (value is List) return value.any(_containsCredential);
  if (value is Map) {
    return value.entries.any((e) =>
      const ['token', 'realtimetoken', 'apikey', 'authorization', 'credentials', 'secret', 'password'].contains(e.key.toString().toLowerCase()) || _containsCredential(e.value));
  }
  return false;
}

/// One pending creation per account/deployment/API scope. Separate from the
/// finalization outbox: a create request must never be replayed as an end request.
class PublicCreationRequestStore {
  PublicCreationRequestStore({Directory? directory}) : _directory = directory;
  final Directory? _directory;
  static final _writes = <String, Future<void>>{};
  Future<File> _file(String scope) async {
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(scope)) {
      throw const FormatException('Invalid public creation scope');
    }
    final directory = _directory ?? await getApplicationSupportDirectory();
    return File('${directory.path}/public_creation_v1_$scope.json');
  }

  Future<T> _serialized<T>(File file, Future<T> Function() action) async {
    final previous = _writes[file.path] ?? Future<void>.value(),
        done = Completer<void>();
    _writes[file.path] = done.future;
    await previous.catchError((Object _) {});
    try {
      return await action();
    } finally {
      done.complete();
      if (identical(_writes[file.path], done.future)) _writes.remove(file.path);
    }
  }

  Future<Map<String, Object?>?> _read(File file, String scope) async {
    if (!await file.exists()) return null;
    if (await file.length() > 65536) {
      throw const FormatException('Public creation record too large');
    }
    final value = jsonDecode(await file.readAsString());
    if (value is! Map<String, Object?> ||
        value.keys.any((k) => !const ['version', 'scope', 'settings', 'key', 'body', 'endpoint', 'state', 'hash', 'sessionId', 'resolution'].contains(k)) ||
        _containsCredential(value['body']) ||
        value['version'] != 1 ||
        value['scope'] != scope ||
        !const ['pending', 'connected', 'retired'].contains(value['state']) ||
        value['body'] is! Map<String, Object?> ||
        value['settings'] is! String ||
        value['endpoint'] is! String ||
        value['key'] is! String ||
        !RegExp(r'^create-[a-f0-9]{64}$').hasMatch(value['key'] as String) ||
        value['hash'] != publicCreationHash({...value}..remove('hash'))) {
      throw const FormatException('Invalid public creation record');
    }
    if (value['state'] == 'retired') {
      final r = value['resolution'];
      if (r is! Map<String, Object?> || r['ownerId'] is! String ||
          r['deploymentId'] is! String || r['nonce'] is! String ||
          !PublicCreationResolution.checked(r, owner: r['ownerId'] as String,
            deployment: r['deploymentId'] as String, key: value['key'] as String,
            scope: scope, generation: 0, nonce: r['nonce'] as String,
            body: value['body']).terminal) {
        throw const FormatException('Invalid public retirement record');
      }
    }
    return value;
  }

  Future<void> _write(File file, Map<String, Object?> value,
      {bool Function()? isCurrent}) async {
    final data = {...value}..remove('hash');
    data['hash'] = publicCreationHash(data);
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(data), flush: true);
    if (isCurrent?.call() == false) throw StateError('Creation resolution cancelled');
    await temporary.rename(file.path);
  }

  Future<Map<String, Object?>?> pending(String scope) async {
    final file = await _file(scope);
    return _serialized(file, () async {
      final value = await _read(file, scope);
      return value?['state'] == 'pending' ? value : null;
    });
  }

  Future<Map<String, Object?>> acquire(String scope, String settings,
      Map<String, Object?> body, String endpoint) async {
    if (_containsCredential(body)) throw const FormatException('Credentials cannot be stored in a creation request');
    final file = await _file(scope);
    return _serialized(file, () async {
      final previous = await _read(file, scope);
      if (previous?['state'] == 'pending') {
        if (previous!['settings'] != settings) {
          throw StateError('仍有未确认的公有创建请求；请恢复原设置重试，不能自动新建');
        }
        return previous;
      }
      final random = Random.secure();
      final key =
          'create-${List.generate(32, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join()}';
      final value = <String, Object?>{
        'version': 1,
        'scope': scope,
        'settings': settings,
        'key': key,
        'body': body,
        'endpoint': endpoint,
        'state': 'pending'
      };
      await _write(file, value);
      return (await _read(file, scope))!;
    });
  }

  Future<void> connected(String scope, String key, String sessionId) async {
    final file = await _file(scope);
    await _serialized(file, () async {
      final value = await _read(file, scope);
      if (value == null || value['key'] != key) {
        throw StateError('Public creation confirmation conflict');
      }
      if (value['state'] == 'retired') throw StateError('Creation already retired');
      if (value['state'] == 'connected') {
        if (value['sessionId'] != sessionId) {
          throw StateError('Public creation session conflict');
        }
        return;
      }
      await _write(
          file, {...value, 'state': 'connected', 'sessionId': sessionId});
    });
  }

  Future<void> retire(PublicCreationResolution result,
      {required bool Function() isCurrent}) async {
    if (!result.terminal) throw StateError('Creation is not terminal');
    final file = await _file(result.scope);
    await _serialized(file, () async {
      final value = await _read(file, result.scope);
      if (!isCurrent() || value == null || value['key'] != result.requestKey ||
          value['state'] != 'pending' ||
          result.receipt['requestHash'] != publicCreationHash(value['body'])) {
        throw StateError('Creation retirement identity changed');
      }
      await _write(file, {...value, 'state': 'retired',
        'resolution': result.receipt}, isCurrent: isCurrent);
    });
  }
}
