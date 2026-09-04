import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

const _maximumPendingReceipts = 128;
const _maximumSafeJsonInteger = 9007199254740991;
const _receiptTypes = <String>{
  'client.playback.started',
  'client.playback.ended',
  'client.playback.failed',
};

class AgentDeliveryReceiptTask {
  const AgentDeliveryReceiptTask({
    required this.draftId,
    required this.deliveryAttemptId,
    required this.receipt,
    required this.createdAt,
  });

  final String draftId;
  final String deliveryAttemptId;
  final Map<String, Object?> receipt;
  final DateTime createdAt;

  String get receiptId => receipt['receiptId']! as String;

  Map<String, Object?> toJson() => <String, Object?>{
        'draftId': draftId,
        'deliveryAttemptId': deliveryAttemptId,
        'receipt': receipt,
        'createdAt': createdAt.toUtc().toIso8601String(),
      };

  static AgentDeliveryReceiptTask? fromJson(Object? value) {
    if (value is! Map<String, Object?> ||
        value['draftId'] is! String ||
        value['deliveryAttemptId'] is! String ||
        value['receipt'] is! Map ||
        value['createdAt'] is! String) {
      return null;
    }
    try {
      final createdAt = DateTime.tryParse(value['createdAt']! as String);
      final receipt = Map<String, Object?>.from(value['receipt']! as Map);
      if (createdAt == null) return null;
      final task = AgentDeliveryReceiptTask(
        draftId: value['draftId']! as String,
        deliveryAttemptId: value['deliveryAttemptId']! as String,
        receipt: receipt,
        createdAt: createdAt.toUtc(),
      );
      return _validTask(task) ? task : null;
    } catch (_) {
      return null;
    }
  }
}

abstract class AgentDeliveryReceiptOutbox {
  Future<List<AgentDeliveryReceiptTask>> load();
  Future<void> enqueue(AgentDeliveryReceiptTask task);
  Future<void> remove(String receiptId);
}

class FileAgentDeliveryReceiptOutbox implements AgentDeliveryReceiptOutbox {
  FileAgentDeliveryReceiptOutbox({File? file}) : _file = file;

  static final Map<String, Future<void>> _writes = <String, Future<void>>{};
  final File? _file;

  @override
  Future<List<AgentDeliveryReceiptTask>> load() async {
    final file = await _storageFile();
    return _serialized(file, () => _read(file));
  }

  @override
  Future<void> enqueue(AgentDeliveryReceiptTask task) async {
    if (!_validTask(task)) {
      throw const FormatException('Invalid Agent delivery receipt task');
    }
    final file = await _storageFile();
    await _serialized(file, () async {
      final tasks = await _read(file);
      final existing = tasks.where((item) => item.receiptId == task.receiptId);
      if (existing.isNotEmpty) {
        if (!_sameTask(existing.first, task)) {
          throw StateError('Agent delivery receipt id was reused');
        }
        return;
      }
      if (tasks.length >= _maximumPendingReceipts) {
        throw StateError('Agent delivery receipt outbox is full');
      }
      await _write(file, <AgentDeliveryReceiptTask>[...tasks, task]);
    });
  }

  @override
  Future<void> remove(String receiptId) async {
    final file = await _storageFile();
    await _serialized(file, () async {
      final tasks = await _read(file);
      final next = tasks.where((item) => item.receiptId != receiptId).toList();
      if (next.length != tasks.length) await _write(file, next);
    });
  }

  Future<List<AgentDeliveryReceiptTask>> _read(File file) async {
    if (!await file.exists()) return <AgentDeliveryReceiptTask>[];
    final value = jsonDecode(await file.readAsString());
    if (value is! Map || value['tasks'] is! List) {
      throw const FormatException('Invalid Agent delivery receipt outbox');
    }
    final tasks = (value['tasks'] as List)
        .map(AgentDeliveryReceiptTask.fromJson)
        .toList(growable: false);
    if (tasks.any((task) => task == null)) {
      throw const FormatException('Invalid Agent delivery receipt task');
    }
    final parsed = tasks.cast<AgentDeliveryReceiptTask>();
    if (parsed.length > _maximumPendingReceipts ||
        parsed.map((task) => task.receiptId).toSet().length != parsed.length) {
      throw const FormatException('Invalid Agent delivery receipt outbox');
    }
    return parsed;
  }

