import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/compliance/data/compliance_document.dart';

void main() {
  test('on-device privacy r2 explains backup and existing copies in both languages', () {
    expect(onDevicePrivacyVersion, 'wujie-v10-device-privacy-r2');
    final privacy=onDeviceComplianceDocuments.firstWhere((d)=>d.kind==ComplianceDocumentKind.privacy);
    final zh=privacy.zhSections.map((s)=>s.body).join('\n');
    final en=privacy.enSections.map((s)=>s.body).join('\n');
    expect(zh,contains('可能包含在 iCloud 或电脑备份'));
    expect(zh,contains('不会自动删除已有备份里的副本'));
    expect(en,contains('may be included in iCloud or computer backups'));
    expect(en,contains('does not automatically remove existing backup copies'));
    expect(zh,contains('不包括原文和译文'));
  });
}
