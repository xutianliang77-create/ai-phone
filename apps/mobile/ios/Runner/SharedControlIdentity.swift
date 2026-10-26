import Foundation
import CryptoKit
import Security
import DeviceCheck

/// Device-only key material and queued stop receipts. No vendor secret or
/// issuer signing private key is present in the app.
final class SharedControlIdentity {
  private let service: String
  private let deployment: String
  private let signingKey: SecureEnclave.P256.Signing.PrivateKey
  let ownerId: String
  var publicKey: String { signingKey.publicKey.x963Representation.base64EncodedString() }
  var keyHash: String {
    SHA256.hash(data: signingKey.publicKey.x963Representation).map { String(format:"%02x",$0) }.joined()
  }
  init(ownerId: String, deployment: String, attestEnvironment: String) throws {
    guard SecureEnclave.isAvailable, DCAppAttestService.shared.isSupported else {
      throw SharedControlFailure("device_attestation_unavailable")
    }
    self.ownerId = ownerId
    self.deployment = deployment
    let installationKey = "wujie.device-permit.installation"
    let installation = UserDefaults.standard.string(forKey:installationKey) ?? UUID().uuidString
    UserDefaults.standard.set(installation,forKey:installationKey)
    let identity = Data((deployment + ":" + attestEnvironment + ":" + ownerId + ":" + installation).utf8)
    service = (Bundle.main.bundleIdentifier ?? "wujie") + ".device-permit." +
      SHA256.hash(data: identity).map { String(format:"%02x",$0) }.joined()
    if let saved = try Self.read(service: service, key: "device-key") {
      signingKey = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: saved)
    } else {
      var error: Unmanaged<CFError>?
      guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
          [.privateKeyUsage], &error) else { throw SharedControlFailure("device_key_access_control") }
      signingKey = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
      try Self.write(service: service, key: "device-key", data: signingKey.dataRepresentation)
    }
  }
  func sign(_ data: Data) throws -> String { try signingKey.signature(for: data).rawRepresentation.base64EncodedString() }
  func attest(_ data: Data, registered: Bool, expectedKeyId: String?) async throws -> [String: Any] {
    var keyId: String
    if registered, let expectedKeyId, Data(base64Encoded:expectedKeyId)?.count == 32 {
      keyId = expectedKeyId
    } else if let data = try Self.read(service: service, key: "app-attest-key"), let stored = String(data: data, encoding: .utf8) {
      keyId = stored
    } else {
      keyId = try await generateAttestKey()
      try Self.write(service: service, key: "app-attest-key", data: Data(keyId.utf8))
    }
    let hash = Data(SHA256.hash(data: data))
    let proof: Data
    do {
      proof = registered ? try await assertAttestKey(keyId, hash)
        : try await certifyAttestKey(keyId, hash)
    } catch {
      guard !registered, (error as? DCError)?.code == .invalidKey else { throw error }
      // Only recover an unregistered orphan key. Network failures retain the
      // original key/hash; a registered key is never silently replaced.
      keyId = try await generateAttestKey()
      try Self.write(service:service,key:"app-attest-key",data:Data(keyId.utf8))
      proof = try await certifyAttestKey(keyId, hash)
    }
    try Self.write(service:service,key:"app-attest-key",data:Data(keyId.utf8))
    return ["clientData": data.base64EncodedString(), "deviceSignature": try sign(data),
      "appAttestKeyId": keyId, registered ? "assertion" : "attestation": proof.base64EncodedString()]
  }
  private func generateAttestKey() async throws -> String {
    do { return try await DCAppAttestService.shared.generateKey() }
    catch { SharedControlDiagnostics.record("generate_key", error); throw error }
  }
  private func certifyAttestKey(_ key: String, _ hash: Data) async throws -> Data {
    do { return try await DCAppAttestService.shared.attestKey(key, clientDataHash: hash) }
    catch { SharedControlDiagnostics.record("attest_key", error); throw error }
  }
  private func assertAttestKey(_ key: String, _ hash: Data) async throws -> Data {
    do { return try await DCAppAttestService.shared.generateAssertion(key, clientDataHash: hash) }
    catch { SharedControlDiagnostics.record("assertion", error); throw error }
  }
  private func query(_ key: String) -> [String: Any] {
    [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:key]
  }
  private static func read(service: String, key: String) throws -> Data? {
    let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,
      kSecAttrAccount as String:key,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw SharedControlFailure("device_keychain_read_\(status)") }
    return data
  }
  private static func write(service: String, key: String, data: Data) throws {
    let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key]
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String:data] as CFDictionary)
    if status == errSecSuccess { return }
    guard status == errSecItemNotFound else { throw SharedControlFailure("device_keychain_write_\(status)") }
    var insert = query; insert[kSecValueData as String] = data
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw SharedControlFailure("device_keychain_insert") }
  }
}

/// Development diagnostics accept errors only, never keys, proofs or request data.
enum SharedControlDiagnostics {
  static func code(_ error: Error) -> String {
    if let failure = error as? SharedControlFailure { return failure.code }
    if let dc = error as? DCError {
      switch dc.code {
      case .featureUnsupported: return "device_attestation_unavailable"
      case .invalidInput: return "device_attest_input_rejected"
      case .invalidKey: return "device_attest_key_rejected"
      case .serverUnavailable: return "device_attest_service_unavailable"
      default: return "device_attest_unknown_error"
      }
    }
    return (error as NSError).domain == NSURLErrorDomain
      ? "device_attest_network_unavailable" : "device_permit_failed"
  }
  static func record(_ phase: String, _ error: Error) {
    guard Bundle.main.object(forInfoDictionaryKey: "WujieAppAttestEnvironment") as? String == "development",
      ["generate_key", "attest_key", "assertion", "bridge"].contains(phase) else { return }
    var chain = [[String: Any]](), current: NSError? = error as NSError
    while let item = current, chain.count < 4 {
      let domain = item.domain.range(of: "^[A-Za-z0-9._-]{1,120}$", options: .regularExpression) != nil
        ? item.domain : "unclassified"
      chain.append(["domain": domain, "code": item.code])
      current = item.userInfo[NSUnderlyingErrorKey] as? NSError
    }
    let record: [String: Any] = ["at": ISO8601DateFormatter().string(from: Date()),
      "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") ?? "unknown",
      "phase": phase, "code": code(error), "errorChain": chain, "credentialsRecorded": false]
    do {
      var url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("wujie-device-permit-native-\(phase).json")
      try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]).write(to: url, options: .atomic)
      var values = URLResourceValues(); values.isExcludedFromBackup = true; try url.setResourceValues(values)
    } catch { /* Diagnostics cannot change the authorization outcome. */ }
  }
}

struct SharedControlFailure: Error, LocalizedError {
  let code: String
  init(_ code: String) { self.code = code }
  var errorDescription: String? { code }
}
