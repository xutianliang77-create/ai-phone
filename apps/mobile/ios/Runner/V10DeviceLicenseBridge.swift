import Flutter
import UIKit
import CryptoKit

/// No model or account secret crosses this channel. Issuer public keys are
/// compiled configuration; our device key stays in the existing enclave store.
@MainActor
final class V10DeviceLicenseBridge: NSObject, FlutterStreamHandler {
  private var identity: SharedControlIdentity?
  private var permit: V10DeviceLicenseGuard?
  private var sink: FlutterEventSink?
  private var requestEnvelope: [String:Any]?
  private var timer: Timer?
  private var wasValid = false
  private var stopping = false
  private var receiptPersistenceFailed = false
  private var stoppedLeaseId: String?
  private var timeAnchor: (server: Int64, monotonic: Double)?
  var onStop: (() async -> Bool)?
  var profile: String { V10DeviceLicenseGuard.profile }
  private var deployment: String { Bundle.main.object(forInfoDictionaryKey:"WujiePublicDeploymentId") as? String ?? "" }
  private var environment: String { Bundle.main.object(forInfoDictionaryKey:"WujieAppAttestEnvironment") as? String ?? "" }

  func register(messenger: FlutterBinaryMessenger) {
    FlutterMethodChannel(name:"translation_mobile/v10_device_license",binaryMessenger:messenger)
      .setMethodCallHandler { [weak self] call,result in Task { @MainActor in
        do{guard let self else {return};result(try await self.handle(call))}
        catch{result(FlutterError(code:(error as? V10LicenseFailure)?.code ?? "device_license_failed",message:"本机授权校验未完成",details:nil))}
      }}
    FlutterEventChannel(name:"translation_mobile/v10_device_license/events",binaryMessenger:messenger).setStreamHandler(self)
  }
  func onListen(withArguments args: Any?,eventSink events:@escaping FlutterEventSink)->FlutterError?{sink=events;publish();return nil}
  func onCancel(withArguments args: Any?)->FlutterError?{sink=nil;return nil}
  private func configuredKeys() throws -> [String:Data] {
    guard Bundle.main.object(forInfoDictionaryKey:"WujieExecutionMode") as? String=="on_device",
      deployment.hasPrefix("wujie-v10-device-"),!deployment.contains("$("),
      ["development","production"].contains(environment),
      let raw=Bundle.main.object(forInfoDictionaryKey:"WujieV10LicenseKeys") as? String,
      let json=try JSONSerialization.jsonObject(with:Data(raw.utf8)) as? [String:String],!json.isEmpty else {throw V10LicenseFailure("device_license_not_configured")}
    return try json.mapValues {v in guard let d=Data(base64Encoded:v),d.count==65 else {throw V10LicenseFailure("device_license_key_invalid")};return d}
  }
  private func setup(_ owner: String) async throws {
    guard !owner.isEmpty,owner.utf8.count<=160,UIApplication.shared.applicationState == .active else {throw V10LicenseFailure("device_account_required")}
    if identity?.ownerId==owner {return}
    if permit != nil {await invalidate("account_changed")}
    let keys=try configuredKeys(),identity=try SharedControlIdentity(ownerId:owner,deployment:deployment,attestEnvironment:environment)
    self.identity=identity
    permit=try V10DeviceLicenseGuard(ownerId:owner,deploymentId:deployment,bundleId:Bundle.main.bundleIdentifier ?? "",
      deviceKeyHash:identity.keyHash,keys:keys)
    requestEnvelope=nil;timeAnchor=nil;arm()
  }
  func require(component: String,language: String?=nil,target: String?=nil,leaseId: String?=nil) throws {
    guard !stopping,let permit else {throw V10LicenseFailure("authorization_required")}
    try permit.requireValid(component:component,language:language,target:target,leaseId:leaseId)
  }
  func currentLeaseId() throws -> String {
    try require(component:"translation");return permit!.snapshot()["leaseId"] as? String ?? ""
  }
  private func handle(_ call:FlutterMethodCall) async throws -> Any {
    let a=call.arguments as? [String:Any] ?? [:]
    if call.method=="invalidate" {await invalidate(a["reason"] as? String ?? "account_changed");return [:]}
    guard let owner=a["ownerId"] as? String else {throw V10LicenseFailure("device_account_required")}
    try await setup(owner)
    guard let identity,let permit else {throw V10LicenseFailure("device_license_not_configured")}
    switch call.method {
    case "anchorTime":
      guard let t=a["serverNowMs"] as? Int64,t>0 else{throw V10LicenseFailure("device_server_time_required")}
      timeAnchor=(t,V10DeviceLicenseGuard.continuousSeconds());return [:]
    case "readiness","status":return snapshot()
    case "outbox":return ["receipts":try identity.deviceLicenseOutbox()]
    case "ackClose":
      guard let lease=a["leaseId"] as? String,let sequence=a["sequence"] as? Int else{throw V10LicenseFailure("device_receipt_binding")}
      let rows=try identity.deviceLicenseOutbox().filter{!($0["leaseId"] as? String==lease && $0["sequence"] as? Int==sequence)}
      try identity.saveDeviceLicenseOutbox(rows);return [:]
    case "registrationProof":
      guard let encoded=a["clientData"] as? String,encoded.utf8.count<=22000,let data=Data(base64Encoded:encoded),
        let body=try JSONSerialization.jsonObject(with:data) as? [String:Any],
        body["domain"] as? String=="wujie.hybrid-gateway.registration.v1",body["ownerId"] as? String==owner,
        body["deploymentId"] as? String==deployment,body["devicePublicKey"] as? String==identity.publicKey,
        body["planHash"] as? String==V10DeviceLicenseGuard.implementationHash,
        let registered=a["registered"] as? Bool else {throw V10LicenseFailure("device_registration_binding")}
      return try await identity.attest(data,registered:registered,expectedKeyId:a["appAttestKeyId"] as? String)
    case "abandonRequest":
      guard requestEnvelope != nil else{return snapshot()}
      requestEnvelope=nil
      permit.abandonRequest()
      return snapshot()
    case "request":
      guard !stopping else{throw V10LicenseFailure("device_stop_unconfirmed")}
      if let requestEnvelope {return requestEnvelope}
      guard let nonce=a["requestKey"] as? String,let operation=a["operation"] as? String else {throw V10LicenseFailure("device_request_binding")}
      let serverNow=try observedServerTime()
      var selected=permit
      if operation=="acquire",permit.snapshot()["valid"] as? Bool != true {
        selected=try V10DeviceLicenseGuard(ownerId:owner,deploymentId:deployment,bundleId:Bundle.main.bundleIdentifier ?? "",deviceKeyHash:identity.keyHash,keys:try configuredKeys());self.permit=selected
      }
      let request=try selected.request(nonce:nonce,operation:operation)
      let body:[String:Any]=["domain":"wujie.v10.device-license.request.v1","ownerId":owner,"deploymentId":deployment,
        "devicePublicKey":identity.publicKey,"requestKey":nonce,"launchNonce":selected.launchNonce,
        "profile":profile,"implementationHash":V10DeviceLicenseGuard.implementationHash,"issuedAtMs":serverNow,
        "operation":operation,"leaseId":request.leaseId,"sequence":request.sequence]
      let proof=try signed(body,identity:identity);requestEnvelope=proof;return proof
    case "install":
      guard !stopping else{throw V10LicenseFailure("device_stop_unconfirmed")}
      guard let token=a["license"] as? String else {throw V10LicenseFailure("device_license_missing")}
      try permit.accept(token);requestEnvelope=nil;stoppedLeaseId=nil;publish();return snapshot()
    case "activity":
      guard let scope=a["scope"] as? String,scope.count<=160,let active=a["active"] as? Bool else {throw V10LicenseFailure("device_activity_binding")}
      try permit.activity(scope,active:active);return snapshot()
    default:throw V10LicenseFailure("device_license_method")
    }
  }
  func signedStoreKit(owner: String,jws: String,currentEntitlement: Bool,serverNowMs: Int64,userInitiatedRestore:Bool = false,targetAccountToken:String? = nil) async throws -> [String:Any] {
    // This method is internal to the verified StoreKit bridge, never exposed as
    // an arbitrary Dart byte-signing API.
    try await setup(owner);guard let identity else {throw V10LicenseFailure("device_account_required")}
    var body:[String:Any]=["domain":"wujie.v10.storekit-proof.v1","ownerId":owner,"deploymentId":deployment,
      "devicePublicKey":identity.publicKey,"requestKey":V10DeviceLicenseGuard.hex(Data(UUID().uuidString.utf8)),
      "issuedAtMs":try observedServerTime(),"signedTransactionInfo":jws,"storeKitCurrentEntitlement":currentEntitlement]
    if userInitiatedRestore && currentEntitlement {
      guard let token=targetAccountToken,UUID(uuidString:token) != nil else{throw V10LicenseFailure("subscription_account_mismatch")}
      body["userInitiatedRestore"]=true;body["targetAccountToken"]=token.lowercased()
    }
    return try signed(body,identity:identity)
  }
  private func observedServerTime() throws -> Int64 {
    guard let anchor=timeAnchor else{throw V10LicenseFailure("device_server_time_required")}
    let elapsed=V10DeviceLicenseGuard.continuousSeconds()-anchor.monotonic
    guard elapsed.isFinite,elapsed>=0,elapsed<=600 else{throw V10LicenseFailure("device_server_time_refresh_required")}
    return anchor.server+Int64(elapsed*1000)
  }
  private func signed(_ body:[String:Any],identity:SharedControlIdentity)throws->[String:Any]{
    let data=try JSONSerialization.data(withJSONObject:body,options:[.sortedKeys,.withoutEscapingSlashes])
    return ["clientData":data.base64EncodedString(),"deviceSignature":try identity.sign(data)]
  }
  func invalidate(_ reason:String) async {
    let before=permit?.snapshot()
    stoppedLeaseId=before?["leaseId"] as? String
    permit?.invalidate(reason,preservePending:reason=="expired")
    if reason != "expired" {requestEnvelope=nil};stopping=true;publish()
    let stopped=await onStop?() ?? true;stopping = !stopped;wasValid=false
    if let before {persistClose(before,reason:reason)}
  }
  private func persistClose(_ s:[String:Any],reason:String){
    guard let identity,let lease=s["leaseId"] as? String,!lease.isEmpty else{return}
    do{
      var rows=try identity.deviceLicenseOutbox();if rows.contains(where:{$0["leaseId"] as? String==lease && $0["sequence"] as? Int==s["sequence"] as? Int}){return}
      let safe=["expired","account_changed","authorization_required","monotonic_clock_invalid"].contains(reason) ? reason:"authorization_stopped"
      let body:[String:Any]=["domain":"wujie.v10.device-license.close.v1","ownerId":identity.ownerId,"deploymentId":deployment,
        "devicePublicKey":identity.publicKey,"leaseId":lease,"launchNonce":s["launchNonce"] ?? "","sequence":s["sequence"] ?? 0,
        "activeMs":s["activeMs"] ?? 0,"issuedAtMs":s["observedServerTimeMs"] ?? 0,"reason":safe]
      rows.append(["leaseId":lease,"sequence":s["sequence"] ?? 0,"envelope":try signed(body,identity:identity)])
      try identity.saveDeviceLicenseOutbox(rows);receiptPersistenceFailed=false
    }catch{receiptPersistenceFailed=true}
  }
  private func snapshot()->[String:Any]{
    var s=permit?.snapshot() ?? ["valid":false,"reason":"authorization_required"]
    if stopping{s["valid"]=false;s["reason"]="device_stop_unconfirmed"}
    s["devicePublicKey"]=identity?.publicKey ?? "";s["deviceKeyHash"]=identity?.keyHash ?? ""
    s["implementationHash"]=V10DeviceLicenseGuard.implementationHash;s["componentProfile"]=profile
    s["deploymentId"]=deployment;s["stopping"]=stopping
    s["receiptPersistenceFailed"]=receiptPersistenceFailed
    return s
  }
  private func publish(){let s=snapshot();wasValid=s["valid"] as? Bool==true;sink?(s)}
  private func arm(){
    timer?.invalidate();timer=Timer.scheduledTimer(withTimeInterval:0.1,repeats:true){[weak self]_ in Task{@MainActor in
      guard let self else {return};let s=self.snapshot(),valid=s["valid"] as? Bool==true
      let lease=s["leaseId"] as? String ?? ""
      if !lease.isEmpty && self.stoppedLeaseId != lease && !valid && !self.stopping {await self.invalidate(s["reason"] as? String ?? "expired")}
      else if self.wasValid != valid {self.publish()}
    }}
  }
}
