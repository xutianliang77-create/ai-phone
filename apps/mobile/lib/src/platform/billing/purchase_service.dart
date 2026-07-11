import 'package:flutter/services.dart';

abstract interface class PurchaseService {
  Future<List<StoreProduct>> loadProducts(List<String> productIds);
  Future<PurchaseResult> purchase(String productId);
  Future<List<PurchaseResult>> restorePurchases();
  Future<void> finishTransaction(String transactionId);
}

class StoreProduct {
  const StoreProduct({
    required this.productId,
    required this.displayName,
    required this.priceText,
  });

  final String productId;
  final String displayName;
  final String priceText;
}

class PurchaseResult {
  const PurchaseResult({
    required this.status,
    this.productId,
    this.transactionId,
    this.signedTransactionInfo,
    this.message,
  });

  final String status;
  final String? productId;
  final String? transactionId;
  final String? signedTransactionInfo;
  final String? message;

  bool get completed => status == 'success' && transactionId != null;
}

class PlatformPurchaseService implements PurchaseService {
  const PlatformPurchaseService({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel(_channelName);

  static const _channelName = 'translation_mobile/purchase';
  final MethodChannel _channel;

  @override
  Future<List<StoreProduct>> loadProducts(List<String> productIds) async {
    final raw = await _invokeList('loadProducts', <String, Object?>{
      'productIds': productIds,
    });
    return raw.map((item) {
      final json = Map<String, Object?>.from(item as Map);
      return StoreProduct(
        productId: json['productId']! as String,
        displayName: json['displayName']! as String,
        priceText: json['priceText']! as String,
      );
    }).toList();
  }

  @override
  Future<PurchaseResult> purchase(String productId) async {
    final json = await _invokeMap('purchase', <String, Object?>{
      'productId': productId,
    });
    return PurchaseResult(
      status: json['status']! as String,
      productId: json['productId'] as String?,
      transactionId: json['transactionId'] as String?,
      signedTransactionInfo: json['signedTransactionInfo'] as String?,
      message: json['message'] as String?,
    );
  }

  @override
  Future<List<PurchaseResult>> restorePurchases() async {
    final raw =
        await _invokeList('restorePurchases', const <String, Object?>{});
    return raw.map((item) {
      final json = Map<String, Object?>.from(item as Map);
      return PurchaseResult(
        status: json['status']! as String,
        productId: json['productId'] as String?,
        transactionId: json['transactionId'] as String?,
        signedTransactionInfo: json['signedTransactionInfo'] as String?,
        message: json['message'] as String?,
      );
    }).toList();
  }

  @override
  Future<void> finishTransaction(String transactionId) async {
    await _channel.invokeMethod<void>('finishTransaction', <String, Object?>{
      'transactionId': transactionId,
    });
  }

  Future<List<Object?>> _invokeList(
    String method,
    Map<String, Object?> arguments,
  ) async {
    try {
      final result = await _channel.invokeMethod<List<Object?>>(
        method,
        arguments,
      );
      return result ?? const <Object?>[];
    } on MissingPluginException catch (error) {
      throw PurchaseServiceException(error.message ?? 'Billing is unavailable');
    }
  }

  Future<Map<String, Object?>> _invokeMap(
    String method,
    Map<String, Object?> arguments,
  ) async {
    try {
      final result = await _channel.invokeMethod<Map<Object?, Object?>>(
        method,
        arguments,
      );
      return Map<String, Object?>.from(result ?? const <Object?, Object?>{});
    } on MissingPluginException catch (error) {
      throw PurchaseServiceException(error.message ?? 'Billing is unavailable');
    }
  }
}

class SandboxPurchaseService implements PurchaseService {
  const SandboxPurchaseService({required this.transactionIdFactory});

  final String Function() transactionIdFactory;

  @override
  Future<List<StoreProduct>> loadProducts(List<String> productIds) async {
    return productIds
        .map(
            (id) => StoreProduct(productId: id, displayName: id, priceText: ''))
        .toList();
  }

  @override
  Future<PurchaseResult> purchase(String productId) async {
    return PurchaseResult(
      status: 'success',
      productId: productId,
      transactionId: transactionIdFactory(),
    );
  }

  @override
  Future<List<PurchaseResult>> restorePurchases() async {
    return const <PurchaseResult>[];
  }

  @override
  Future<void> finishTransaction(String transactionId) async {}
}

class PurchaseServiceException implements Exception {
  const PurchaseServiceException(this.message);

  final String message;

  @override
  String toString() => message;
}
