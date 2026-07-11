import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/billing/data/billing_api_client.dart';

void main() {
  test('loads balance, products, ledger, and confirms sandbox orders',
      () async {
    final seenPaths = <String>[];
    Map<String, Object?>? confirmBody;
    final client = BillingApiClient(
      baseUrl: Uri.parse('http://127.0.0.1:3100'),
      accountSessionStore: _sessionStore(),
      client: MockClient((request) async {
        seenPaths.add('${request.method} ${request.url.path}');
        if (request.url.path != '/billing/products') {
          expect(request.headers['authorization'], 'Bearer test-token');
        }
        if (request.url.path == '/usage/balance') {
          return _json({
            'planCode': 'free',
            'subscribed': false,
            'monthlySeconds': 300,
            'remainingSeconds': 3900,
          });
        }
        if (request.url.path == '/billing/products') {
          return _json({
            'products': [_productJson()],
          });
        }
        if (request.url.path == '/billing/ledger') {
          return _json({
            'ledger': [
              {
                'type': 'purchase',
                'deltaSeconds': 3600,
                'balanceAfter': 3900,
                'createdAt': '2026-07-03T00:00:00.000Z',
                'note': '60 分钟包',
              }
            ],
          });
        }
        if (request.url.path == '/billing/orders') {
          return _json({
            'order': {
              'id': 'order_1',
              'productId': 'domestic_credits_60m',
              'provider': 'apple_iap',
              'status': 'pending',
            },
          });
        }
        if (request.url.path == '/billing/orders/order_1/confirm') {
          confirmBody = jsonDecode(request.body) as Map<String, Object?>;
          return _json({
            'order': {
              'id': 'order_1',
              'productId': 'domestic_credits_60m',
              'provider': 'apple_iap',
              'status': 'paid',
            },
          });
        }
        return http.Response('not found', 404);
      }),
    );

    final balance = await client.fetchBalance();
    final products = await client.fetchProducts();
    final ledger = await client.fetchLedger();
    final order = await client.createOrder(
      productId: 'domestic_credits_60m',
      provider: 'apple_iap',
    );
    final confirmed = await client.confirmOrder(
      orderId: order.id,
      transactionId: 'sandbox_txn_1',
      signedTransactionInfo: 'signed_jws_1',
    );

    expect(balance.remainingSeconds, 3900);
    expect(products.single.displayName, '60 分钟包');
    expect(ledger.single.deltaSeconds, 3600);
    expect(confirmed.status, 'paid');
    expect(confirmBody, {
      'transactionId': 'sandbox_txn_1',
      'signedTransactionInfo': 'signed_jws_1',
    });
    expect(seenPaths, contains('POST /billing/orders/order_1/confirm'));
  });
}

MemoryAccountSessionStore _sessionStore() {
  return MemoryAccountSessionStore(
    const AccountSession(
      token: 'test-token',
      expiresAtIso: '2026-07-07T00:00:00.000Z',
    ),
  );
}

http.Response _json(Map<String, Object?> body) {
  return http.Response(
    jsonEncode(body),
    200,
    headers: const {'content-type': 'application/json'},
  );
}

Map<String, Object?> _productJson() {
  return {
    'productId': 'domestic_credits_60m',
    'kind': 'credits',
    'displayName': '60 分钟包',
    'description': '适合通话房间',
    'priceCny': 18,
    'creditsSeconds': 3600,
    'providers': ['apple_iap'],
  };
}
