import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'realtime_finalization_task.dart';

abstract class RealtimeFinalizationOutbox {
  Future<List<RealtimeFinalizationTask>> load();
  Future<List<RealtimeFinalizationQuarantineRecord>> loadQuarantined();
  Future<void> upsert(RealtimeFinalizationTask task);
  Future<void> remove(String sessionId);
  Future<void> quarantine(
    RealtimeFinalizationTask task, {
    required String reason,
    required DateTime quarantinedAt,
  });
}

class FileRealtimeFinalizationOutbox implements RealtimeFinalizationOutbox {
  FileRealtimeFinalizationOutbox({File? file}) : _file = file;

  static final Map<String, Future<void>> _writes = <String, Future<void>>{};

  final File? _file;

  @override
  Future<List<RealtimeFinalizationTask>> load() async {
    final file = await _storageFile();
    return _serialized(file, () async => (await _read(file)).tasks);
  }

  @override
  Future<List<RealtimeFinalizationQuarantineRecord>> loadQuarantined() async {
    final file = await _storageFile();
    return _serialized(file, () async => (await _read(file)).quarantined);
  }

  Future<_RealtimeFinalizationOutboxState> _read(File file) async {
    if (!await file.exists()) {
      return const _RealtimeFinalizationOutboxState();
    }
    final decoded = jsonDecode(await file.readAsString());
    if (decoded is! Map || decoded['tasks'] is! List) {
      throw const FormatException('Invalid realtime finalization outbox');
    }
    final quarantinedTasks = decoded['quarantinedTasks'];
    if (quarantinedTasks != null && quarantinedTasks is! List) {
      throw const FormatException('Invalid realtime finalization quarantine');
    }
    final tasks = (decoded['tasks'] as List)
        .map(RealtimeFinalizationTask.fromJson)
        .whereType<RealtimeFinalizationTask>()
        .toList(growable: false);
    final quarantined = (quarantinedTasks as List? ?? const <Object?>[])
        .map(RealtimeFinalizationQuarantineRecord.fromJson)
        .whereType<RealtimeFinalizationQuarantineRecord>()
        .toList(growable: false);
    return _RealtimeFinalizationOutboxState(
      tasks: tasks,
      quarantined: quarantined,
    );
  }

  @override
  Future<void> upsert(RealtimeFinalizationTask task) async {
    final file = await _storageFile();
    await _serialized(file, () async {
      final state = await _read(file);
      final existing = state.tasks.cast<RealtimeFinalizationTask?>().firstWhere(
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
      await _write(
        file,
        state.copyWith(tasks: <RealtimeFinalizationTask>[
          ...state.tasks.where((item) => item.sessionId != task.sessionId),
          merged,
        ]),
      );
    });
  }

  @override
  Future<void> remove(String sessionId) async {
    final file = await _storageFile();
    await _serialized(file, () async {
      final state = await _read(file);
      final next = state.tasks
          .where((item) => item.sessionId != sessionId)
          .toList(growable: false);
      if (next.length != state.tasks.length) {
        await _write(file, state.copyWith(tasks: next));
      }
    });
  }

  @override
  Future<void> quarantine(
    RealtimeFinalizationTask task, {
    required String reason,
    required DateTime quarantinedAt,
  }) async {
    final file = await _storageFile();
    await _serialized(file, () async {
      final state = await _read(file);
      final record = RealtimeFinalizationQuarantineRecord(
        task: task,
        reason: reason,
        quarantinedAt: quarantinedAt,
      );
      await _write(
        file,
        _RealtimeFinalizationOutboxState(
          tasks: state.tasks
              .where((item) => item.sessionId != task.sessionId)
              .toList(growable: false),
          quarantined: <RealtimeFinalizationQuarantineRecord>[
            ...state.quarantined
                .where((item) => item.task.sessionId != task.sessionId),
            record,
          ],
        ),
      );
    });
  }

  Future<void> _write(
    File file,
    _RealtimeFinalizationOutboxState state,
  ) async {
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(<String, Object?>{
      'version': 2,
      'tasks': state.tasks.map((task) => task.toJson()).toList(),
      'quarantinedTasks':
          state.quarantined.map((record) => record.toJson()).toList(),
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
  final Map<String, RealtimeFinalizationQuarantineRecord> _quarantined = {};

  @override
  Future<List<RealtimeFinalizationTask>> load() async =>
      _tasks.values.toList(growable: false);

  @override
  Future<List<RealtimeFinalizationQuarantineRecord>> loadQuarantined() async =>
      _quarantined.values.toList(growable: false);

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

  @override
  Future<void> quarantine(
    RealtimeFinalizationTask task, {
    required String reason,
    required DateTime quarantinedAt,
  }) async {
    _tasks.remove(task.sessionId);
    _quarantined[task.sessionId] = RealtimeFinalizationQuarantineRecord(
      task: task,
      reason: reason,
      quarantinedAt: quarantinedAt,
    );
  }
}

class _RealtimeFinalizationOutboxState {
  const _RealtimeFinalizationOutboxState({
    this.tasks = const <RealtimeFinalizationTask>[],
    this.quarantined = const <RealtimeFinalizationQuarantineRecord>[],
  });

  final List<RealtimeFinalizationTask> tasks;
  final List<RealtimeFinalizationQuarantineRecord> quarantined;

  _RealtimeFinalizationOutboxState copyWith({
    List<RealtimeFinalizationTask>? tasks,
    List<RealtimeFinalizationQuarantineRecord>? quarantined,
  }) {
    return _RealtimeFinalizationOutboxState(
      tasks: tasks ?? this.tasks,
      quarantined: quarantined ?? this.quarantined,
    );
  }
}
