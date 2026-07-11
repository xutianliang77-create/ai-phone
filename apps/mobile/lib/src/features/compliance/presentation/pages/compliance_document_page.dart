import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/compliance_document.dart';

class ComplianceDocumentPage extends StatelessWidget {
  const ComplianceDocumentPage({
    required this.document,
    super.key,
  });

  final ComplianceDocument document;

  @override
  Widget build(BuildContext context) {
    final isChinese = context.l10n.isChinese;
    final sections = document.sections(isChinese: isChinese);
    return Scaffold(
      appBar: AppBar(title: Text(document.title(isChinese: isChinese))),
      body: SafeArea(
        child: ListView.separated(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          itemCount: sections.length + 1,
          separatorBuilder: (_, __) => const SizedBox(height: 20),
          itemBuilder: (context, index) {
            if (index == 0) {
              return Text(
                document.subtitle(isChinese: isChinese),
                style: Theme.of(context).textTheme.bodyLarge,
              );
            }
            final section = sections[index - 1];
            return _ComplianceSectionView(section: section);
          },
        ),
      ),
    );
  }
}

class _ComplianceSectionView extends StatelessWidget {
  const _ComplianceSectionView({required this.section});

  final ComplianceSection section;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(section.title, style: textTheme.titleMedium),
        const SizedBox(height: 8),
        Text(section.body, style: textTheme.bodyMedium),
        if (section.actionValue != null) ...[
          const SizedBox(height: 10),
          OutlinedButton.icon(
            icon: const Icon(Icons.copy, size: 18),
            label: Text(_copyLabel(context, section.actionValue!)),
            onPressed: () => _copyAction(context, section.actionValue!),
          ),
        ],
      ],
    );
  }

  String _copyLabel(BuildContext context, String value) {
    if (value.startsWith('http')) {
      return context.l10n.isChinese ? '复制链接' : 'Copy link';
    }
    if (value.contains('@')) {
      return context.l10n.isChinese ? '复制邮箱' : 'Copy email';
    }
    return context.l10n.isChinese ? '复制' : 'Copy';
  }

  void _copyAction(BuildContext context, String value) {
    Clipboard.setData(ClipboardData(text: value)).catchError((_) {});
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.l10n.isChinese ? '已复制' : 'Copied')),
    );
  }
}
