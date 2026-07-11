import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/realtime_runtime_settings.dart';
import '../realtime_settings_l10n.dart';
import 'realtime_mode_selector.dart';
import 'realtime_settings_panel.dart';

class RealtimeSettingsSheet extends StatelessWidget {
  const RealtimeSettingsSheet({
    required this.realtimeMode,
    required this.settings,
    required this.enabled,
    required this.modeEnabled,
    required this.autoSpeakSupported,
    required this.onRealtimeModeChanged,
    required this.onSettingsChanged,
    super.key,
  });

  final String realtimeMode;
  final RealtimeRuntimeSettings settings;
  final bool enabled;
  final bool modeEnabled;
  final bool autoSpeakSupported;
  final ValueChanged<String> onRealtimeModeChanged;
  final ValueChanged<RealtimeRuntimeSettings> onSettingsChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    return SafeArea(
      top: false,
      child: ListView(
        shrinkWrap: true,
        padding: EdgeInsets.fromLTRB(
          16,
          0,
          16,
          16 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        children: <Widget>[
          Text(
            l10n.realtimeSettingsLabel,
            style: theme.textTheme.titleLarge,
          ),
          const SizedBox(height: 12),
          RealtimeModeSelector(
            mode: realtimeMode,
            enabled: modeEnabled,
            onChanged: onRealtimeModeChanged,
            padding: EdgeInsets.zero,
          ),
          const SizedBox(height: 8),
          RealtimeSettingsPanel(
            settings: settings,
            enabled: enabled,
            autoSpeakSupported: autoSpeakSupported,
            onChanged: onSettingsChanged,
            padding: EdgeInsets.zero,
          ),
        ],
      ),
    );
  }
}
