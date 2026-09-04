import 'package:flutter/material.dart';

import '../../../../platform/translation/supported_translation_language.dart';

class PstnCallLanguageField extends StatelessWidget {
  const PstnCallLanguageField({
    required this.label,
    required this.value,
    required this.chinese,
    required this.onChanged,
    super.key,
  });

  final String label;
  final String value;
  final bool chinese;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: supportedHyMtLanguages
          .where((language) => language.code == 'zh' || language.code == 'en')
          .map((language) => DropdownMenuItem<String>(
                value: language.code,
                child: Text(
                  chinese ? language.chineseName : language.englishName,
                  overflow: TextOverflow.ellipsis,
                ),
              ))
          .toList(growable: false),
      onChanged: (next) {
        if (next != null) onChanged(next);
      },
    );
  }
}
