import Flutter
import UIKit

/// Authentication only. No inference, speech synthesis or supplier credential.
final class SharedControlProofBridge {
  private var identity: SharedControlIdentity?
  private var deployment: String { Bundle.main.object(forInfoDictionaryKey:"WujiePublicDeploymentId") as? String ?? "" }
  func register(messenger: FlutterBinaryMessenger) {
    FlutterMethodChannel(name:"translation_mobile/v10_shared_control",binaryMessenger:messenger)
      .setMethodCallHandler { [weak self] call, result in
        Task { @MainActor in
          do { result(try await self?.handle(call)) }
          catch { result(FlutterError(code:(error as? SharedControlFailure)?.code ?? "control_proof_failed",message:"设备证明未完成",details:nil)) }
        }
      }
  }
  @MainActor private func handle(_ call: FlutterMethodCall) async throws -> Any {
    guard UIApplication.shared.applicationState == .active,
      let args=call.arguments as? [String:Any],let owner=args["ownerId"] as? String,
      !owner.isEmpty,owner.utf8.count<=160,!deployment.isEmpty,!deployment.contains("$("),
      let environment=Bundle.main.object(forInfoDictionaryKey:"WujieAppAttestEnvironment") as? String,
      ["development","production"].contains(environment) else { throw SharedControlFailure("control_proof_not_configured") }
    if identity?.ownerId != owner {identity=try SharedControlIdentity(ownerId:owner,deployment:deployment,attestEnvironment:environment)}
    guard let identity else {throw SharedControlFailure("control_identity_missing")}
    if call.method=="identity" {return ["devicePublicKey":identity.publicKey,"deviceKeyHash":identity.keyHash]}
    guard let encoded=args["clientData"] as? String,encoded.utf8.count<=22000,
      let data=Data(base64Encoded:encoded),let body=try JSONSerialization.jsonObject(with:data) as? [String:Any],
      body["ownerId"] as? String == owner,body["deploymentId"] as? String == deployment,
      let plan=body["planHash"] as? String,plan.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil
      else {throw SharedControlFailure("control_proof_binding")}
    let now=Int64(Date().timeIntervalSince1970*1000)
    if call.method=="registerProof" {
      guard body["domain"] as? String == "wujie.hybrid-gateway.registration.v1",
        body["devicePublicKey"] as? String == identity.publicKey,
        let expires=body["expiresAtMs"] as? Int64,expires>now,expires-now<=305000,
        let registered=args["registered"] as? Bool else {throw SharedControlFailure("control_registration_scope")}
      return try await identity.attest(data,registered:registered,expectedKeyId:args["appAttestKeyId"] as? String)
    }
    if call.method=="signIssue" {
      guard body["domain"] as? String == "wujie.v10-control.issue.v1",
        body["devicePublicKey"] as? String == identity.publicKey,
        let issued=body["issuedAtMs"] as? Int64,abs(now-issued)<=30000 else {throw SharedControlFailure("control_issue_scope")}
    } else {
      guard call.method=="connectionProof",body["domain"] as? String == "wujie.v10-control.connection.v1",
        body["deviceKeyHash"] as? String == identity.keyHash,
        body["sessionId"] as? String == args["sessionId"] as? String,
        let expires=body["expiresAtMs"] as? Int64,expires>now,expires-now<=35000,
        let nonce=body["nonce"] as? String,nonce.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil
        else {throw SharedControlFailure("control_connection_scope")}
    }
    return ["deviceSignature":try identity.sign(data)]
  }
}
