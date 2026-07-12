import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/voice_preset_catalog.dart';
import '../realtime_settings_l10n.dart';

Future<String?> showVoicePresetPicker({
  required BuildContext context,
  required List<VoicePreset> presets,
  required String selectedId,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => SafeArea(
      top: false,
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
        children: <Widget>[
          Text(
            context.l10n.voicePresetPickerTitle,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          for (final preset in presets)
            ListTile(
              contentPadding: EdgeInsets.zero,
              selected: preset.id == selectedId,
              title: Text(preset.label(chinese: context.l10n.isChinese)),
              subtitle: Text(context.l10n.voicePresetDescription(preset)),
              trailing: preset.id == selectedId
                  ? const Icon(Icons.check)
                  : null,
              onTap: () => Navigator.of(context).pop(preset.id),
            ),
        ],
      ),
    ),
  );
}
