part 'self_hosted_compliance_documents.dart';
part 'legacy_compliance_documents.dart';
part 'on_device_compliance_documents.dart';

enum ComplianceDocumentKind { privacy, terms, account, providers, permissions }

class ComplianceDocument {
  const ComplianceDocument({
    required this.kind,
    required this.zhTitle,
    required this.enTitle,
    required this.zhSubtitle,
    required this.enSubtitle,
    required this.zhSections,
    required this.enSections,
  });

  final ComplianceDocumentKind kind;
  final String zhTitle;
  final String enTitle;
  final String zhSubtitle;
  final String enSubtitle;
  final List<ComplianceSection> zhSections;
  final List<ComplianceSection> enSections;

  String title({required bool isChinese}) => isChinese ? zhTitle : enTitle;

  String subtitle({required bool isChinese}) {
    return isChinese ? zhSubtitle : enSubtitle;
  }

  List<ComplianceSection> sections({required bool isChinese}) {
    return isChinese ? zhSections : enSections;
  }
}

class ComplianceSection {
  const ComplianceSection({
    required this.title,
    required this.body,
    this.actionValue,
  });

  final String title;
  final String body;
  final String? actionValue;
}

const complianceDocuments =
    String.fromEnvironment('WUJIE_EXECUTION_MODE') == 'on_device' ? onDeviceComplianceDocuments :
    (String.fromEnvironment('ACCOUNT_CONTROL_BACKEND') == 'self_hosted' ||
        String.fromEnvironment('ACCOUNT_CONTROL_BACKEND') == 'cloudflare')
    ? selfHostedComplianceDocuments
    : _legacyComplianceDocuments;
