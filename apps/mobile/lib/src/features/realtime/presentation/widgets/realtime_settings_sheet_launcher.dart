import 'package:flutter/material.dart';

import '../../data/realtime_runtime_settings.dart';
import '../../data/voice_preset_catalog.dart';
import 'realtime_settings_sheet.dart';

void showRealtimeSettingsSheet({
  required BuildContext context,
  required Listenable listenable,
  required String Function() realtimeMode,
  required RealtimeRuntimeSettings Function() settings,
  required bool Function() enabled,
  required bool Function() modeEnabled,
  required bool Function() autoSpeakSupported,
  required ValueChanged<String> onRealtimeModeChanged,
  required ValueChanged<RealtimeRuntimeSettings> onSettingsChanged,
  VoidCallback? onEndRequested,
  List<VoicePreset> voicePresets = const <VoicePreset>[],
  bool voicePresetsLoading = false,
}) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) {
      return StatefulBuilder(
        builder: (sheetContext, setSheetState) {
          void changeRealtimeMode(String mode) {
            onRealtimeModeChanged(mode);
            setSheetState(() {});
          }

          void changeSettings(RealtimeRuntimeSettings nextSettings) {
            onSettingsChanged(nextSettings);
            setSheetState(() {});
          }

          return AnimatedBuilder(
            animation: listenable,
            builder: (context, _) {
              return RealtimeSettingsSheet(
                realtimeMode: realtimeMode(),
                settings: settings(),
                enabled: enabled(),
                modeEnabled: modeEnabled(),
                autoSpeakSupported: autoSpeakSupported(),
                onRealtimeModeChanged: changeRealtimeMode,
                onSettingsChanged: changeSettings,
                onEndRequested: onEndRequested,
                voicePresets: voicePresets,
                voicePresetsLoading: voicePresetsLoading,
              );
            },
          );
        },
      );
    },
  );
}
