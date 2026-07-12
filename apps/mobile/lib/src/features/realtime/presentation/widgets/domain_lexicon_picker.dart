import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/domain_lexicon_pack.dart';
import '../../data/realtime_runtime_settings.dart';
import '../realtime_settings_l10n.dart';

class DomainLexiconButton extends StatelessWidget {
  const DomainLexiconButton({
    required this.settings,
    required this.enabled,
    required this.onChanged,
    super.key,
  });

  final RealtimeRuntimeSettings settings;
  final bool enabled;
  final ValueChanged<RealtimeRuntimeSettings> onChanged;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: enabled ? () => _pick(context) : null,
      icon: const Icon(Icons.menu_book_outlined),
      label: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            context.l10n.domainLexiconLabel,
            style: Theme.of(context).textTheme.labelSmall,
          ),
          Text(context.l10n
              .domainLexiconDisplayName(settings.domainLexiconPack)),
        ],
      ),
    );
  }

  Future<void> _pick(BuildContext context) async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: <Widget>[
            ListTile(
              title: Text(
                context.l10n.domainLexiconPickerTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            for (final code in selectableDomainLexiconPacks)
              ListTile(
                leading: const Icon(Icons.menu_book_outlined),
                title: Text(context.l10n.domainLexiconDisplayName(code)),
                trailing: code == settings.domainLexiconPack
                    ? const Icon(Icons.check)
                    : null,
                onTap: () => Navigator.of(context).pop(code),
              ),
          ],
        ),
      ),
    );
    if (selected != null) {
      onChanged(settings.copyWith(domainLexiconPack: selected));
    }
  }
}
