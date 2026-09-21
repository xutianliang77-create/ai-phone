part of 'realtime_settings_panel.dart';

class _VoiceOutputSelector extends StatelessWidget {
  const _VoiceOutputSelector({
    required this.settings,
    required this.enabled,
    required this.publicOnline,
    required this.onChanged,
    required this.voicePresets,
    required this.voicePresetsLoading,
  });

  final RealtimeRuntimeSettings settings;
  final bool enabled;
  final bool publicOnline;
  final ValueChanged<RealtimeRuntimeSettings> onChanged;
  final List<VoicePreset> voicePresets;
  final bool voicePresetsLoading;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final selected =
        !enabled ? RealtimeVoiceOutputMode.off : settings.voiceOutputMode;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          l10n.voiceOutputSettingLabel,
          style: Theme.of(context).textTheme.labelSmall,
        ),
        const SizedBox(height: 4),
        SegmentedButton<RealtimeVoiceOutputMode>(
          showSelectedIcon: false,
          segments: <ButtonSegment<RealtimeVoiceOutputMode>>[
            ButtonSegment<RealtimeVoiceOutputMode>(
              value: RealtimeVoiceOutputMode.off,
              icon: const Icon(Icons.voice_over_off_outlined),
              label: Text(l10n.voiceOutputOffLabel),
            ),
            ButtonSegment<RealtimeVoiceOutputMode>(
              value: RealtimeVoiceOutputMode.natural,
              icon: const Icon(Icons.record_voice_over_outlined),
              label: Text(l10n.voiceOutputNaturalLabel),
            ),
            ButtonSegment<RealtimeVoiceOutputMode>(
              value: RealtimeVoiceOutputMode.myVoice,
              enabled: settings.processingMode == RealtimeProcessingMode.online &&
                  !publicOnline,
              icon: const Icon(Icons.graphic_eq_outlined),
              label: Text(l10n.voiceOutputMyVoiceLabel),
            ),
          ],
          selected: <RealtimeVoiceOutputMode>{selected},
          onSelectionChanged: enabled
              ? (values) => onChanged(
                    settings.copyWith(voiceOutputMode: values.single),
                  )
              : null,
        ),
        if (settings.processingMode == RealtimeProcessingMode.online &&
            settings.voiceOutputMode == RealtimeVoiceOutputMode.natural) ...[
          const SizedBox(height: 8),
          _VoicePresetButton(
            settings: settings,
            presets: voicePresets,
            loading: voicePresetsLoading,
            enabled: enabled && !publicOnline,
            onChanged: onChanged,
          ),
        ],
      ],
    );
  }
}

class _VoicePresetButton extends StatelessWidget {
  const _VoicePresetButton({
    required this.settings,
    required this.presets,
    required this.loading,
    required this.enabled,
    required this.onChanged,
  });

  final RealtimeRuntimeSettings settings;
  final List<VoicePreset> presets;
  final bool loading;
  final bool enabled;
  final ValueChanged<RealtimeRuntimeSettings> onChanged;

  @override
  Widget build(BuildContext context) {
    final selected = _findPreset(settings.voicePresetId);
    final label = loading
        ? context.l10n.voicePresetLoadingLabel
        : selected?.label(chinese: context.l10n.isChinese) ??
            context.l10n.voicePresetUnavailableLabel;
    return OutlinedButton.icon(
      onPressed: enabled && !loading && presets.isNotEmpty
          ? () => _pick(context)
          : null,
      icon: const Icon(Icons.voice_chat_outlined),
      label: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(context.l10n.voicePresetSettingLabel,
              style: Theme.of(context).textTheme.labelSmall),
          Text(label),
        ],
      ),
    );
  }

  VoicePreset? _findPreset(String id) {
    for (final preset in presets) {
      if (preset.id == id) return preset;
    }
    return null;
  }

  Future<void> _pick(BuildContext context) async {
    final selected = await showVoicePresetPicker(
      context: context,
      presets: presets,
      selectedId: settings.voicePresetId,
    );
    if (selected != null) {
      onChanged(settings.copyWith(voicePresetId: selected));
    }
  }
}

class _LanguageButton extends StatelessWidget {
  const _LanguageButton({
    required this.label,
    required this.value,
    required this.enabled,
    required this.onPressed,
  });

  final String label;
  final String value;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: enabled ? onPressed : null,
      icon: const Icon(Icons.translate),
      label: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(label, style: Theme.of(context).textTheme.labelSmall),
          Text(value),
        ],
      ),
    );
  }
}
