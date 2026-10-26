import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:translation_mobile/src/features/realtime/data/finalization/realtime_finalization_outbox.dart';
import 'package:translation_mobile/src/features/realtime/data/finalization/realtime_finalization_task.dart';

class _Path extends PathProviderPlatform {
  _Path(this.path);
  final String path;
  @override
  Future<String?> getApplicationSupportPath() async => path;
}

void main() {
  test(
    'new deployment does not load, move or replay an older deployment outbox',
    () async {
      final folder = await Directory.systemTemp.createTemp('v10-outbox-scope-'),
          previous = PathProviderPlatform.instance;
      PathProviderPlatform.instance = _Path(folder.path);
      try {
        final old = FileRealtimeFinalizationOutbox(),
            fresh = FileRealtimeFinalizationOutbox(
              scope: 'new-selfhosted-deployment',
            );
        final task = RealtimeFinalizationTask(
          sessionId: 'old',
          idempotencyKey: 'finalize:old',
          ownerId: 'owner-a',
          segments: const [],
          billableSeconds: 0,
          createdAt: DateTime.now(),
        );
        await old.upsert(task);
        final file = File('${folder.path}/realtime_finalization_outbox.json'),
            before = await file.readAsBytes();
        expect(await fresh.load(), isEmpty);
        expect((await old.load()).single.ownerId, 'owner-a');
        await fresh.upsert(
          RealtimeFinalizationTask(
            sessionId: 'new',
            idempotencyKey: 'finalize:new',
            ownerId: 'owner-b',
            segments: const [],
            billableSeconds: 0,
            createdAt: DateTime.now(),
          ),
        );
        expect((await fresh.load()).single.sessionId, 'new');
        expect(await file.readAsBytes(), before);
      } finally {
        PathProviderPlatform.instance = previous;
        await folder.delete(recursive: true);
      }
    },
  );
}
