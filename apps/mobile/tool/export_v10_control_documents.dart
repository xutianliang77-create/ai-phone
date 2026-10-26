import 'dart:convert';
import 'dart:io';
import 'package:translation_mobile/src/features/compliance/data/compliance_document.dart';

void main(List<String> args) {
  final set = {
    'schemaVersion': 1,
    'revision': 'wujie-v10-control-documents-r1',
    'privacyVersion': selfHostedPrivacyVersion,
    'termsVersion': selfHostedTermsVersion,
    'origin': 'https://www.beelinkdata.com',
    'legalEntity': '北京乾坤祥云科技有限公司',
    'supportEmail': '1397343951@qq.com',
    'approvalRef': null,
    'documents': selfHostedComplianceDocuments
        .map(
          (d) => {
            'kind': d.kind.name,
            'zhTitle': d.zhTitle,
            'enTitle': d.enTitle,
            'zhSubtitle': d.zhSubtitle,
            'enSubtitle': d.enSubtitle,
            'zhSections': d.zhSections
                .map(
                  (s) => {
                    'title': s.title,
                    'body': s.body,
                    if (s.actionValue != null) 'actionValue': s.actionValue,
                  },
                )
                .toList(),
            'enSections': d.enSections
                .map(
                  (s) => {
                    'title': s.title,
                    'body': s.body,
                    if (s.actionValue != null) 'actionValue': s.actionValue,
                  },
                )
                .toList(),
          },
        )
        .toList(),
  };
  File(args.single).writeAsStringSync(jsonEncode(set));
}
