import Flutter
import AuthenticationServices
import Security
import UIKit

/// Uses the current public application's Keychain namespace, never a shared
/// access group or the private application's files. No password/API-key logging.
final class AppleAccountBridge: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  var onCredentialsChanged: (() -> Void)?

  private var pending: FlutterResult?
  private var expectedState: String?
  private var controller: ASAuthorizationController?
  private var authorizationAnchor: ASPresentationAnchor?
  private var presenter: (() -> UIViewController?)?
  func register(messenger: FlutterBinaryMessenger, presenter: @escaping () -> UIViewController?) {
    self.presenter = presenter
    let channel = FlutterMethodChannel(name: "translation_mobile/apple_account", binaryMessenger: messenger)
    channel.setMethodCallHandler { [weak self] call, result in self?.handle(call, result) }
  }
  private func handle(_ call: FlutterMethodCall, _ result: @escaping FlutterResult) {
    guard let args = call.arguments as? [String: Any] else { result(FlutterError(code:"invalid_account_request",message:nil,details:nil)); return }
    if call.method == "signIn" {
      guard pending == nil, let nonce = args["nonce"] as? String, let state = args["state"] as? String,
            let bundle = args["bundleId"] as? String, bundle == Bundle.main.bundleIdentifier,
            !nonce.isEmpty, nonce.count <= 256, !state.isEmpty, state.count <= 256,
            let anchor = presenter?()?.viewIfLoaded?.window,
            UIApplication.shared.applicationState == .active,
            anchor.windowScene?.activationState == .foregroundActive else {
        recordFailure("apple_signin_not_ready")
        result(FlutterError(code:"apple_signin_not_ready",message:nil,details:nil)); return
      }
      let request = ASAuthorizationAppleIDProvider().createRequest()
      request.nonce = nonce // A3 already supplies the exact Apple nonce; do not double hash.
      request.state = state
      pending = result; expectedState = state; authorizationAnchor = anchor
      let c = ASAuthorizationController(authorizationRequests: [request])
      c.delegate = self; c.presentationContextProvider = self; controller = c
      c.performRequests()
      return
    }
    guard let key = args["key"] as? String, key.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil,
          let bundle = Bundle.main.bundleIdentifier else { result(FlutterError(code:"invalid_credential_scope",message:nil,details:nil)); return }
    var query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,
      kSecAttrService as String:bundle + ".wujie-public-account-v1", kSecAttrAccount as String:key,
      kSecAttrSynchronizable as String:false]
    var status: OSStatus = errSecSuccess
    switch call.method {
    case "credentialRead":
      query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
      var value: CFTypeRef?
      status = SecItemCopyMatching(query as CFDictionary, &value)
      if status == errSecItemNotFound { result(nil); return }
      if status == errSecSuccess, let data = value as? Data, let text = String(data:data,encoding:.utf8) { result(text); return }
    case "credentialWrite":
      guard let value = args["value"] as? String, value.utf8.count <= 16384 else { result(FlutterError(code:"invalid_credential",message:nil,details:nil)); return }
      let update: [String:Any] = [kSecValueData as String:Data(value.utf8),
        kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
      status = SecItemUpdate(query as CFDictionary,update as CFDictionary)
      if status == errSecItemNotFound { query.merge(update) { _,new in new }; status = SecItemAdd(query as CFDictionary,nil) }
      if status == errSecSuccess { onCredentialsChanged?(); result(nil); return }
    case "credentialDelete":
      status = SecItemDelete(query as CFDictionary)
      if status == errSecSuccess || status == errSecItemNotFound { onCredentialsChanged?(); result(nil); return }
    default: result(FlutterMethodNotImplemented); return
    }
    result(FlutterError(code:"credential_storage_unavailable",message:nil,details:Int(status)))
  }
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    // performRequests is permitted only with a current foreground window.
    return authorizationAnchor ?? ASPresentationAnchor()
  }
  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    guard let c = authorization.credential as? ASAuthorizationAppleIDCredential, c.state == expectedState,
          let token = c.identityToken.flatMap({String(data:$0,encoding:.utf8)}),
          let code = c.authorizationCode.flatMap({String(data:$0,encoding:.utf8)}) else {
      recordFailure("apple_identity_mismatch")
      complete(FlutterError(code:"apple_identity_mismatch",message:nil,details:nil)); return
    }
    complete(["state":c.state!,"identityToken":token,"authorizationCode":code])
  }
  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    let code = (error as? ASAuthorizationError)?.code == .canceled ? "apple_signin_cancelled":"apple_signin_failed"
    let native = error as NSError
    recordFailure(code, native: native)
    complete(FlutterError(code:code,message:nil,details:nil))
  }
  private func recordFailure(_ code: String, native: NSError? = nil) {
    guard Bundle.main.object(forInfoDictionaryKey:"WujieAppAttestEnvironment") as? String == "development" else { return }
    var value: [String:Any] = ["at":ISO8601DateFormatter().string(from:Date()),
      "build":Bundle.main.object(forInfoDictionaryKey:"CFBundleVersion") ?? "unknown",
      "stage":"system_authorization","errorCode":code,"credentialsRecorded":false,
      "presenterWindowAvailable":presenter?()?.viewIfLoaded?.window != nil,
      "applicationState":UIApplication.shared.applicationState.rawValue]
    if let native { value["nativeErrorDomain"] = native.domain; value["nativeErrorCode"] = native.code }
    // No NSError userInfo, message, state, identity token or authorization code.
    guard let data = try? JSONSerialization.data(withJSONObject:value),
      let documents = FileManager.default.urls(for:.documentDirectory,in:.userDomainMask).first else { return }
    try? data.write(to:documents.appendingPathComponent("wujie-apple-signin-native-last.json"),options:.atomic)
  }
  private func complete(_ value: Any?) {
    let result = pending; pending = nil; expectedState = nil; controller = nil; authorizationAnchor = nil; result?(value)
  }
}
