import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/account/data/account_auth_headers.dart';
import 'package:translation_mobile/src/features/billing/data/billing_api_client.dart';
import 'package:translation_mobile/src/features/billing/presentation/pages/wallet_page.dart';
import 'package:translation_mobile/src/platform/billing/purchase_service.dart';

void main() {
  testWidgets('shows balance and activates sandbox purchase',
      (WidgetTester tester) async {
    final client = _FakeBillingApiClient();
    final purchaseService = _FakePurchaseService();
    await tester.pumpWidget(_TestApp(
      child: WalletPage(
        client: client,
        platform: TargetPlatform.iOS,
        purchaseService: purchaseService,
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.textContaining('剩余用量'), findsOneWidget);
    expect(find.text('60 分钟包'), findsOneWidget);

    await tester.tap(find.text('购买'));
    await tester.pumpAndSettle();

    expect(client.createdProductId, 'domestic_credits_60m');
    expect(client.confirmedTransactionId, 'sandbox_txn_test');
    expect(client.confirmedSignedTransactionInfo, 'signed_jws_test');
    expect(purchaseService.finishedTransactionId, 'sandbox_txn_test');
    expect(find.text('支付已确认，权益已更新'), findsOneWidget);
  });

  testWidgets('hides Android purchase action until domestic payments are ready',
      (WidgetTester tester) async {
    final client = _FakeBillingApiClient();
    await tester.pumpWidget(_TestApp(
      child: WalletPage(
        client: client,
        platform: TargetPlatform.android,
        purchaseService: _FakePurchaseService(),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('60 分钟包'), findsOneWidget);
    expect(find.text('暂未开放'), findsOneWidget);
    expect(find.text('购买'), findsNothing);

    await tester.tap(find.text('暂未开放'));
    await tester.pumpAndSettle();

    expect(client.createdProductId, isNull);
    expect(find.text('恢复购买'), findsNothing);
  });

  testWidgets('restores iOS purchases through the billing API',
      (WidgetTester tester) async {
    final client = _FakeBillingApiClient();
    final purchaseService = _FakePurchaseService(
      restoredPurchases: const <PurchaseResult>[
        PurchaseResult(
          status: 'success',
          productId: 'domestic_credits_60m',
          transactionId: 'restored_txn_test',
          signedTransactionInfo: 'restored_signed_jws_test',
        ),
      ],
    );
    await tester.pumpWidget(_TestApp(
      child: WalletPage(
        client: client,
        platform: TargetPlatform.iOS,
        purchaseService: purchaseService,
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('恢复购买'));
    await tester.pumpAndSettle();

    expect(client.createdProductId, 'domestic_credits_60m');
    expect(client.confirmedTransactionId, 'restored_txn_test');
    expect(client.confirmedSignedTransactionInfo, 'restored_signed_jws_test');
    expect(purchaseService.finishedTransactionId, 'restored_txn_test');
    expect(find.text('已恢复购买，权益已更新'), findsOneWidget);
  });

  testWidgets('shows login guidance when wallet requires an account',
      (WidgetTester tester) async {
    await tester.pumpWidget(_TestApp(
      child: WalletPage(
        client: _FakeBillingApiClient(authRequired: true),
        platform: TargetPlatform.iOS,
        purchaseService: _FakePurchaseService(),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('登录后使用在线服务'), findsOneWidget);
    expect(find.text('钱包、余额和账单需要登录后查看。'), findsOneWidget);
    expect(find.text('去登录'), findsOneWidget);
    expect(find.textContaining('需要先登录账号'), findsNothing);
  });
}

class _TestApp extends StatelessWidget {
  const _TestApp({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: child,
    );
  }
}

class _FakeBillingApiClient extends BillingApiClient {
  _FakeBillingApiClient({this.authRequired = false})
      : super(baseUrl: Uri.parse('http://localhost'));

  final bool authRequired;
  String? createdProductId;
  String? confirmedTransactionId;
  String? confirmedSignedTransactionInfo;
  var _remainingSeconds = 300;

  @override
  Future<UsageBalance> fetchBalance() async {
    if (authRequired) throw const AccountAuthRequiredException();
    return UsageBalance(
      planCode: 'free',
      subscribed: false,
      monthlySeconds: 300,
      remainingSeconds: _remainingSeconds,
    );
  }

  @override
  Future<List<BillingProduct>> fetchProducts() async {
    return const <BillingProduct>[
      BillingProduct(
        productId: 'domestic_credits_60m',
        kind: 'credits',
        displayName: '60 分钟包',
        description: '适合通话房间',
        priceCny: 18,
        creditsSeconds: 3600,
        providers: <String>['apple_iap', 'wechat_pay', 'alipay'],
      ),
    ];
  }

  @override
  Future<List<BillingLedgerEntry>> fetchLedger() async {
    if (_remainingSeconds == 300) return const <BillingLedgerEntry>[];
    return <BillingLedgerEntry>[
      BillingLedgerEntry(
        type: 'purchase',
        deltaSeconds: 3600,
        balanceAfter: _remainingSeconds,
        createdAt: DateTime.utc(2026, 7, 3),
        note: '60 分钟包',
      ),
    ];
  }

  @override
  Future<PaymentOrder> createOrder({
    required String productId,
    required String provider,
  }) async {
    createdProductId = productId;
    return PaymentOrder(
      id: 'order_1',
      productId: productId,
      provider: provider,
      status: 'pending',
    );
  }

  @override
  Future<PaymentOrder> confirmOrder({
    required String orderId,
    required String transactionId,
    String? signedTransactionInfo,
  }) async {
    confirmedTransactionId = transactionId;
    confirmedSignedTransactionInfo = signedTransactionInfo;
    _remainingSeconds = 3900;
    return const PaymentOrder(
      id: 'order_1',
      productId: 'domestic_credits_60m',
      provider: 'apple_iap',
      status: 'paid',
    );
  }

  @override
  void close() {}
}

class _FakePurchaseService implements PurchaseService {
  _FakePurchaseService({
    this.restoredPurchases = const <PurchaseResult>[],
  });

  final List<PurchaseResult> restoredPurchases;
  String? finishedTransactionId;

  @override
  Future<List<StoreProduct>> loadProducts(List<String> productIds) async {
    return const <StoreProduct>[];
  }

  @override
  Future<PurchaseResult> purchase(String productId) async {
    return PurchaseResult(
      status: 'success',
      productId: productId,
      transactionId: 'sandbox_txn_test',
      signedTransactionInfo: 'signed_jws_test',
    );
  }

  @override
  Future<List<PurchaseResult>> restorePurchases() async => restoredPurchases;

  @override
  Future<void> finishTransaction(String transactionId) async {
    finishedTransactionId = transactionId;
  }
}
