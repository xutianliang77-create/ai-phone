import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../account/data/account_auth_headers.dart';
import '../../account/data/account_session_store.dart';

class UsageBalance {
  const UsageBalance({
    required this.planCode,
    required this.subscribed,
    required this.monthlySeconds,
    required this.remainingSeconds,
  });

  final String planCode;
  final bool subscribed;
  final int monthlySeconds;
  final int remainingSeconds;

  factory UsageBalance.fromJson(Map<String, Object?> json) {
    return UsageBalance(
      planCode: json['planCode']! as String,
      subscribed: json['subscribed']! as bool,
      monthlySeconds: json['monthlySeconds']! as int,
      remainingSeconds: json['remainingSeconds']! as int,
    );
  }
}

class BillingProduct {
  const BillingProduct({
    required this.productId,
    required this.kind,
    required this.displayName,
    required this.description,
    required this.priceCny,
    required this.creditsSeconds,
    required this.providers,
  });

  final String productId;
  final String kind;
  final String displayName;
  final String description;
  final int priceCny;
  final int creditsSeconds;
  final List<String> providers;

  factory BillingProduct.fromJson(Map<String, Object?> json) {
    return BillingProduct(
      productId: json['productId']! as String,
      kind: json['kind']! as String,
      displayName: json['displayName']! as String,
      description: json['description']! as String,
      priceCny: json['priceCny']! as int,
      creditsSeconds: json['creditsSeconds']! as int,
      providers: (json['providers'] as List).whereType<String>().toList(),
    );
  }
}

class PaymentOrder {
  const PaymentOrder({
    required this.id,
    required this.productId,
    required this.provider,
    required this.status,
  });

  final String id;
  final String productId;
  final String provider;
  final String status;

  factory PaymentOrder.fromJson(Map<String, Object?> json) {
    return PaymentOrder(
      id: json['id']! as String,
      productId: json['productId']! as String,
      provider: json['provider']! as String,
      status: json['status']! as String,
    );
  }
}

class BillingLedgerEntry {
  const BillingLedgerEntry({
    required this.type,
    required this.deltaSeconds,
    required this.balanceAfter,
    required this.createdAt,
    this.note,
  });

  final String type;
  final int deltaSeconds;
  final int balanceAfter;
  final DateTime createdAt;
  final String? note;

  factory BillingLedgerEntry.fromJson(Map<String, Object?> json) {
    return BillingLedgerEntry(
      type: json['type']! as String,
      deltaSeconds: json['deltaSeconds']! as int,
      balanceAfter: json['balanceAfter']! as int,
      createdAt: DateTime.parse(json['createdAt']! as String),
      note: json['note'] as String?,
    );
  }
}

class BillingApiClient {
  BillingApiClient({
    required Uri baseUrl,
    http.Client? client,
    AccountSessionStore? accountSessionStore,
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client(),
        _accountSessionStore = accountSessionStore ?? accountStoreForDeployment(baseUrl);

  final Uri _baseUrl;
  final http.Client _client;
  final AccountSessionStore _accountSessionStore;

  Future<UsageBalance> fetchBalance() async {
    final json = await _getJson('/usage/balance', authenticated: true);
    return UsageBalance.fromJson(json);
  }

  Future<List<BillingProduct>> fetchProducts() async {
    final json = await _getJson('/billing/products');
    return (json['products'] as List)
        .map((item) => BillingProduct.fromJson(_objectMap(item)))
        .toList();
  }

  Future<List<BillingLedgerEntry>> fetchLedger() async {
    final json = await _getJson('/billing/ledger', authenticated: true);
    return (json['ledger'] as List)
        .map((item) => BillingLedgerEntry.fromJson(_objectMap(item)))
        .toList();
  }

  Future<PaymentOrder> createOrder({
    required String productId,
    required String provider,
  }) async {
    final json = await _postJson(
      '/billing/orders',
      <String, Object?>{
        'productId': productId,
        'provider': provider,
      },
      authenticated: true,
    );
    return PaymentOrder.fromJson(_objectMap(json['order']));
  }

  Future<PaymentOrder> confirmOrder({
    required String orderId,
    required String transactionId,
    String? signedTransactionInfo,
  }) async {
    final json = await _postJson(
      '/billing/orders/$orderId/confirm',
      <String, Object?>{
        'transactionId': transactionId,
        if (signedTransactionInfo != null)
          'signedTransactionInfo': signedTransactionInfo,
      },
      authenticated: true,
    );
    return PaymentOrder.fromJson(_objectMap(json['order']));
  }

  void close() {
    _client.close();
  }

  Future<Map<String, Object?>> _getJson(
    String path, {
    bool authenticated = false,
  }) async {
    final response = await _client.get(
      _baseUrl.resolve(path),
      headers: authenticated ? await _authHeaders() : null,
    );
    return _decodeResponse(response);
  }

  Future<Map<String, Object?>> _postJson(
    String path,
    Map<String, Object?> body, {
    bool authenticated = false,
  }) async {
    final response = await _client.post(
      _baseUrl.resolve(path),
      headers: authenticated
          ? await _authHeaders(json: true)
          : const {'content-type': 'application/json'},
      body: jsonEncode(body),
    );
    return _decodeResponse(response);
  }

  Map<String, Object?> _decodeResponse(http.Response response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw BillingApiException('Billing API failed: ${response.body}');
    }
    return Map<String, Object?>.from(jsonDecode(response.body) as Map);
  }

  Map<String, Object?> _objectMap(Object? value) {
    return Map<String, Object?>.from(value! as Map);
  }

  Future<Map<String, String>> _authHeaders({bool json = false}) {
    return accountAuthorizationHeaders(
      _accountSessionStore,
      baseHeaders: json
          ? const {'content-type': 'application/json'}
          : const <String, String>{},
    );
  }
}

class BillingApiException implements Exception {
  const BillingApiException(this.message);

  final String message;

  @override
  String toString() => message;
}
