import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:translation_mobile/src/app/app.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/app/theme.dart';
import 'package:translation_mobile/src/features/compliance/data/compliance_consent_store.dart';
import 'package:translation_mobile/src/features/compliance/data/consent_audit_uploader.dart';
import 'package:translation_mobile/src/features/compliance/presentation/pages/compliance_consent_gate.dart';

void main() {
  testWidgets('blocks app shell until initial compliance consent is accepted',
      (WidgetTester tester) async {
    final store = MemoryComplianceConsentStore();
    final uploader = _FakeConsentAuditUploader();
    await tester.pumpWidget(TranslationApp(
      complianceConsentStore: store,
      consentAuditUploader: uploader,
    ));
    await tester.pumpAndSettle();

    expect(find.text('首次使用前请确认'), findsOneWidget);
    expect(find.text('同意并继续'), findsOneWidget);
    expect(find.text('开始'), findsNothing);

    final acceptButton = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, '同意并继续'),
    );
    expect(acceptButton.onPressed, isNull);

    await tester.tap(find.textContaining('我已阅读并同意'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '同意并继续'));
    await tester.pumpAndSettle();

    expect(store.record?.version, complianceConsentVersion);
    expect(uploader.records.single.consentType, 'initial_privacy');
    expect(uploader.records.single.scene, 'app_start');
    expect(find.text('无界AI'), findsNothing);
    expect(find.text('开始'), findsOneWidget);
  });

  testWidgets('uses Apple typography and dynamic colors on iOS',
      (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      theme: buildAppTheme().copyWith(platform: TargetPlatform.iOS),
      home: ComplianceConsentGate(
        store: MemoryComplianceConsentStore(),
        consentAuditUploader: _FakeConsentAuditUploader(),
        child: const SizedBox.shrink(),
      ),
    ));
    await tester.pumpAndSettle();

    final titleFinder = find.byKey(
      const ValueKey('compliance-consent-title'),
    );
    final titleContext = tester.element(titleFinder);
    final title = tester.widget<Text>(titleFinder);
    final cupertinoText = CupertinoTheme.of(titleContext).textTheme;
    expect(
      title.style?.fontFamily,
      cupertinoText.navLargeTitleTextStyle.fontFamily,
    );
    expect(
      title.style?.color,
      CupertinoDynamicColor.resolve(CupertinoColors.label, titleContext),
    );
    final page = tester.widget<Scaffold>(
      find.byKey(const ValueKey('compliance-consent-page')),
    );
    expect(
      page.backgroundColor,
      CupertinoDynamicColor.resolve(
        CupertinoColors.systemGroupedBackground,
        titleContext,
      ),
    );
    final notice = tester.widget<DecoratedBox>(
      find.byKey(const ValueKey('compliance-consent-notice')),
    );
    expect(
      (notice.decoration as BoxDecoration).color,
      CupertinoDynamicColor.resolve(
        CupertinoColors.secondarySystemGroupedBackground,
        titleContext,
      ),
    );
    expect(
      tester
          .widget<CheckboxListTile>(find.byType(CheckboxListTile))
          .activeColor,
      CupertinoDynamicColor.resolve(CupertinoColors.systemBlue, titleContext),
    );
  });
}

class _FakeConsentAuditUploader implements ConsentAuditUploader {
  final records = <({String consentType, String scene})>[];

  @override
  Future<void> record({
    required String consentType,
    required String version,
    required String scene,
    required Locale locale,
    String? acceptedAtIso,
  }) async {
    records.add((consentType: consentType, scene: scene));
  }
}
