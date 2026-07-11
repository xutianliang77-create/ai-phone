import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/consent_audit_uploader.dart';
import '../../data/compliance_consent_store.dart';
import '../../data/compliance_document.dart';

class ComplianceConsentGate extends StatefulWidget {
  const ComplianceConsentGate({
    required this.store,
    required this.child,
    this.consentAuditUploader,
    super.key,
  });

  final ComplianceConsentStore store;
  final Widget child;
  final ConsentAuditUploader? consentAuditUploader;

  @override
  State<ComplianceConsentGate> createState() => _ComplianceConsentGateState();
}

class _ComplianceConsentGateState extends State<ComplianceConsentGate> {
  bool? _accepted;
  bool _checked = false;
  bool _saving = false;
  late final ConsentAuditUploader _consentAuditUploader;

  @override
  void initState() {
    super.initState();
    _consentAuditUploader = widget.consentAuditUploader ??
        AccountConsentAuditUploader.fromEnvironment();
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final accepted = _accepted;
    if (accepted == null) {
      return const ColoredBox(
        color: Color(0xffeef6f4),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (accepted) return widget.child;
    return _ConsentPage(
      checked: _checked,
      saving: _saving,
      onCheckedChanged: (value) => setState(() => _checked = value),
      onAccept: _checked && !_saving ? _accept : null,
    );
  }

  Future<void> _load() async {
    final record = await widget.store.load();
    if (!mounted) return;
    setState(() => _accepted = record?.version == complianceConsentVersion);
  }

  Future<void> _accept() async {
    setState(() => _saving = true);
    await widget.store.accept(complianceConsentVersion);
    final record = await widget.store.load();
    if (mounted) {
      await _consentAuditUploader.record(
        consentType: 'initial_privacy',
        version: complianceConsentVersion,
        scene: 'app_start',
        acceptedAtIso: record?.acceptedAtIso,
        locale: Localizations.localeOf(context),
      );
    }
    if (!mounted) return;
    setState(() {
      _saving = false;
      _accepted = true;
    });
  }
}

class _ConsentPage extends StatelessWidget {
  const _ConsentPage({
    required this.checked,
    required this.saving,
    required this.onCheckedChanged,
    required this.onAccept,
  });

  final bool checked;
  final bool saving;
  final ValueChanged<bool> onCheckedChanged;
  final VoidCallback? onAccept;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isChinese = l10n.isChinese;
    final privacy = complianceDocument(ComplianceDocumentKind.privacy);
    final terms = complianceDocument(ComplianceDocumentKind.terms);
    return Scaffold(
      backgroundColor: const Color(0xffeef6f4),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 28),
          children: <Widget>[
            Text(
              isChinese ? '首次使用前请确认' : 'Before You Continue',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 12),
            Text(
              isChinese
                  ? '请阅读并同意用户协议、隐私政策和语音敏感信息处理说明。'
                  : 'Please review and accept the terms, privacy policy, '
                      'and sensitive voice-processing notice.',
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const SizedBox(height: 18),
            _NoticeCard(isChinese: isChinese),
            const SizedBox(height: 12),
            _DocumentTile(document: privacy, isChinese: isChinese),
            _DocumentTile(document: terms, isChinese: isChinese),
            const SizedBox(height: 12),
            CheckboxListTile(
              value: checked,
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
              onChanged:
                  saving ? null : (value) => onCheckedChanged(value ?? false),
              title: Text(
                isChinese
                    ? '我已阅读并同意《用户协议》和《隐私政策》'
                    : 'I have read and agree to the Terms and Privacy Policy',
              ),
              subtitle: Text(
                isChinese
                    ? '未同意前不会进入 App 主功能。'
                    : 'The app experience starts only after acceptance.',
              ),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: onAccept,
              child: Text(saving
                  ? (isChinese ? '正在保存' : 'Saving')
                  : (isChinese ? '同意并继续' : 'Accept and Continue')),
            ),
          ],
        ),
      ),
    );
  }
}

class _NoticeCard extends StatelessWidget {
  const _NoticeCard({required this.isChinese});

  final bool isChinese;

  @override
  Widget build(BuildContext context) {
    final items = isChinese
        ? const <String>[
            '端侧同传可在本地运行；在线同传、Call Link、PSTN 和 AI Agent 会使用云端服务。',
            '麦克风音频、字幕和译文属于敏感数据，首次使用云端语音能力前还会再次单独确认。',
            '同意前不初始化非必要 SDK；你可以在“我的 - 隐私与合规”查看和删除记录。',
          ]
        : const <String>[
            'On-device translation can run locally; online translation, Call Link, PSTN, and AI Agent use cloud services.',
            'Microphone audio, captions, and translations are sensitive data. Cloud voice features ask for separate consent before use.',
            'Non-essential SDKs are not initialized before consent. Records can be reviewed or deleted from Privacy & Compliance.',
          ];
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xffcfdcda)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: items
              .map(
                (item) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text('• $item'),
                ),
              )
              .toList(),
        ),
      ),
    );
  }
}

class _DocumentTile extends StatelessWidget {
  const _DocumentTile({
    required this.document,
    required this.isChinese,
  });

  final ComplianceDocument document;
  final bool isChinese;

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      title: Text(document.title(isChinese: isChinese)),
      subtitle: Text(document.subtitle(isChinese: isChinese)),
      children: document
          .sections(isChinese: isChinese)
          .map(
            (section) => ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(section.title),
              subtitle: Text(section.body),
            ),
          )
          .toList(),
    );
  }
}
