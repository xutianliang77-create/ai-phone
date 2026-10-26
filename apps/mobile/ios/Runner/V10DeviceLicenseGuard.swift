import Foundation
import CryptoKit

struct V10LicenseFailure: Error, LocalizedError {
  let code: String
  init(_ code: String) { self.code = code }
  var errorDescription: String? { code }
}
struct V10DeviceLicenseClaims: Codable {
  let version: Int, purpose: String, execution: String
  let leaseId: String, ownerId: String, deploymentId: String, bundleId: String
  let deviceKeyHash: String, launchNonce: String, requestNonce: String
  let sequence: Int, issuedAtMs: Int64, notBeforeMs: Int64, expiresAtMs: Int64
  let entitlementKey: String, entitlementRevision: String
  let componentProfile: String, implementationHash: String
  let allowedLanguages: [String]
}
struct V10LicenseRequestContext {
  let nonce: String, operation: String, sentAt: Double
}
/// Our implementation contract fingerprint. Never a hash of OS model weights.
final class V10DeviceLicenseGuard: @unchecked Sendable {
  static let profile = "apple-system-zh-en-v10-r1"
  static let implementationHash = "96afb4a9820e642bbfdbe5c9109ebb289deb10c2903f056fab383017814f8c99"
  private static let origin = ContinuousClock.now
  static func continuousSeconds() -> Double {
    let c = origin.duration(to: .now).components
    return Double(c.seconds) + Double(c.attoseconds) / 1e18
  }
  private let lock = NSLock()
  private let now: () -> Double
  let ownerId: String, deploymentId: String, bundleId: String, deviceKeyHash: String, launchNonce: String
  private let keys: [String: P256.Signing.PublicKey]
  private var pending: V10LicenseRequestContext?
  private var grant: V10DeviceLicenseClaims?
  private var tokenHash: String?
  private var deadline = 0.0, lastObserved = 0.0, accumulated = 0.0
  private var issuedAnchor = 0.0
  private var activeSince: Double?
  private var scopes = Set<String>()
  private var terminalReason: String?

