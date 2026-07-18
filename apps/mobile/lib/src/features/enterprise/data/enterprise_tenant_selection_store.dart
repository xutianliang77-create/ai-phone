import 'dart:io';

import 'package:path_provider/path_provider.dart';

abstract class EnterpriseTenantSelectionStore {
  Future<String?> load();
  Future<void> save(String tenantId);
  Future<void> clear();
}

class FileEnterpriseTenantSelectionStore
    implements EnterpriseTenantSelectionStore {
  const FileEnterpriseTenantSelectionStore();

  @override
  Future<String?> load() async {
    try {
      final file = await _file();
      if (!await file.exists()) return null;
      final value = (await file.readAsString()).trim();
      return value.isEmpty ? null : value;
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> save(String tenantId) async {
    final file = await _file();
    await file.parent.create(recursive: true);
    await file.writeAsString(tenantId);
  }

  @override
  Future<void> clear() async {
    final file = await _file();
    if (await file.exists()) await file.delete();
  }

  Future<File> _file() async {
    final directory = await getApplicationSupportDirectory();
    return File('${directory.path}/enterprise_tenant.txt');
  }
}

class MemoryEnterpriseTenantSelectionStore
    implements EnterpriseTenantSelectionStore {
  MemoryEnterpriseTenantSelectionStore([this.value]);

  String? value;

  @override
  Future<String?> load() async => value;

  @override
  Future<void> save(String tenantId) async => value = tenantId;

  @override
  Future<void> clear() async => value = null;
}
