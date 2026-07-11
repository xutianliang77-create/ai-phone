import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../controllers/realtime_controller.dart';
import '../realtime_settings_l10n.dart';

class RealtimeStatusBar extends StatelessWidget {
  const RealtimeStatusBar({
    required this.status,
    this.message,
    this.remainingSeconds,
    this.lowBalance = false,
    this.autoSpeakTranslation = false,
    this.autoSpeakEnabled = true,
    this.onAutoSpeakChanged,
    super.key,
  });

  final RealtimeStatus status;
  final String? message;
  final int? remainingSeconds;
  final bool lowBalance;
  final bool autoSpeakTranslation;
  final bool autoSpeakEnabled;
  final ValueChanged<bool>? onAutoSpeakChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final lines = <String>[
      message == null
          ? l10n.statusLine(_statusText(l10n))
          : l10n.errorMessage(message!),
      if (lowBalance && remainingSeconds != null)
        l10n.realtimeLowBalanceWarning(remainingSeconds!),
    ];
    return ListTile(
      title: Text(l10n.realtimeSubtitle),
      subtitle: Text(lines.join('\n')),
      trailing: IconButton(
        tooltip: l10n.autoSpeakTranslationLabel,
        onPressed: autoSpeakEnabled && onAutoSpeakChanged != null
            ? () => onAutoSpeakChanged!(!autoSpeakTranslation)
            : null,
        icon: Icon(
          autoSpeakTranslation
              ? Icons.record_voice_over
              : Icons.voice_over_off_outlined,
        ),
      ),
    );
  }

  String _statusText(AppLocalizations l10n) {
    switch (status) {
      case RealtimeStatus.idle:
        return l10n.statusIdle;
      case RealtimeStatus.connecting:
        return l10n.statusConnecting;
      case RealtimeStatus.listening:
        return l10n.statusListening;
      case RealtimeStatus.paused:
        return l10n.statusPaused;
      case RealtimeStatus.ended:
        return l10n.statusEnded;
    }
  }
}
