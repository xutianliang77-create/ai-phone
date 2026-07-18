import Flutter
import Foundation

final class EnterpriseReplayKitBridge {
  private let channelName = "translation_mobile/enterprise_replaykit"
  private let manifestName = "enterprise_replaykit_control.json"

  func register(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(name: channelName, binaryMessenger: messenger)
    channel.setMethodCallHandler { [weak self] call, result in
      self?.handle(call, result: result)
    }
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    do {
      switch call.method {
      case "isConfigured":
        result(containerURL() != nil && extensionIdentifier() != nil)
      case "prepare":
        let manifest = try manifest(from: call.arguments)
        try write(manifest)
        result(nil)
      case "renew":
        let manifest = try manifest(from: call.arguments)
        let current = try read()
        guard current.controlKey == manifest.controlKey else {
          throw BridgeError.controlMismatch
        }
        try write(manifest)
        result(nil)
      case "clear":
        let key = try controlKey(from: call.arguments)
        if let current = try? read(), current.controlKey == key {
          try? FileManager.default.removeItem(at: try manifestURL())
        }
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    } catch {
      result(FlutterError(
        code: "replaykit_control_failed",
        message: "ReplayKit control state could not be updated.",
        details: nil
      ))
    }
  }

  private func manifest(from arguments: Any?) throws -> ReplayKitControlManifest {
    guard let values = arguments as? [String: Any],
          let publisherIdentity = values["publisherIdentity"] as? String,
          let expiryText = values["leaseExpiresAt"] as? String,
          let expiry = Self.timestamp(expiryText) else {
      throw BridgeError.invalidArguments
    }
    let key = try controlKey(from: arguments)
    guard publisherIdentity == "ent-share:\(key.shareId):g\(key.generation)",
          publisherIdentity.count <= 180,
          expiry > Date(),
          expiry <= Date().addingTimeInterval(600) else {
      throw BridgeError.invalidArguments
    }
    return ReplayKitControlManifest(
      shareId: key.shareId,
      generation: key.generation,
      publisherIdentity: publisherIdentity,
      leaseExpiresAt: expiry,
      controlNonce: key.controlNonce,
      enabled: true
    )
  }

  private func controlKey(from arguments: Any?) throws -> ReplayKitControlKey {
    guard let values = arguments as? [String: Any],
          let shareId = values["shareId"] as? String,
          let generation = values["generation"] as? Int,
          let controlNonce = values["controlNonce"] as? String,
          UUID(uuidString: shareId) != nil,
          UUID(uuidString: controlNonce) != nil,
          generation > 0 else {
      throw BridgeError.invalidArguments
    }
    return ReplayKitControlKey(
      shareId: shareId.lowercased(),
      generation: generation,
      controlNonce: controlNonce.lowercased()
    )
  }

  private func read() throws -> ReplayKitControlManifest {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return try decoder.decode(
      ReplayKitControlManifest.self,
      from: Data(contentsOf: try manifestURL())
    )
  }

  private func write(_ manifest: ReplayKitControlManifest) throws {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    try encoder.encode(manifest).write(to: try manifestURL(), options: .atomic)
  }

  private func manifestURL() throws -> URL {
    guard let container = containerURL() else { throw BridgeError.notConfigured }
    return container.appendingPathComponent(manifestName, isDirectory: false)
  }

  private func containerURL() -> URL? {
    guard let group = Bundle.main.object(
      forInfoDictionaryKey: "RTCAppGroupIdentifier"
    ) as? String, group.hasPrefix("group."), group.count <= 180 else {
      return nil
    }
    return FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: group
    )
  }

  private func extensionIdentifier() -> String? {
    guard let value = Bundle.main.object(
      forInfoDictionaryKey: "RTCScreenSharingExtension"
    ) as? String, !value.isEmpty, value.count <= 180 else { return nil }
    return value
  }

  private static func timestamp(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
  }
}

private struct ReplayKitControlManifest: Codable {
  let shareId: String
  let generation: Int
  let publisherIdentity: String
  let leaseExpiresAt: Date
  let controlNonce: String
  let enabled: Bool

  var controlKey: ReplayKitControlKey {
    ReplayKitControlKey(
      shareId: shareId.lowercased(),
      generation: generation,
      controlNonce: controlNonce.lowercased()
    )
  }
}

private struct ReplayKitControlKey: Equatable {
  let shareId: String
  let generation: Int
  let controlNonce: String
}

private enum BridgeError: Error {
  case invalidArguments
  case notConfigured
  case controlMismatch
}
