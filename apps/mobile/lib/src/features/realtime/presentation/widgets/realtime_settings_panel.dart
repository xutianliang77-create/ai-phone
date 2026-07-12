import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/realtime_runtime_settings.dart';
import '../../data/voice_preset_catalog.dart';
import '../realtime_settings_l10n.dart';
import 'translation_language_picker.dart';
import 'voice_preset_picker.dart';
import 'domain_lexicon_picker.dart';

class RealtimeSettingsPanel extends StatelessWidget {
  const RealtimeSettingsPanel({
    required this.settings,
    required this.enabled,
    required this.onChanged,
    this.autoSpeakSupported = true,
    this.voicePresets = const <VoicePreset>[],
    this.voicePresetsLoading = false,
    this.padding = const EdgeInsets.fromLTRB(16, 4, 16, 8),
    super.key,
  });

  final RealtimeRuntimeSettings settings;
  final bool enabled;
  final ValueChanged<RealtimeRuntimeSettings> onChanged;
  final bool autoSpeakSupported;
  final List<VoicePreset> voicePresets;
  final bool voicePresetsLoading;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    return Padding(
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          SegmentedButton<RealtimeProcessingMode>(
            showSelectedIcon: false,
            segments: <ButtonSegment<RealtimeProcessingMode>>[
              ButtonSegment<RealtimeProcessingMode>(
                value: RealtimeProcessingMode.onDevice,
                icon: const Icon(Icons.phone_iphone),
                label: Text(l10n.onDeviceModeLabel),
              ),
              ButtonSegment<RealtimeProcessingMode>(
                value: RealtimeProcessingMode.online,
                icon: const Icon(Icons.cloud_outlined),
                label: Text(l10n.onlineModeLabel),
              ),
            ],
            selected: <RealtimeProcessingMode>{settings.processingMode},
            onSelectionChanged: enabled ? _changeProcessingMode : null,
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              _LanguageButton(
                label: l10n.sourceLanguageLabel,
                value: l10n.languageDisplayName(settings.sourceLanguage),
                enabled: enabled,
                onPressed: () =>
                    _pickLanguage(context, LanguagePickerKind.source),
              ),
              _LanguageButton(
                label: l10n.targetLanguageLabel,
                value: l10n.languageDisplayName(settings.targetLanguage),
                enabled: enabled,
                onPressed: () =>
                    _pickLanguage(context, LanguagePickerKind.target),
              ),
              DomainLexiconButton(
                settings: settings,
                enabled: enabled,
                onChanged: onChanged,
              ),
              _VoiceOutputSelector(
                settings: settings,
                enabled: enabled && autoSpeakSupported,
                onChanged: onChanged,
                voicePresets: voicePresets,
                voicePresetsLoading: voicePresetsLoading,
              ),
              if (!enabled)
                Text(
                  l10n.settingsLockedHint,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.outline,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  void _changeProcessingMode(Set<RealtimeProcessingMode> values) {
    if (values.isEmpty) return;
    onChanged(settings.copyWith(processingMode: values.single));
  }

  Future<void> _pickLanguage(
    BuildContext context,
    LanguagePickerKind kind,
  ) async {
    if (!enabled) return;
    final selected = await showTranslationLanguagePicker(
      context: context,
      kind: kind,
      selectedCode: kind == LanguagePickerKind.source
          ? settings.sourceLanguage
          : settings.targetLanguage,
    );
    if (selected == null) return;
    onChanged(kind == LanguagePickerKind.source
        ? settings.copyWith(sourceLanguage: selected)
        : settings.copyWith(targetLanguage: selected));
  }
}

class _VoiceOutputSelector extends StatelessWidget {
  const _VoiceOutputSelector({
    required this.settings,
    required this.enabled,
    required this.onChanged,
    required this.voicePresets,
    required this.voicePresetsLoading,
  });

  final RealtimeRuntimeSettings settings;
  final bool enabled;
  final ValueChanged<RealtimeRuntimeSettings> onChanged;
  final List<VoicePreset> voicePresets;
  final bool voicePresetsLoading;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final selected =
        enabled ? settings.voiceOutputMode : RealtimeVoiceOutputMode.off;
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
            enabled: enabled,
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
