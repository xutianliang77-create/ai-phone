import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'realtime_finalization_task.dart';

abstract class RealtimeFinalizationOutbox {
  Future<List<RealtimeFinalizationTask>> load();
  Future<void> upsert(RealtimeFinalizationTask task);
  Future<void> remove(String sessionId);
}

class FileRealtimeFinalizationOutbox implements RealtimeFinalizationOutbox {
  FileRealtimeFinalizationOutbox({File? file}) : _file = file;

  static final Map<String, Future<void>> _writes = <String, Future<void>>{};

  final File? _file;

  @override
  Future<List<RealtimeFinalizationTask>> load() async {
    final file = await _storageFile();
    return _serialized(file, () => _read(file));
  }

  Future<List<RealtimeFinalizationTask>> _read(File file) async {
    if (!await file.exists()) return <RealtimeFinalizationTask>[];
    final decoded = jsonDecode(await file.readAsString());
    if (decoded is! Map || decoded['tasks'] is! List) {
      throw const FormatException('Invalid realtime finalization outbox');
    }
    return (decoded['tasks'] as List)
        .map(RealtimeFinalizationTask.fromJson)
        .whereType<RealtimeFinalizationTask>()
        .toList(growable: false);
  }

  @override
  Future<void> upsert(RealtimeFinalizationTask task) async {
    final file = await _storageFile();
    await _serialized(file, () async {
      final tasks = await _read(file);
      final existing = tasks.cast<RealtimeFinalizationTask?>().firstWhere(
            (item) => item?.sessionId == task.sessionId,
            orElse: () => null,
          );
      final merged = existing == null
          ? task
          : RealtimeFinalizationTask(
              sessionId: task.sessionId,
              idempotencyKey: task.idempotencyKey,
              segments:
                  task.segments.isEmpty ? existing.segments : task.segments,
              billableSeconds: task.billableSeconds > existing.billableSeconds
                  ? task.billableSeconds
                  : existing.billableSeconds,
              createdAt: existing.createdAt,
            );
      await _write(file, <RealtimeFinalizationTask>[
        ...tasks.where((item) => item.sessionId != task.sessionId),
        merged,
      ]);
    });
  }

  @override
  Future<void> remove(String sessionId) async {
    final file = await _storageFile();
    await _serialized(file, () async {
      final tasks = await _read(file);
      final next = tasks.where((item) => item.sessionId != sessionId).toList();
      if (next.length != tasks.length) await _write(file, next);
    });
  }

  Future<void> _write(
    File file,
    List<RealtimeFinalizationTask> tasks,
  ) async {
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(<String, Object?>{
      'version': 1,
      'tasks': tasks.map((task) => task.toJson()).toList(),
    }));
    await temporary.rename(file.path);
  }

  Future<File> _storageFile() async {
    if (_file != null) return _file;
    final directory = await getApplicationSupportDirectory();
    return File('${directory.path}/realtime_finalization_outbox.json');
  }

  Future<T> _serialized<T>(File file, Future<T> Function() operation) async {
    final previous = _writes[file.path] ?? Future<void>.value();
    final completer = Completer<void>();
    final current = completer.future;
    _writes[file.path] = current;
    await previous.catchError((Object _) {});
    try {
      return await operation();
    } finally {
      completer.complete();
      if (identical(_writes[file.path], current)) {
        _writes.remove(file.path);
      }
    }
  }
}

class MemoryRealtimeFinalizationOutbox implements RealtimeFinalizationOutbox {
  final Map<String, RealtimeFinalizationTask> _tasks = {};

  @override
  Future<List<RealtimeFinalizationTask>> load() async =>
      _tasks.values.toList(growable: false);

  @override
  Future<void> upsert(RealtimeFinalizationTask task) async {
    final existing = _tasks[task.sessionId];
    _tasks[task.sessionId] = existing == null
        ? task
        : RealtimeFinalizationTask(
            sessionId: task.sessionId,
            idempotencyKey: task.idempotencyKey,
            segments: task.segments.isEmpty ? existing.segments : task.segments,
            billableSeconds: task.billableSeconds > existing.billableSeconds
                ? task.billableSeconds
                : existing.billableSeconds,
            createdAt: existing.createdAt,
          );
  }

  @override
  Future<void> remove(String sessionId) async {
    _tasks.remove(sessionId);
  }
}