  Future<void> _write(
    File file,
    List<AgentDeliveryReceiptTask> tasks,
  ) async {
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(
        jsonEncode(<String, Object?>{
          'version': 1,
          'tasks': tasks.map((task) => task.toJson()).toList(growable: false),
        }),
        flush: true);
    await temporary.rename(file.path);
  }

  Future<File> _storageFile() async {
    if (_file != null) return _file;
    final directory = await getApplicationSupportDirectory();
    return File('${directory.path}/agent_delivery_receipt_outbox.json');
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

class MemoryAgentDeliveryReceiptOutbox implements AgentDeliveryReceiptOutbox {
  final List<AgentDeliveryReceiptTask> _tasks = <AgentDeliveryReceiptTask>[];

  @override
  Future<List<AgentDeliveryReceiptTask>> load() async => List.of(_tasks);

  @override
  Future<void> enqueue(AgentDeliveryReceiptTask task) async {
    if (!_validTask(task)) {
      throw const FormatException('Invalid Agent delivery receipt task');
    }
    final existing = _tasks.where((item) => item.receiptId == task.receiptId);
    if (existing.isNotEmpty) {
      if (!_sameTask(existing.first, task)) {
        throw StateError('Agent delivery receipt id was reused');
      }
      return;
    }
    if (_tasks.length >= _maximumPendingReceipts) {
      throw StateError('Agent delivery receipt outbox is full');
    }
    _tasks.add(task);
  }

  @override
  Future<void> remove(String receiptId) async {
    _tasks.removeWhere((item) => item.receiptId == receiptId);
  }
}

bool _sameTask(
  AgentDeliveryReceiptTask left,
  AgentDeliveryReceiptTask right,
) =>
    left.draftId == right.draftId &&
    left.deliveryAttemptId == right.deliveryAttemptId &&
    _canonicalJson(left.receipt) == _canonicalJson(right.receipt);

bool _validTask(AgentDeliveryReceiptTask task) {
  final receipt = task.receipt;
  final type = receipt['type'];
  final failureCode = receipt['failureCode'];
  if (!_text(task.draftId, 160) ||
      !_text(task.deliveryAttemptId, 160) ||
      receipt['version'] != 1 ||
      type is! String ||
      !_receiptTypes.contains(type) ||
      receipt['deliveryAttemptId'] != task.deliveryAttemptId ||
      (type == 'client.playback.failed') !=
          (failureCode is String && _text(failureCode, 120))) {
    return false;
  }
  if (type != 'client.playback.failed' && failureCode != null) return false;
  for (final entry in <String, int>{
    'receiptId': 160,
    'sessionId': 160,
    'legId': 160,
    'turnId': 160,
    'workId': 160,
    'deliveryAttemptId': 160,
    'playbackId': 160,
    'clientInstanceId': 160,
    'clientParticipantIdentity': 320,
    'workerParticipantIdentity': 320,
    'ownershipLeaseId': 160,
    'occurredAt': 160,
  }.entries) {
    if (!_text(receipt[entry.key], entry.value)) return false;
  }
  for (final key in <String>[
    'ownershipGeneration',
    'turnGeneration',
    'dispatchGeneration',
    'playbackGeneration',
  ]) {
    final value = receipt[key];
    if (value is! num ||
        value.toInt() != value ||
        value < 1 ||
        value > _maximumSafeJsonInteger) {
      return false;
    }
  }
  return DateTime.tryParse(receipt['occurredAt']! as String) != null;
}

bool _text(Object? value, int maximum) =>
    value is String &&
    value.trim().isNotEmpty &&
    utf8.encode(value).length <= maximum;

String _canonicalJson(Object? value) => jsonEncode(_canonicalValue(value));

Object? _canonicalValue(Object? value) {
  if (value is List) return value.map(_canonicalValue).toList(growable: false);
  if (value is Map) {
    final keys = value.keys.whereType<String>().toList()..sort();
    if (keys.length != value.length) {
      throw const FormatException('Invalid Agent delivery receipt map');
    }
    return <String, Object?>{
      for (final key in keys) key: _canonicalValue(value[key]),
    };
  }
  return value;
}
