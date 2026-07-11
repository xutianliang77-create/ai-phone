import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app.dart';
import 'package:translation_mobile/src/features/compliance/data/compliance_consent_store.dart';

void main() {
  testWidgets('subtitle workspace grows with available page height',
      (tester) async {
    _configureView(tester, const Size(390, 700));
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await _pumpApp(tester);
    final workspace = find.byKey(const ValueKey('realtime-subtitle-workspace'));
    final shortHeight = tester.getSize(workspace).height;

    tester.view.physicalSize = const Size(390, 850);
    await tester.pump();
    final tallHeight = tester.getSize(workspace).height;

    expect(tallHeight, greaterThan(shortHeight + 100));
  });

  testWidgets('realtime page fits a 320dp phone width', (tester) async {
    _configureView(tester, const Size(320, 568));
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await _pumpApp(tester);

    expect(tester.takeException(), isNull);
    expect(find.byKey(const ValueKey('realtime-subtitle-workspace')),
        findsOneWidget);
  });

  testWidgets('realtime page fits landscape without fixed subtitle height',
      (tester) async {
    _configureView(tester, const Size(844, 390));
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await _pumpApp(tester);

    expect(tester.takeException(), isNull);
    expect(find.byKey(const ValueKey('realtime-subtitle-workspace')),
        findsOneWidget);
  });
}

void _configureView(WidgetTester tester, Size size) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
}

Future<void> _pumpApp(WidgetTester tester) async {
  await tester.pumpWidget(TranslationApp(
    complianceConsentStore: MemoryComplianceConsentStore.accepted(),
  ));
  await tester.pump();
}
