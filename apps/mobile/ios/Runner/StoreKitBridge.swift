import Flutter
import StoreKit

final class StoreKitBridge {
  private let methodChannelName = "translation_mobile/purchase"

  func register(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(
      name: methodChannelName,
      binaryMessenger: messenger
    )
    channel.setMethodCallHandler { [weak self] call, result in
      self?.handle(call: call, result: result)
    }
  }

  private func handle(call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "loadProducts":
      loadProducts(call: call, result: result)
    case "purchase":
      purchase(call: call, result: result)
    case "restorePurchases":
      restorePurchases(result: result)
    case "finishTransaction":
      finishTransaction(call: call, result: result)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func loadProducts(call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard #available(iOS 15.0, *) else {
      result(FlutterError(code: "storekit_unavailable", message: "StoreKit 2 requires iOS 15", details: nil))
      return
    }
    guard let arguments = call.arguments as? [String: Any],
          let productIds = arguments["productIds"] as? [String] else {
      result(FlutterError(code: "invalid_products_request", message: "Missing productIds", details: nil))
      return
    }
    Task {
      do {
        let products = try await Product.products(for: productIds)
        result(products.map { product in
          [
            "productId": product.id,
            "displayName": product.displayName,
            "description": product.description,
            "priceText": product.displayPrice
          ]
        })
      } catch {
        result(FlutterError(code: "storekit_products_failed", message: error.localizedDescription, details: nil))
      }
    }
  }

  private func purchase(call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard #available(iOS 15.0, *) else {
      result(["status": "unavailable", "message": "StoreKit 2 requires iOS 15"])
      return
    }
    guard let arguments = call.arguments as? [String: Any],
          let productId = arguments["productId"] as? String else {
      result(FlutterError(code: "invalid_purchase_request", message: "Missing productId", details: nil))
      return
    }
    Task { @MainActor in
      await purchaseProduct(productId: productId, result: result)
    }
  }

  @available(iOS 15.0, *)
  @MainActor
  private func purchaseProduct(productId: String, result: @escaping FlutterResult) async {
    do {
      guard let product = try await Product.products(for: [productId]).first else {
        result(["status": "unavailable", "productId": productId])
        return
      }
      switch try await product.purchase() {
      case .success(let verification):
        switch verification {
        case .verified(let transaction):
          result(transactionPayload(
            status: "success",
            transaction: transaction,
            signedTransactionInfo: verification.jwsRepresentation
          ))
        case .unverified(let transaction, let error):
          result(transactionPayload(
            status: "unverified",
            transaction: transaction,
            signedTransactionInfo: verification.jwsRepresentation,
            message: String(describing: error)
          ))
        }
      case .userCancelled:
        result(["status": "cancelled", "productId": productId])
      case .pending:
        result(["status": "pending", "productId": productId])
      @unknown default:
        result(["status": "unknown", "productId": productId])
      }
    } catch {
      result(FlutterError(code: "storekit_purchase_failed", message: error.localizedDescription, details: nil))
    }
  }

  @available(iOS 15.0, *)
  private func transactionPayload(
    status: String,
    transaction: Transaction,
    signedTransactionInfo: String,
    message: String? = nil
  ) -> [String: Any] {
    var payload: [String: Any] = [
      "status": status,
      "productId": transaction.productID,
      "transactionId": String(transaction.id),
      "signedTransactionInfo": signedTransactionInfo
    ]
    if let message {
      payload["message"] = message
    }
    return payload
  }

  private func restorePurchases(result: @escaping FlutterResult) {
    guard #available(iOS 15.0, *) else {
      result([])
      return
    }
    Task {
      do {
        try await AppStore.sync()
        let current = await transactionPayloads(from: Transaction.currentEntitlements)
        let unfinished = await transactionPayloads(from: Transaction.unfinished)
        result(deduplicateTransactions(current + unfinished))
      } catch {
        result(FlutterError(code: "storekit_restore_failed", message: error.localizedDescription, details: nil))
      }
    }
  }

  @available(iOS 15.0, *)
  private func transactionPayloads(
    from transactions: Transaction.Transactions
  ) async -> [[String: Any]] {
    var payloads: [[String: Any]] = []
    for await verification in transactions {
      switch verification {
      case .verified(let transaction):
        payloads.append(transactionPayload(
          status: "success",
          transaction: transaction,
          signedTransactionInfo: verification.jwsRepresentation
        ))
      case .unverified(let transaction, let error):
        payloads.append(transactionPayload(
          status: "unverified",
          transaction: transaction,
          signedTransactionInfo: verification.jwsRepresentation,
          message: String(describing: error)
        ))
      }
    }
    return payloads
  }

  private func deduplicateTransactions(_ payloads: [[String: Any]]) -> [[String: Any]] {
    var seen = Set<String>()
    var unique: [[String: Any]] = []
    for payload in payloads {
      guard let transactionId = payload["transactionId"] as? String else {
        continue
      }
      if seen.insert(transactionId).inserted {
        unique.append(payload)
      }
    }
    return unique
  }

  private func finishTransaction(call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard #available(iOS 15.0, *) else {
      result(false)
      return
    }
    guard let arguments = call.arguments as? [String: Any],
          let transactionId = arguments["transactionId"] as? String else {
      result(FlutterError(code: "invalid_finish_request", message: "Missing transactionId", details: nil))
      return
    }
    Task {
      for await verification in Transaction.unfinished {
        guard let transaction = try? verification.payloadValue else { continue }
        if String(transaction.id) == transactionId {
          await transaction.finish()
          result(true)
          return
        }
      }
      result(false)
    }
  }
}
