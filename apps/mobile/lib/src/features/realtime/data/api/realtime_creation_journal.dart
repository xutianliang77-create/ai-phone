import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';

abstract class RealtimeCreationJournal {
  Future<Map<String, Object?>?> load(String scope);
  Future<void> save(String scope, Map<String, Object?> value);
  Future<void> clear(String scope);
}

/// Contains a signed, immutable request; never an account token or model key.
class FileRealtimeCreationJournal implements RealtimeCreationJournal {
  Future<File> file(String scope) async => File(
    '${(await getApplicationSupportDirectory()).path}/v10-session-create-${sha256.convert(utf8.encode(scope))}.json',
  );
  @override
  Future<Map<String, Object?>?> load(String scope) async {
    final f = await file(scope);
    if (!await f.exists()) return null;
    return Map<String, Object?>.from(jsonDecode(await f.readAsString()) as Map);
  }

  @override
  Future<void> save(String scope, Map<String, Object?> value) async {
    final f = await file(scope),
        temporary = File('${(await file(scope)).path}.tmp');
    await f.parent.create(recursive: true);
    await temporary.writeAsString(jsonEncode(value), flush: true);
    await temporary.rename(f.path);
  }

  @override
  Future<void> clear(String scope) async {
    final f = await file(scope);
    if (await f.exists()) await f.delete();
  }
}

class MemoryRealtimeCreationJournal implements RealtimeCreationJournal {
  final values = <String, Map<String, Object?>>{};
  @override
  Future<Map<String, Object?>?> load(String scope) async => values[scope];
  @override
  Future<void> save(String scope, Map<String, Object?> value) async {
    values[scope] = value;
  }

  @override
  Future<void> clear(String scope) async {
    values.remove(scope);
  }
}
