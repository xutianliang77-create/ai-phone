import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../../platform/translation/mobile_translation_provider.dart';
import 'core_ml_nemotron_diagnostics_widgets.dart';

class TranslationAvailabilityRows extends StatelessWidget {
  const TranslationAvailabilityRows({required this.availability, super.key});

  final MobileTranslationAvailability? availability;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final availability = this.availability;
    if (availability == null) {
      return ListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(l10n.notChecked),
      );
    }
    return Column(
      children: <Widget>[
        StatusRow(
          label: l10n.diagnosticsLabel('translation.available'),
          value: availability.available ? l10n.ready : l10n.notReady,
        ),
        StatusRow(
          label: l10n.diagnosticsLabel('translation.provider'),
          value: l10n.diagnosticsValue(availability.provider),
        ),
        StatusRow(
          label: l10n.diagnosticsLabel('translation.sourceLanguage'),
          value: l10n.diagnosticsValue(availability.sourceLanguage),
        ),
        StatusRow(
          label: l10n.diagnosticsLabel('translation.targetLanguage'),
          value: l10n.diagnosticsValue(availability.targetLanguage),
        ),
        StatusRow(
          label: l10n.diagnosticsLabel('translation.status'),
          value: l10n.diagnosticsValue(availability.status),
        ),
        StatusRow(
          label: l10n.diagnosticsLabel('translation.reason'),
          value: l10n.diagnosticsValue(availability.reason),
        ),
        if (availability.message != null)
          StatusRow(
            label: l10n.diagnosticsLabel('translation.message'),
            value: l10n.runtimeMessage(availability.message!),
          ),
      ],
    );
  }
}
