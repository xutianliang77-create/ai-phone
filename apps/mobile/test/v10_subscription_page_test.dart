import 'package:flutter/material.dart';
import 'dart:async';
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
  testWidgets('retry replaces the old error while the new lookup is loading', (t) async {
    final client = _RetryClient();
    await t.pumpWidget(MaterialApp(home: SubscriptionPage(client: client)));
    await t.pumpAndSettle();
    expect(find.text('重新核对'), findsOneWidget);
    await t.tap(find.text('重新核对'));
    await t.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('重新核对'), findsNothing);
    client.result.complete({'entitlement': {'valid': false},
      'product': {'trialEligible': false, 'priceText': '¥10.00'}});
    await t.pumpAndSettle();
    expect(find.text('确认订阅 ¥10/月'), findsOneWidget);
  });
  testWidgets('independent offer diagnosis is QA-only and never initiates a purchase', (t) async {
    final client = _RetryClient();
    await t.pumpWidget(MaterialApp(home: SubscriptionPage(client: client)));
    await t.pumpAndSettle();
    final diagnostic = find.text('检查商店试用信息（仅测试）');
    if (const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') != 'A13_QA') {
      expect(diagnostic, findsNothing);
      expect(client.diagnoses, 0);
      return;
    }
    expect(diagnostic, findsOneWidget);
    await t.tap(diagnostic);
    await t.pumpAndSettle();
    expect(client.diagnoses, 1);
    expect(client.purchases, 0);
    expect(client.count, 1);
    expect(find.text('检查已结束。'), findsOneWidget);
  });
  testWidgets('an unresolved Apple approval disables a second purchase', (t) async {
    final c = _Client(true, pending: true);
    await t.pumpWidget(MaterialApp(home: SubscriptionPage(client: c)));
    await t.pumpAndSettle();
    expect(t.widget<FilledButton>(find.widgetWithText(FilledButton, '等待 Apple 处理')).onPressed, isNull);
    expect(c.purchases, 0);
    await t.tap(find.text('Apple 已拒绝该请求'));
    await t.pumpAndSettle();
    expect(find.textContaining('若判断错误'), findsOneWidget);
    await t.tap(find.text('已确认拒绝'));
    await t.pumpAndSettle();
    expect(c.clears, 1);
    expect(c.purchases, 0);
  });
}

class _Client implements OnDeviceSubscriptionClient {
  _Client(this.eligible, {this.status, this.pending = false});
  final bool eligible;
  final String? status;
  bool pending;
  int purchases = 0;
  int clears = 0;
  int diagnoses = 0;
  @override
  OnDeviceLicenseClient get control =>
      throw UnimplementedError('not used by widget fixture');
  @override
  MethodChannel get channel => const MethodChannel('fixture/not-invoked');
  @override
  Future<Map<String, Object?>> load() async => {
    'entitlement': {'valid': false, 'status': status},
    'product': {'trialEligible': eligible, 'priceText': '¥10.00', 'pendingApproval': pending},
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
  Future<void> diagnoseStoreOffer() async { diagnoses++; }
  @override
  Future<String> recoverPending() async => 'restored';
  @override
  Future<String> clearPendingApproval({required bool userConfirmedDecline}) async {
    if (!userConfirmedDecline) throw StateError('confirmation');
    clears++; pending = false; return 'cleared';
  }
  @override
  Future<void> manage() async {}
}

class _RetryClient extends _Client {
  _RetryClient():super(false);
  int count=0;
  final result=Completer<Map<String,Object?>>();
  @override Future<Map<String,Object?>> load() {
    if(count++==0) return Future.error(StateError('fixture'));
    return result.future;
  }
}
