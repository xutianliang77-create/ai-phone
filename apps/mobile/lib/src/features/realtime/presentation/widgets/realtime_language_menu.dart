import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../realtime_settings_l10n.dart';

enum RealtimeLanguageMenuAction { chinese, english, realtimeSettings }

class RealtimeLanguageMenu extends StatelessWidget {
  const RealtimeLanguageMenu({
    required this.locale,
    required this.onLocaleChanged,
    required this.onOpenRealtimeSettings,
    super.key,
  });

  final Locale locale;
  final ValueChanged<Locale> onLocaleChanged;
  final VoidCallback onOpenRealtimeSettings;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return PopupMenuButton<RealtimeLanguageMenuAction>(
      icon: const Icon(Icons.language),
      tooltip: l10n.language,
      onSelected: (action) {
        switch (action) {
          case RealtimeLanguageMenuAction.chinese:
            onLocaleChanged(const Locale('zh'));
          case RealtimeLanguageMenuAction.english:
            onLocaleChanged(const Locale('en'));
          case RealtimeLanguageMenuAction.realtimeSettings:
            onOpenRealtimeSettings();
        }
      },
      itemBuilder: (context) => <PopupMenuEntry<RealtimeLanguageMenuAction>>[
        PopupMenuItem<RealtimeLanguageMenuAction>(
          value: RealtimeLanguageMenuAction.chinese,
          child: _ToolbarMenuLabel(
            selected: locale.languageCode == 'zh',
            label: l10n.chinese,
          ),
        ),
        PopupMenuItem<RealtimeLanguageMenuAction>(
          value: RealtimeLanguageMenuAction.english,
          child: _ToolbarMenuLabel(
            selected: locale.languageCode == 'en',
            label: l10n.english,
          ),
        ),
        const PopupMenuDivider(),
        PopupMenuItem<RealtimeLanguageMenuAction>(
          value: RealtimeLanguageMenuAction.realtimeSettings,
          child: Row(
            children: <Widget>[
              const Icon(Icons.tune),
              const SizedBox(width: 12),
              Flexible(
                child: Text(
                  l10n.realtimeSettingsLabel,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ToolbarMenuLabel extends StatelessWidget {
  const _ToolbarMenuLabel({
    required this.selected,
    required this.label,
  });

  final bool selected;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Icon(selected ? Icons.check : Icons.language_outlined),
        const SizedBox(width: 12),
        Flexible(
          child: Text(label, overflow: TextOverflow.ellipsis),
        ),
      ],
    );
  }
}