  init(ownerId: String, deploymentId: String, bundleId: String, deviceKeyHash: String,
       launchNonce: String = UUID().uuidString, keys: [String: Data],
       now: @escaping () -> Double = V10DeviceLicenseGuard.continuousSeconds) throws {
    guard !ownerId.isEmpty, !deploymentId.isEmpty, !bundleId.isEmpty,
          deviceKeyHash.count == 64, !keys.isEmpty, keys.count <= 16 else {
      throw V10LicenseFailure("device_license_not_configured")
    }
    self.ownerId=ownerId;self.deploymentId=deploymentId;self.bundleId=bundleId
    self.deviceKeyHash=deviceKeyHash;self.launchNonce=launchNonce;self.now=now
    self.keys=try keys.mapValues { try P256.Signing.PublicKey(x963Representation:$0) }
    lastObserved=now()
  }
  func request(nonce: String, operation: String) throws -> (leaseId: String, sequence: Int) {
    lock.lock();defer{lock.unlock()};let t=try clock()
    guard ["acquire","renew"].contains(operation),nonce.count==64 else {throw V10LicenseFailure("device_request_binding")}
    if let p=pending {
      guard p.nonce==nonce,p.operation==operation else {throw V10LicenseFailure("device_request_in_progress")}
      return (grant?.leaseId ?? "",grant?.sequence ?? 0)
    }
    if operation=="renew" {try valid(t)}
    if operation=="acquire",grant != nil,terminalReason==nil,t<deadline {throw V10LicenseFailure("device_license_already_valid")}
    pending=V10LicenseRequestContext(nonce:nonce,operation:operation,sentAt:t)
    return operation=="renew" ? (grant!.leaseId,grant!.sequence) : ("",0)
  }
  func accept(_ token: String) throws {
    lock.lock();defer{lock.unlock()};let t=try clock(),hash=Self.hex(Data(token.utf8))
    if hash==tokenHash {try valid(t);return} // A retry must not reset the clock.
    guard let context=pending,token.utf8.count<=16384 else {throw V10LicenseFailure("device_request_missing")}
    let parts=token.split(separator:".",omittingEmptySubsequences:false)
    guard parts.count==3,
      let header=try JSONSerialization.jsonObject(with:Self.decode(String(parts[0]))) as? [String:Any],
      Set(header.keys)==Set(["alg","typ","kid"]),header["alg"] as? String=="ES256",
      header["typ"] as? String=="wujie-v10-device-license+jwt",let kid=header["kid"] as? String,
      let key=keys[kid] else {throw V10LicenseFailure("device_license_header")}
    let signature=try P256.Signing.ECDSASignature(rawRepresentation:Self.decode(String(parts[2])))
    guard key.isValidSignature(signature,for:Data((String(parts[0])+"."+String(parts[1])).utf8)) else {throw V10LicenseFailure("device_license_signature")}
    let payload=try Self.decode(String(parts[1]))
    guard let object=try JSONSerialization.jsonObject(with:payload) as? [String:Any],Set(object.keys)==Set([
      "version","purpose","execution","leaseId","ownerId","deploymentId","bundleId","deviceKeyHash","launchNonce","requestNonce","sequence",
      "issuedAtMs","notBeforeMs","expiresAtMs","entitlementKey","entitlementRevision","componentProfile","implementationHash","allowedLanguages"])
      else {throw V10LicenseFailure("device_license_fields")}
    let value=try JSONDecoder().decode(V10DeviceLicenseClaims.self,from:payload)
    guard value.version==1,value.purpose=="wujie-v10-device-license",value.execution=="on_device",
      value.ownerId==ownerId,value.deploymentId==deploymentId,value.bundleId==bundleId,
      value.deviceKeyHash==deviceKeyHash,value.launchNonce==launchNonce,value.requestNonce==context.nonce,
      value.allowedLanguages==["zh","en"],value.componentProfile==Self.profile,value.implementationHash==Self.implementationHash,
      !value.leaseId.isEmpty,value.sequence>0,value.issuedAtMs>0,value.notBeforeMs>=value.issuedAtMs,
      value.expiresAtMs>value.notBeforeMs,value.expiresAtMs-value.notBeforeMs<=1_800_000,
      value.notBeforeMs-value.issuedAtMs<=60_000 else {throw V10LicenseFailure("device_license_binding")}
    if context.operation=="renew" {
      guard let old=grant,value.leaseId==old.leaseId,value.sequence==old.sequence+1 else {throw V10LicenseFailure("device_license_sequence")}
    }else if value.sequence != 1 {throw V10LicenseFailure("device_license_sequence")}
    let start=context.sentAt+Double(value.notBeforeMs-value.issuedAtMs)/1000
    var end=context.sentAt+Double(value.expiresAtMs-value.issuedAtMs)/1000
    guard t>=start,t<end else {throw V10LicenseFailure("device_license_late_or_not_started")}
    if let old=grant,old.expiresAtMs==value.expiresAtMs {end=min(end,deadline)}
    if context.operation=="acquire" {accumulated=0;activeSince=nil;scopes.removeAll()}
    grant=value;issuedAnchor=context.sentAt;deadline=end;tokenHash=hash;pending=nil;terminalReason=nil
  }
  func requireValid(component: String, language: String? = nil, target: String? = nil, leaseId: String? = nil) throws {
    lock.lock();defer{lock.unlock()};let t=try clock();try valid(t)
    guard ["asr","translation","tts","ocr"].contains(component),
      leaseId==nil||leaseId==grant?.leaseId else {throw V10LicenseFailure("device_component_scope")}
    if let language {guard ["zh","en"].contains(Self.language(language)) else {throw V10LicenseFailure("device_language_not_qualified")}}
    if let target {guard ["zh","en"].contains(Self.language(target)),Self.language(target) != Self.language(language ?? "") else {throw V10LicenseFailure("device_language_not_qualified")}}
  }
  func abandonRequest() {lock.lock();pending=nil;lock.unlock()}
  func activity(_ scope: String, active: Bool) throws {
    lock.lock();defer{lock.unlock()};let t=try clock();if active{try valid(t)}
    if active {scopes.insert(scope)}else{scopes.remove(scope)}
    if !scopes.isEmpty,activeSince==nil {activeSince=t}
    if scopes.isEmpty,let since=activeSince {accumulated+=max(0,min(t,deadline)-since);activeSince=nil}
  }
  func invalidate(_ reason: String, preservePending: Bool = false) {
    lock.lock();defer{lock.unlock()};let t=now()
    if let since=activeSince {accumulated+=max(0,min(t,deadline)-since)}
    activeSince=nil;scopes.removeAll();if !preservePending{pending=nil};terminalReason=reason
  }
  func snapshot() -> [String:Any] {
    lock.lock();defer{lock.unlock()};let t=(try? clock()) ?? lastObserved
    let good=(try? valid(t)) != nil
    return ["valid":good,"ownerId":ownerId,"leaseId":grant?.leaseId ?? "","sequence":grant?.sequence ?? 0,
      "launchNonce":launchNonce,"expiresAtMs":grant?.expiresAtMs ?? 0,"remainingMs":good ? max(0,Int((deadline-t)*1000)):0,
      "activeMs":Int(((accumulated+(activeSince.map{max(0,min(t,deadline)-$0)} ?? 0))*1000).rounded(.up)),
      "observedServerTimeMs":(grant?.issuedAtMs ?? 0)+Int64(max(0,t-issuedAnchor)*1000),
      "reason":terminalReason ?? (grant==nil ? "authorization_required":"ready")]
  }
  private func valid(_ t: Double) throws {
    guard grant != nil,terminalReason==nil,t<deadline else {
      if grant != nil,terminalReason==nil {terminalReason="expired"}
      throw V10LicenseFailure(terminalReason ?? "authorization_required")
    }
  }
  private func clock() throws -> Double {
    let t=now();guard t.isFinite,t>=lastObserved else {terminalReason="monotonic_clock_invalid";throw V10LicenseFailure("monotonic_clock_invalid")};lastObserved=t;return t
  }
  private static func decode(_ s: String) throws -> Data {
    guard !s.isEmpty,s.range(of:"^[A-Za-z0-9_-]+$",options:.regularExpression) != nil else {throw V10LicenseFailure("device_license_encoding")}
    let normalized=s.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/")
    guard let data=Data(base64Encoded:normalized+String(repeating:"=",count:(4-normalized.count%4)%4)) else {throw V10LicenseFailure("device_license_encoding")};return data
  }
  static func hex(_ d: Data) -> String {SHA256.hash(data:d).map{String(format:"%02x",$0)}.joined()}
  static func language(_ s:String) -> String {let v=s.lowercased();return v.hasPrefix("zh") ? "zh":v.hasPrefix("en") ? "en":v}
}
