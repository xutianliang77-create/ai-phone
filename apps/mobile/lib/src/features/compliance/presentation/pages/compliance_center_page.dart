import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/compliance_document.dart';
import 'compliance_document_page.dart';

class ComplianceCenterPage extends StatelessWidget {
  const ComplianceCenterPage({super.key});

  @override
  Widget build(BuildContext context) {
    final isChinese = context.l10n.isChinese;
    return Scaffold(
      appBar: AppBar(title: Text(isChinese ? '隐私与合规' : 'Privacy & Compliance')),
      body: SafeArea(
        child: ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          itemCount: complianceDocuments.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final document = complianceDocuments[index];
            return ListTile(
              leading: Icon(_iconFor(document.kind)),
              title: Text(document.title(isChinese: isChinese)),
              subtitle: Text(document.subtitle(isChinese: isChinese)),
              trailing: const Icon(Icons.chevron_right),
              contentPadding: EdgeInsets.zero,
              onTap: () => _openDocument(context, document),
            );
          },
        ),
      ),
    );
  }

  void _openDocument(BuildContext context, ComplianceDocument document) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ComplianceDocumentPage(document: document),
      ),
    );
  }

  IconData _iconFor(ComplianceDocumentKind kind) {
    return switch (kind) {
      ComplianceDocumentKind.privacy => Icons.privacy_tip_outlined,
      ComplianceDocumentKind.terms => Icons.description_outlined,
      ComplianceDocumentKind.account => Icons.support_agent_outlined,
      ComplianceDocumentKind.providers => Icons.hub_outlined,
      ComplianceDocumentKind.permissions => Icons.security_outlined,
    };
  }
}
