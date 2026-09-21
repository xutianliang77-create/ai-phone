import 'package:flutter/material.dart';
import 'public_creation_scope_notice.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../account/data/account_session_store.dart'
    show configuredPublicDeploymentId;
import '../../../../platform/translation/supported_translation_language.dart';
import '../../data/realtime_runtime_settings.dart';
import '../../data/voice_preset_catalog.dart';
import '../realtime_settings_l10n.dart';
import 'translation_language_picker.dart';
import 'voice_preset_picker.dart';
import 'domain_lexicon_picker.dart';

part 'realtime_voice_settings.dart';

class RealtimeSettingsPanel extends StatelessWidget {
  const RealtimeSettingsPanel({
    required this.settings,
    required this.enabled,
    required this.onChanged,
    this.autoSpeakSupported = true,
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
  final List<VoicePreset> voicePresets;
  final bool voicePresetsLoading;
  final VoidCallback? onEndRequested;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    // Local mode keeps its existing resource-bound limitation. Online mode
    // preserves the inherited automatic-language choices and asks the public
    // server for the exact configuration qualification only at session start.
    final automaticRoutingUnavailable =
        settings.processingMode == RealtimeProcessingMode.onDevice;
    final publicOnline = configuredPublicDeploymentId.isNotEmpty &&
        settings.processingMode == RealtimeProcessingMode.online;
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
          const SizedBox(height: 16),
          PublicCreationScopeNotice(mode: settings.processingMode),
          _SectionLabel(l10n.languageSettingsGroupLabel),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              _LanguageButton(
                label: l10n.sourceLanguageLabel,
                value: l10n.languageDisplayName(settings.sourceLanguage),
                enabled: enabled,
                onPressed: () => _pickLanguage(context,
                    LanguagePickerKind.source, automaticRoutingUnavailable),
              ),
              _LanguageButton(
                label: l10n.targetLanguageLabel,
                value: l10n.targetLanguageSettingLabel(settings.targetLanguage,
                    pairSource: settings.selectedLanguagePair?.source,
                    pairTarget: settings.selectedLanguagePair?.target),
                enabled: enabled,
                onPressed: () => _pickLanguage(context,
                    LanguagePickerKind.target, automaticRoutingUnavailable),
              ),
              DomainLexiconButton(
                settings: settings,
                enabled: enabled && !publicOnline,
                onChanged: onChanged,
              ),
            ],
          ),
          if (settings.processingMode == RealtimeProcessingMode.onDevice) ...[
            const SizedBox(height: 8),
            Text(
              l10n.onDeviceLanguageCapabilityHint,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            if (settings.sourceLanguage == autoSourceLanguageCode ||
                settings.targetLanguage == autoReverseTargetLanguageCode) ...[
              const SizedBox(height: 4),
              Text(
                l10n.onDeviceAutomaticLanguageUnavailableHint,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ],
          ],
          const SizedBox(height: 16),
          _SectionLabel(l10n.voiceSettingsGroupLabel),
          const SizedBox(height: 6),
          _VoiceOutputSelector(
            settings: settings,
            enabled: enabled && autoSpeakSupported,
            publicOnline: publicOnline,
            onChanged: onChanged,
            voicePresets: voicePresets,
            voicePresetsLoading: voicePresetsLoading,
          ),
          if (settings.processingMode == RealtimeProcessingMode.onDevice) ...[
            const SizedBox(height: 8),
            Text(
              settings.allowsSelectedVoiceMode
                  ? l10n.onDeviceVoiceCapabilityHint
                  : l10n.savedVoiceUnavailableHint,
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
    bool automaticRoutingUnavailable,
  ) async {
    if (!enabled) return;
    final disabledCodes = !automaticRoutingUnavailable
        ? const <String>{}
        : kind == LanguagePickerKind.source
            ? const <String>{autoSourceLanguageCode}
            : const <String>{autoReverseTargetLanguageCode};
    final selected = await showTranslationLanguagePicker(
      context: context,
      kind: kind,
      selectedCode: kind == LanguagePickerKind.source
          ? settings.sourceLanguage
          : settings.targetLanguage,
      disabledCodes: disabledCodes,
      // Preserve the full existing language chooser. Availability is checked
      // for the selected pair before starting, without overwriting this value.
    );
    if (selected == null) return;
    onChanged(kind == LanguagePickerKind.source
        ? settings.copyWith(sourceLanguage: selected)
        : settings.copyWith(targetLanguage: selected));
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
