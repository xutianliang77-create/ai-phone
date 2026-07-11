import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/billing/purchase_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('translation_mobile/purchase');
  final binding = TestDefaultBinaryMessengerBinding.instance;

  tearDown(() {
    binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
  });

  test('loads StoreKit products and finishes a purchase transaction', () async {
    final calls = <String>[];
    binding.defaultBinaryMessenger.setMockMethodCallHandler(channel,
        (call) async {
      calls.add(call.method);
      if (call.method == 'loadProducts') {
        return <Map<String, Object?>>[
          {
            'productId': 'domestic_credits_60m',
            'displayName': '60 分钟包',
            'priceText': '¥18',
          },
        ];
      }
      if (call.method == 'purchase') {
        return <String, Object?>{
          'status': 'success',
          'productId': 'domestic_credits_60m',
          'transactionId': '900000123456789',
          'signedTransactionInfo': 'header.payload.signature',
        };
      }
      if (call.method == 'restorePurchases') {
        return <Map<String, Object?>>[
          {
            'status': 'success',
            'productId': 'domestic_credits_60m',
            'transactionId': '900000123456790',
            'signedTransactionInfo': 'restored.header.payload.signature',
          },
        ];
      }
      if (call.method == 'finishTransaction') return null;
      return null;
    });

    const service = PlatformPurchaseService(channel: channel);
    final products = await service.loadProducts(['domestic_credits_60m']);
    final purchase = await service.purchase('domestic_credits_60m');
    final restored = await service.restorePurchases();
    await service.finishTransaction(purchase.transactionId!);

    expect(products.single.priceText, '¥18');
    expect(purchase.completed, isTrue);
    expect(purchase.signedTransactionInfo, 'header.payload.signature');
    expect(restored.single.transactionId, '900000123456790');
    expect(restored.single.signedTransactionInfo,
        'restored.header.payload.signature');
    expect(calls, [
      'loadProducts',
      'purchase',
      'restorePurchases',
      'finishTransaction',
    ]);
  });
}
