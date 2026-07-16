import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../../platform/translation/supported_translation_language.dart';
import '../realtime_settings_l10n.dart';

enum LanguagePickerKind { source, target }

Future<String?> showTranslationLanguagePicker({
  required BuildContext context,
  required LanguagePickerKind kind,
  required String selectedCode,
  Set<String>? supportedCodes,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) {
      return _TranslationLanguagePicker(
        kind: kind,
        selectedCode: selectedCode,
        supportedCodes: supportedCodes,
      );
    },
  );
}

class _TranslationLanguagePicker extends StatefulWidget {
  const _TranslationLanguagePicker({
    required this.kind,
    required this.selectedCode,
    this.supportedCodes,
  });

  final LanguagePickerKind kind;
  final String selectedCode;
  final Set<String>? supportedCodes;

  @override
  State<_TranslationLanguagePicker> createState() {
    return _TranslationLanguagePickerState();
  }
}

class _TranslationLanguagePickerState
    extends State<_TranslationLanguagePicker> {
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final bottomPadding = MediaQuery.paddingOf(context).bottom;
    final choices = _filteredChoices(context);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + bottomPadding),
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.76,
          child: Column(
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      l10n.languagePickerTitle,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _searchController,
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search),
                  hintText: l10n.searchLanguageHint,
                  border: const OutlineInputBorder(),
                ),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: ListView.builder(
                  itemCount: choices.length,
                  itemBuilder: (context, index) {
                    final choice = choices[index];
                    final selected = choice.code == widget.selectedCode;
                    return ListTile(
                      leading: selected ? const Icon(Icons.check) : null,
                      title: Text(choice.label),
                      subtitle: Text(choice.code),
                      onTap: () => Navigator.of(context).pop(choice.code),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<_LanguageChoice> _filteredChoices(BuildContext context) {
    final query = _searchController.text.trim().toLowerCase();
    final l10n = context.l10n;
    final choices = <_LanguageChoice>[
      if (widget.kind == LanguagePickerKind.source)
        _LanguageChoice(
          autoSourceLanguageCode,
          l10n.autoDetectLanguageLabel,
        ),
      if (widget.kind == LanguagePickerKind.target)
        _LanguageChoice(
          autoReverseTargetLanguageCode,
          l10n.autoReverseTargetLabel,
        ),
      ...supportedHyMtLanguages
          .where((language) =>
              widget.supportedCodes?.contains(language.code) ?? true)
          .map((language) {
        final label =
            l10n.isChinese ? language.chineseName : language.englishName;
        return _LanguageChoice(language.code, label);
      }),
    ];
    if (query.isEmpty) return choices;
    return choices.where((choice) {
      return choice.code.toLowerCase().contains(query) ||
          choice.label.toLowerCase().contains(query);
    }).toList();
  }
}

class _LanguageChoice {
  const _LanguageChoice(this.code, this.label);

  final String code;
  final String label;
}
