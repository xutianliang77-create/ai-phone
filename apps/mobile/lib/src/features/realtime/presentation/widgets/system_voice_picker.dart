import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../../platform/speech/speech_output_provider.dart';
import '../../../../platform/speech/system_voice_preferences.dart';

/// Available system voices are inventory only; they are not an offline or
/// audible-quality qualification. Each language keeps its own selection.
class SystemVoicePicker extends StatefulWidget {
  const SystemVoicePicker({
    required this.enabled,
    this.provider,
    this.preferences,
    super.key,
  });
  final bool enabled;
  final SystemSpeechOutputProvider? provider;
  final SystemVoicePreferences? preferences;

  @override
  State<SystemVoicePicker> createState() => _SystemVoicePickerState();
}

class _SystemVoicePickerState extends State<SystemVoicePicker> {
  late final _provider = widget.provider ?? SystemSpeechOutputProvider();
  late final _preferences = widget.preferences ?? SystemVoicePreferences.shared;
  late Future<List<_VoiceGroup>> _groups;

  @override
  void initState() {
    super.initState();
    _groups = _load();
  }

  Future<List<_VoiceGroup>> _load() async {
    final result = <_VoiceGroup>[];
    for (final language in ['zh', 'en']) {
      result.add(
        _VoiceGroup(
          language,
          await _provider.voices(language),
          await _preferences.selected(language),
        ),
      );
    }
    return result;
  }

  Future<void> _choose(_VoiceGroup group) async {
    final chinese = context.l10n.isChinese;
    final selected = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(
              title: Text(chinese ? '系统默认' : 'System default'),
              selected: group.selected == null,
              onTap: () => Navigator.pop(context, 'default'),
            ),
            for (final voice in group.voices)
              ListTile(
                title: Text(voice.name),
                subtitle: Text(
                  '${voice.language} · ${chinese ? '质量' : 'Quality'} ${voice.quality}',
                ),
                selected: group.selected == voice.identifier,
                onTap: () => Navigator.pop(context, voice.identifier),
              ),
          ],
        ),
      ),
    );
    if (selected == null) return;
    try {
      await _preferences.select(
        group.language,
        selected == 'default' ? null : selected,
      );
      if (mounted) {
        final refreshed = _load();
        setState(() { _groups = refreshed; });
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              chinese
                  ? '音色设置保存失败，原选择已保留。'
                  : 'Could not save the voice selection; the previous choice is kept.',
            ),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<_VoiceGroup>>(
    future: _groups,
    builder: (context, snapshot) {
      final chinese = context.l10n.isChinese;
      if (snapshot.hasError) {
        return Text(
          chinese
              ? '无法读取本机系统音色，请检查设备语言资源。'
              : 'Could not read system voices. Check language resources.',
        );
      }
      if (!snapshot.hasData) {
        return Text(chinese ? '正在读取本机音色…' : 'Loading system voices…');
      }
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final group in snapshot.data!)
            OutlinedButton(
              onPressed: widget.enabled ? () => _choose(group) : null,
              child: Text(
                '${group.language == 'zh' ? (chinese ? '中文' : 'Chinese') : (chinese ? '英文' : 'English')}：${group.label(chinese)}',
              ),
            ),
          Text(
            chinese
                ? '显示设备当前的系统声音；离线可用性和音质仍需实机验证。'
                : 'These are current device voices; offline operation and quality still require device validation.',
          ),
        ],
      );
    },
  );
}

class _VoiceGroup {
  const _VoiceGroup(this.language, this.voices, this.selected);
  final String language;
  final List<SystemVoice> voices;
  final String? selected;
  String label(bool chinese) {
    if (selected == null) return chinese ? '系统默认' : 'System default';
    for (final voice in voices) {
      if (voice.identifier == selected) {
        return '${voice.name} (${voice.language})';
      }
    }
    return chinese
        ? '所选声音不可用，请重新选择'
        : 'Selected voice unavailable; choose another';
  }
}
