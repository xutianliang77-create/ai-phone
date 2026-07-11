import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';

class RealtimeModeSelector extends StatelessWidget {
  const RealtimeModeSelector({
    required this.mode,
    required this.enabled,
    required this.onChanged,
    this.padding = const EdgeInsets.fromLTRB(16, 8, 16, 4),
    super.key,
  });

  final String mode;
  final bool enabled;
  final ValueChanged<String> onChanged;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final selectedMode = mode == 'meeting' ? 'meeting' : 'conversation';
    return Padding(
      padding: padding,
      child: SegmentedButton<String>(
        showSelectedIcon: false,
        segments: <ButtonSegment<String>>[
          ButtonSegment<String>(
            value: 'conversation',
            label: Text(l10n.talkMode),
          ),
          ButtonSegment<String>(
            value: 'meeting',
            label: Text(l10n.listeningMode),
          ),
        ],
        selected: <String>{selectedMode},
        onSelectionChanged: enabled
            ? (values) {
                if (values.isNotEmpty) onChanged(values.single);
              }
            : null,
      ),
    );
  }
}
