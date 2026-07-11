import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../../app/localization/app_realtime_control_localizations.dart';
import '../controllers/realtime_session_state.dart';

enum RealtimeControlAction {
  start,
  cancel,
  pause,
  resume,
  end,
  startAgain,
}

typedef RealtimeControlLayout = ({
  RealtimeControlAction? primary,
  RealtimeControlAction? secondary,
  bool busy,
});

RealtimeControlLayout realtimeControlLayout(RealtimeStatus status) {
  return switch (status) {
    RealtimeStatus.idle => (
        primary: RealtimeControlAction.start,
        secondary: null,
        busy: false
      ),
    RealtimeStatus.connecting => (
        primary: RealtimeControlAction.cancel,
        secondary: null,
        busy: false
      ),
    RealtimeStatus.active => (
        primary: RealtimeControlAction.pause,
        secondary: RealtimeControlAction.end,
        busy: false,
      ),
    RealtimeStatus.paused => (
        primary: RealtimeControlAction.resume,
        secondary: RealtimeControlAction.end,
        busy: false,
      ),
    RealtimeStatus.ending => (primary: null, secondary: null, busy: true),
    RealtimeStatus.ended || RealtimeStatus.failed => (
        primary: RealtimeControlAction.startAgain,
        secondary: null,
        busy: false,
      ),
  };
}

class RealtimeControls extends StatelessWidget {
  const RealtimeControls({
    required this.status,
    required this.onStart,
    required this.onPause,
    required this.onStop,
    this.onBeforeStart,
    super.key,
  });

  final RealtimeStatus status;
  final Future<void> Function() onStart;
  final Future<void> Function() onPause;
  final Future<void> Function() onStop;
  final Future<bool> Function()? onBeforeStart;

  @override
  Widget build(BuildContext context) {
    final layout = realtimeControlLayout(status);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      child: SizedBox(
        height: 52,
        child: Row(
          children: <Widget>[
            Expanded(child: _primarySlot(context, layout)),
            const SizedBox(width: 12),
            Expanded(child: _actionButton(context, layout.secondary)),
          ],
        ),
      ),
    );
  }

  Widget _primarySlot(BuildContext context, RealtimeControlLayout layout) {
    if (layout.busy) {
      return Semantics(
        label: context.l10n.statusEnding,
        child: const Center(
          child: SizedBox.square(
            dimension: 24,
            child: CircularProgressIndicator(strokeWidth: 2.5),
          ),
        ),
      );
    }
    return _actionButton(context, layout.primary, primary: true);
  }

  Widget _actionButton(
    BuildContext context,
    RealtimeControlAction? action, {
    bool primary = false,
  }) {
    if (action == null) return const SizedBox.shrink();
    final label = _label(context, action);
    final icon = _icon(action);
    Future<void> onPressed() => _run(action);
    if (primary && action != RealtimeControlAction.cancel) {
      return FilledButton.icon(
        key: const ValueKey('realtime-primary-action'),
        onPressed: onPressed,
        icon: Icon(icon),
        label: Text(label),
      );
    }
    return OutlinedButton.icon(
      key: ValueKey(
          primary ? 'realtime-primary-action' : 'realtime-secondary-action'),
      onPressed: onPressed,
      icon: Icon(icon),
      label: Text(label),
    );
  }

  Future<void> _run(RealtimeControlAction action) async {
    switch (action) {
      case RealtimeControlAction.start:
      case RealtimeControlAction.startAgain:
        final beforeStart = onBeforeStart;
        if (beforeStart != null && !await beforeStart()) return;
        await onStart();
        return;
      case RealtimeControlAction.resume:
        await onStart();
        return;
      case RealtimeControlAction.pause:
        await onPause();
        return;
      case RealtimeControlAction.cancel:
      case RealtimeControlAction.end:
        await onStop();
        return;
    }
  }

  String _label(BuildContext context, RealtimeControlAction action) {
    return switch (action) {
      RealtimeControlAction.start => context.l10n.start,
      RealtimeControlAction.cancel => context.l10n.cancel,
      RealtimeControlAction.pause => context.l10n.pause,
      RealtimeControlAction.resume => context.l10n.resume,
      RealtimeControlAction.end => context.l10n.end,
      RealtimeControlAction.startAgain => context.l10n.startAgain,
    };
  }

  IconData _icon(RealtimeControlAction action) {
    return switch (action) {
      RealtimeControlAction.start => Icons.play_arrow,
      RealtimeControlAction.cancel => Icons.close,
      RealtimeControlAction.pause => Icons.pause,
      RealtimeControlAction.resume => Icons.play_arrow,
      RealtimeControlAction.end => Icons.stop,
      RealtimeControlAction.startAgain => Icons.replay,
    };
  }
}
