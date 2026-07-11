import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../controllers/realtime_controller.dart';

class RealtimeControls extends StatelessWidget {
  const RealtimeControls({
    required this.controller,
    this.onBeforeStart,
    super.key,
  });

  final RealtimeController controller;
  final Future<bool> Function()? onBeforeStart;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          FilledButton(
            onPressed: _start,
            child: Text(context.l10n.start),
          ),
          const SizedBox(width: 12),
          OutlinedButton(
            onPressed: controller.pause,
            child: Text(context.l10n.pause),
          ),
          const SizedBox(width: 12),
          OutlinedButton(
            onPressed: controller.stop,
            child: Text(context.l10n.end),
          ),
        ],
      ),
    );
  }

  Future<void> _start() async {
    final beforeStart = onBeforeStart;
    if (beforeStart != null && !await beforeStart()) return;
    await controller.start();
  }
}
