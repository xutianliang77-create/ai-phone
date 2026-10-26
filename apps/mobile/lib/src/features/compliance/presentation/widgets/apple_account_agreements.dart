import 'package:flutter/material.dart';
import '../../data/compliance_document.dart';
import '../../../account/data/account_session_store.dart';
import '../pages/compliance_document_page.dart';

Future<bool> confirmAppleAgreements(BuildContext context) async {
  if (configuredPrivacyVersion != selfHostedPrivacyVersion ||
      configuredTermsVersion != selfHostedTermsVersion) {
    await showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('协议暂不可用'),
        content: const Text('当前协议版本尚未准备好，请稍后再试。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const Text('知道了'),
          ),
        ],
      ),
    );
    return false;
  }
  var privacyRead = false, termsRead = false, accepted = false;
  return await showDialog<bool>(
        context: context,
        builder: (dialog) => StatefulBuilder(
          builder: (dialog, setState) => AlertDialog(
            title: const Text('登录前确认'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Apple 用于验证身份。账号、授权与用量由无界 AI 的服务端处理。请阅读当前隐私政策和服务协议。',
                  ),
                  TextButton(
                    onPressed: () async {
                      await Navigator.of(dialog).push(
                        MaterialPageRoute<void>(
                          builder: (_) => ComplianceDocumentPage(
                            document: complianceDocuments.firstWhere(
                              (d) => d.kind == ComplianceDocumentKind.privacy,
                            ),
                          ),
                        ),
                      );
                      if (dialog.mounted) setState(() => privacyRead = true);
                    },
                    child: const Text('阅读隐私政策'),
                  ),
                  TextButton(
                    onPressed: () async {
                      await Navigator.of(dialog).push(
                        MaterialPageRoute<void>(
                          builder: (_) => ComplianceDocumentPage(
                            document: complianceDocuments.firstWhere(
                              (d) => d.kind == ComplianceDocumentKind.terms,
                            ),
                          ),
                        ),
                      );
                      if (dialog.mounted) setState(() => termsRead = true);
                    },
                    child: const Text('阅读服务协议'),
                  ),
                  CheckboxListTile(
                    value: accepted,
                    onChanged: privacyRead && termsRead
                        ? (v) => setState(() => accepted = v ?? false)
                        : null,
                    title: const Text('我已阅读并同意'),
                    controlAffinity: ListTileControlAffinity.leading,
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialog, false),
                child: const Text('取消'),
              ),
              FilledButton(
                onPressed: privacyRead && termsRead && accepted
                    ? () => Navigator.pop(dialog, true)
                    : null,
                child: const Text('同意并继续'),
              ),
            ],
          ),
        ),
      ) ??
      false;
}
