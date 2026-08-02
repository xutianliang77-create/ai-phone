import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/consent_audit_uploader.dart';
import '../../data/compliance_consent_store.dart';
import '../../data/compliance_document.dart';
import 'compliance_consent_visuals.dart';

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
      final visuals = ConsentVisuals.resolve(context);
      return ColoredBox(
        color: visuals.background,
        child: Center(
          child: CircularProgressIndicator(color: visuals.accent),
        ),
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
    final visuals = ConsentVisuals.resolve(context);
    return Scaffold(
      key: const ValueKey('compliance-consent-page'),
      backgroundColor: visuals.background,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 28),
          children: <Widget>[
            Text(
              key: const ValueKey('compliance-consent-title'),
              isChinese ? '首次使用前请确认' : 'Before You Continue',
              style: visuals.largeTitle,
            ),
            const SizedBox(height: 12),
            Text(
              key: const ValueKey('compliance-consent-intro'),
              isChinese
                  ? '请阅读并同意用户协议、隐私政策和语音敏感信息处理说明。'
                  : 'Please review and accept the terms, privacy policy, '
                      'and sensitive voice-processing notice.',
              style: visuals.body,
            ),
            const SizedBox(height: 18),
            _NoticeCard(isChinese: isChinese, visuals: visuals),
            const SizedBox(height: 12),
            DecoratedBox(
              key: const ValueKey('compliance-consent-document-group'),
              decoration: BoxDecoration(
                color: visuals.groupedSurface,
                border: Border.all(color: visuals.separator, width: 0.5),
                borderRadius: BorderRadius.circular(14),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Column(
                  children: <Widget>[
                    _DocumentTile(
                      document: privacy,
                      isChinese: isChinese,
                      visuals: visuals,
                    ),
                    Divider(
                      height: 1,
                      thickness: 0.5,
                      indent: 16,
                      color: visuals.separator,
                    ),
                    _DocumentTile(
                      document: terms,
                      isChinese: isChinese,
                      visuals: visuals,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            CheckboxListTile(
              value: checked,
              activeColor: visuals.accent,
              checkColor: visuals.onAccent,
              side: BorderSide(color: visuals.secondaryText, width: 1.25),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
              onChanged:
                  saving ? null : (value) => onCheckedChanged(value ?? false),
              title: Text(
                isChinese
                    ? '我已阅读并同意《用户协议》和《隐私政策》'
                    : 'I have read and agree to the Terms and Privacy Policy',
                style: visuals.rowTitle,
              ),
              subtitle: Text(
                isChinese
                    ? '未同意前不会进入 App 主功能。'
                    : 'The app experience starts only after acceptance.',
                style: visuals.caption,
              ),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: onAccept,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(50),
                backgroundColor: visuals.accent,
                foregroundColor: visuals.onAccent,
                disabledBackgroundColor: visuals.disabledFill,
                disabledForegroundColor: visuals.tertiaryText,
                textStyle: visuals.action,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
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
  const _NoticeCard({required this.isChinese, required this.visuals});

  final bool isChinese;
  final ConsentVisuals visuals;

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
      key: const ValueKey('compliance-consent-notice'),
      decoration: BoxDecoration(
        color: visuals.groupedSurface,
        border: Border.all(color: visuals.separator, width: 0.5),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: items
              .map(
                (item) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Text('• $item', style: visuals.notice),
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
    required this.visuals,
  });

  final ComplianceDocument document;
  final bool isChinese;
  final ConsentVisuals visuals;

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      tilePadding: const EdgeInsets.symmetric(horizontal: 16),
      childrenPadding: const EdgeInsets.only(bottom: 4),
      backgroundColor: Colors.transparent,
      collapsedBackgroundColor: Colors.transparent,
      iconColor: visuals.secondaryText,
      collapsedIconColor: visuals.secondaryText,
      textColor: visuals.primaryText,
      collapsedTextColor: visuals.primaryText,
      shape: const Border(),
      collapsedShape: const Border(),
      title: Text(
        document.title(isChinese: isChinese),
        style: visuals.rowTitle,
      ),
      subtitle: Text(
        document.subtitle(isChinese: isChinese),
        style: visuals.caption,
      ),
      children: document
          .sections(isChinese: isChinese)
          .map(
            (section) => ListTile(
              contentPadding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              title: Text(section.title, style: visuals.sectionTitle),
              subtitle: Text(section.body, style: visuals.sectionBody),
            ),
          )
          .toList(),
    );
  }
}
