import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/billing/data/on_device_subscription_client.dart';
import 'package:translation_mobile/src/features/billing/presentation/pages/subscription_page.dart';
import 'package:translation_mobile/src/platform/license/on_device_license.dart';

void main() {
  testWidgets(
    'ineligible customers see the actual monthly price and cancellation never purchases',
    (t) async {
      final c = _Client(false);
      await t.pumpWidget(MaterialApp(home: SubscriptionPage(client: c)));
      await t.pumpAndSettle();
      expect(find.text('确认订阅并试用7天'), findsNothing);
      expect(find.text('确认订阅 ¥10/月'), findsOneWidget);
      await t.tap(find.text('确认订阅 ¥10/月'));
      await t.pumpAndSettle();
      expect(c.purchases, 0);
      expect(find.textContaining('当前不享有免费试用，将按¥10/月自动续订'), findsOneWidget);
      await t.tap(find.text('取消'));
      await t.pumpAndSettle();
      expect(c.purchases, 0);
    },
  );
  testWidgets(
    'eligible trial still requires explicit confirmation and has restore and terms controls',
    (t) async {
      final c = _Client(true);
      await t.pumpWidget(MaterialApp(home: SubscriptionPage(client: c)));
      await t.pumpAndSettle();
      expect(find.text('确认订阅并试用7天'), findsOneWidget);
      await t.tap(find.text('确认订阅并试用7天'));
      await t.pumpAndSettle();
      expect(c.purchases, 0);
      await t.tap(find.text('继续'));
      await t.pumpAndSettle();
      expect(c.purchases, 1);
      expect(find.text('恢复购买'), findsOneWidget);
      expect(find.text('隐私政策'), findsOneWidget);
      expect(find.text('用户协议'), findsOneWidget);
    },
  );
  testWidgets(
    'unknown existing subscription status offers recovery instead of another purchase',
    (t) async {
      final c = _Client(false, status: 'verification_required');
      await t.pumpWidget(MaterialApp(home: SubscriptionPage(client: c)));
      await t.pumpAndSettle();
      final button = t.widget<FilledButton>(
        find.widgetWithText(FilledButton, '请先同步或恢复购买'),
      );
      expect(button.onPressed, null);
      expect(c.purchases, 0);
    },
  );
}

class _Client implements OnDeviceSubscriptionClient {
  _Client(this.eligible, {this.status});
  final bool eligible;
  final String? status;
  int purchases = 0;
  @override
  OnDeviceLicenseClient get control =>
      throw UnimplementedError('not used by widget fixture');
  @override
  MethodChannel get channel => const MethodChannel('fixture/not-invoked');
  @override
  Future<Map<String, Object?>> load() async => {
    'entitlement': {'valid': false, 'status': status},
    'product': {'trialEligible': eligible, 'priceText': '¥10.00'},
  };
  @override
  Future<String> purchase({
    required bool trialEligible,
    required bool consent,
  }) async {
    if (!consent) throw StateError('consent');
    purchases++;
    return 'cancelled';
  }

  @override
  Future<String> restore() async => 'restored';
  @override
  Future<String> recoverPending() async => 'restored';
  @override
  Future<void> manage() async {}
}
