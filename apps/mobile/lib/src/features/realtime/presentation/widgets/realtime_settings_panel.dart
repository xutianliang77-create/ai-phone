import '../../../account/data/account_session_store.dart';
import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/realtime_runtime_settings.dart';
import '../../data/voice_preset_catalog.dart';
import '../realtime_settings_l10n.dart';
import 'translation_language_picker.dart';
import 'voice_preset_picker.dart';
import 'domain_lexicon_picker.dart';
import 'realtime_language_button.dart';
import 'system_voice_picker.dart';
import '../pages/language_capability_page.dart';

class RealtimeSettingsPanel extends StatelessWidget {
  const RealtimeSettingsPanel({
    required this.settings,
    required this.enabled,
    required this.onChanged,
    this.autoSpeakSupported = true,
    this.onlineCoreOnly = false,
    this.voicePresets = const <VoicePreset>[],
    this.voicePresetsLoading = false,
    this.onEndRequested,
    this.padding = const EdgeInsets.fromLTRB(16, 4, 16, 8),
    super.key,
  });

  final RealtimeRuntimeSettings settings;
  final bool enabled;
  final ValueChanged<RealtimeRuntimeSettings> onChanged;
  final bool autoSpeakSupported;
  final bool onlineCoreOnly;
  final List<VoicePreset> voicePresets;
  final bool voicePresetsLoading;
  final VoidCallback? onEndRequested;
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
          _SectionLabel(l10n.processingModeLabel),
          const SizedBox(height: 6),
          SegmentedButton<RealtimeProcessingMode>(
            showSelectedIcon: false,
            segments: <ButtonSegment<RealtimeProcessingMode>>[
              ButtonSegment<RealtimeProcessingMode>(
                value: RealtimeProcessingMode.onDevice,
                enabled: !onlineCoreOnly,
                icon: const Icon(Icons.phone_iphone),
                label: Text(l10n.onDeviceModeLabel),
              ),
              ButtonSegment<RealtimeProcessingMode>(
                value: RealtimeProcessingMode.online,
                enabled: !onDeviceExecution,
                icon: const Icon(Icons.cloud_outlined),
                label: Text(l10n.onlineModeLabel),
              ),
            ],
            selected: <RealtimeProcessingMode>{settings.processingMode},
            onSelectionChanged: enabled ? _changeProcessingMode : null,
          ),
          const SizedBox(height: 16),
          _SectionLabel(l10n.languageSettingsGroupLabel),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              RealtimeLanguageButton(
                label: l10n.sourceLanguageLabel,
                value: l10n.languageDisplayName(settings.sourceLanguage),
                enabled: enabled,
                onPressed: () =>
                    _pickLanguage(context, LanguagePickerKind.source),
              ),
              RealtimeLanguageButton(
                label: l10n.targetLanguageLabel,
                value: l10n.languageDisplayName(settings.targetLanguage),
                enabled: enabled,
                onPressed: () =>
                    _pickLanguage(context, LanguagePickerKind.target),
              ),
              if (settings.processingMode == RealtimeProcessingMode.online)
                DomainLexiconButton(
                  settings: settings,
                  enabled: enabled,
                  onChanged: onChanged,
                ),
            ],
          ),
          if (settings.processingMode == RealtimeProcessingMode.onDevice) ...[
            if (settings.sourceLanguage == 'auto' ||
                settings.autoReverseTargetLanguage) ...[
              const SizedBox(height: 8),
              Text(
                l10n.isChinese
                    ? '自动识别只在以下两种对话语言之间进行；不确定时不会猜测。'
                    : 'Automatic detection is limited to the selected pair; uncertain turns are not guessed.',
              ),
              Wrap(
                spacing: 8,
                children: [
                  OutlinedButton(
                    onPressed: enabled ? () => _pickPair(context, true) : null,
                    child: Text(
                      '${l10n.isChinese ? '语言 A' : 'Language A'}：${l10n.languageDisplayName(settings.automaticPairA)}',
                    ),
                  ),
                  OutlinedButton(
                    onPressed: enabled ? () => _pickPair(context, false) : null,
                    child: Text(
                      '${l10n.isChinese ? '语言 B' : 'Language B'}：${l10n.languageDisplayName(settings.automaticPairB)}',
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 8),
            Text(
              l10n.onDeviceLanguageCapabilityHint,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const LanguageCapabilityPage(),
                ),
              ),
              child: Text(
                l10n.isChinese
                    ? '查看 38 项语言的本机能力与验收状态'
                    : 'View device capabilities for 38 languages',
              ),
            ),
          ],
          const SizedBox(height: 16),
          _SectionLabel(l10n.voiceSettingsGroupLabel),
          const SizedBox(height: 6),
          _VoiceOutputSelector(
            settings: settings,
            allowMyVoice: !onlineCoreOnly && !onDeviceExecution,
            enabled: enabled && autoSpeakSupported,
            onChanged: onChanged,
            voicePresets: voicePresets,
            voicePresetsLoading: voicePresetsLoading,
          ),
          if (settings.processingMode == RealtimeProcessingMode.onDevice) ...[
            const SizedBox(height: 8),
            Text(
              l10n.onDeviceVoiceCapabilityHint,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
          if (!enabled) ...[
            const SizedBox(height: 8),
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    l10n.settingsLockedHint,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.outline,
                    ),
                  ),
                ),
                if (onEndRequested != null)
                  TextButton.icon(
                    onPressed: onEndRequested,
                    icon: const Icon(Icons.stop),
                    label: Text(l10n.endToChangeSettingsLabel),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  void _changeProcessingMode(Set<RealtimeProcessingMode> values) {
    if (values.isEmpty) return;
    onChanged(
      settings
          .copyWith(processingMode: values.single)
          .normalizedForCapabilities(),
    );
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
      supportedCodes: onlineCoreOnly
          ? const {'zh', 'en'}
          : settings.processingMode == RealtimeProcessingMode.onDevice
          ? onDeviceTranslationLanguageCodes
          : null,
      showUnqualified:
          settings.processingMode == RealtimeProcessingMode.onDevice,
    );
    if (selected == null) return;
    onChanged(
      kind == LanguagePickerKind.source
          ? settings.copyWith(sourceLanguage: selected)
          : settings.copyWith(targetLanguage: selected),
    );
  }

  Future<void> _pickPair(BuildContext context, bool first) async {
    final selected = await showTranslationLanguagePicker(
      context: context,
      kind: LanguagePickerKind.source,
      includeAutomatic: false,
      showUnqualified: true,
      supportedCodes: onDeviceTranslationLanguageCodes,
      selectedCode: first ? settings.automaticPairA : settings.automaticPairB,
    );
    if (selected == null) return;
    final oldFirst = settings.automaticPairA,
        oldSecond = settings.automaticPairB;
    onChanged(
      first
          ? settings.copyWith(
              automaticPairA: selected,
              automaticPairB: selected == oldSecond ? oldFirst : oldSecond,
            )
          : settings.copyWith(
              automaticPairB: selected,
              automaticPairA: selected == oldFirst ? oldSecond : oldFirst,
            ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(text, style: Theme.of(context).textTheme.titleSmall);
  }
}

class _VoiceOutputSelector extends StatelessWidget {
  const _VoiceOutputSelector({
    required this.settings,
    required this.enabled,
    required this.onChanged,
    required this.voicePresets,
    required this.voicePresetsLoading,
    this.allowMyVoice = true,
  });

  final RealtimeRuntimeSettings settings;
  final bool enabled;
  final ValueChanged<RealtimeRuntimeSettings> onChanged;
  final List<VoicePreset> voicePresets;
  final bool voicePresetsLoading;
  final bool allowMyVoice;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final selected = !enabled
        ? RealtimeVoiceOutputMode.off
        : settings.processingMode == RealtimeProcessingMode.onDevice &&
              settings.voiceOutputMode == RealtimeVoiceOutputMode.myVoice
        ? RealtimeVoiceOutputMode.natural
        : settings.voiceOutputMode;
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
            if (allowMyVoice &&
                settings.processingMode == RealtimeProcessingMode.online)
              ButtonSegment<RealtimeVoiceOutputMode>(
                value: RealtimeVoiceOutputMode.myVoice,
                icon: const Icon(Icons.graphic_eq_outlined),
                label: Text(l10n.voiceOutputMyVoiceLabel),
              ),
          ],
          selected: <RealtimeVoiceOutputMode>{selected},
          onSelectionChanged: enabled
              ? (values) =>
                    onChanged(settings.copyWith(voiceOutputMode: values.single))
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
        if (settings.processingMode == RealtimeProcessingMode.onDevice &&
            settings.voiceOutputMode == RealtimeVoiceOutputMode.natural) ...[
          const SizedBox(height: 8),
          SystemVoicePicker(enabled: enabled),
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
          Text(
            context.l10n.voicePresetSettingLabel,
            style: Theme.of(context).textTheme.labelSmall,
          ),
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
