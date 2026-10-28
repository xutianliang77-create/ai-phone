import Flutter
import StoreKit
import UIKit
import Speech
import Translation

/// StoreKit is the only source of purchase JWS and introductory-offer
/// eligibility. Dart cannot ask the enclave to sign an arbitrary transaction.
@MainActor
final class V10SubscriptionBridge {
  private let license: V10DeviceLicenseBridge
  private var pending: [String:(Transaction,String)] = [:]
  private var busy = false
  private var loadAttempt = 0
  private var loadEvents = [[String:Any]]()
  init(license: V10DeviceLicenseBridge) { self.license = license }
  private var productId: String { Bundle.main.object(forInfoDictionaryKey:"WujieV10SubscriptionProductId") as? String ?? "" }
  func register(messenger: FlutterBinaryMessenger) {
    FlutterMethodChannel(name:"translation_mobile/v10_subscription",binaryMessenger:messenger).setMethodCallHandler{[weak self]call,result in Task{@MainActor in
      do { guard let self else{return}; result(try await self.handle(call)) }
      catch {result(FlutterError(code:(error as? V10LicenseFailure)?.code ?? "subscription_unavailable",message:"订阅操作未完成，请保留原购买记录并重试同步。",details:nil))}
    }}
  }
  // QA metadata contains only fixed stages, booleans, bounded counts, and
  // allowlisted error categories. Never save account, transaction, or errors' userInfo.
  private func recordLoad(_ attempt:Int?,_ stage:String,started:Double,
                          flags:[String:Bool] = [:],count:Int? = nil,error:Error? = nil) {
    guard let attempt,
      Bundle.main.object(forInfoDictionaryKey:"WujieExecutionMode") as? String == "on_device",
      Bundle.main.object(forInfoDictionaryKey:"WujieAppAttestEnvironment") as? String == "development",
      Bundle.main.object(forInfoDictionaryKey:"WujieSubscriptionDiagnostics") as? String == "1",
      ["load_started","product_config_checked","product_request_started","product_empty",
       "product_received","eligibility_started","eligibility_finished","trial_checked",
       "load_completed","load_failed"].contains(stage) else { return }
    var event:[String:Any] = ["attempt":attempt,"stage":stage,
      "at":ISO8601DateFormatter().string(from:Date()),
      "durationMs":Int(min(600000,max(0,(ProcessInfo.processInfo.systemUptime-started)*1000)))]
    let allowedFlags = ["productConfigured","idMatch","typeMatch","priceMatch","currencyMatch","periodMatch","trialConfigured"]
    for (key,value) in flags where allowedFlags.contains(key) { event[key]=value }
    if let count { event["productCount"] = min(3,max(0,count)) }
    if let error {
      let code=(error as? V10LicenseFailure)?.code
      let allowedCodes=["subscription_product_mismatch","subscription_trial_not_configured","storekit_unavailable","device_account_required"]
      event["errorCode"] = code.flatMap { allowedCodes.contains($0) ? $0 : nil } ?? "subscription_unavailable"
      let native=error as NSError
      if ["SKErrorDomain","ASDErrorDomain","AMSErrorDomain","NSURLErrorDomain"].contains(native.domain) {
        event["nativeErrorDomain"] = native.domain
        event["nativeErrorCode"] = native.code
      }
    }
    loadEvents.append(event)
    if loadEvents.count > 30 { loadEvents.removeFirst(loadEvents.count-30) }
    let payload:[String:Any] = ["build":Bundle.main.object(forInfoDictionaryKey:"CFBundleVersion") as? String ?? "unknown",
      "credentialsRecorded":false,"events":loadEvents]
    guard let data=try? JSONSerialization.data(withJSONObject:payload),
      let documents=FileManager.default.urls(for:.documentDirectory,in:.userDomainMask).first else { return }
    try? data.write(to:documents.appendingPathComponent("wujie-subscription-native-stages.json"),options:.atomic)
  }
  private func product(diagnosticAttempt:Int? = nil,started:Double = 0) async throws -> Product {
    let configured = !productId.isEmpty && !productId.contains("$(")
    recordLoad(diagnosticAttempt,"product_config_checked",started:started,flags:["productConfigured":configured])
    guard configured else { throw V10LicenseFailure("subscription_product_mismatch") }
    recordLoad(diagnosticAttempt,"product_request_started",started:started)
    let products=try await Product.products(for:[productId])
    guard let p=products.first else {
      recordLoad(diagnosticAttempt,"product_empty",started:started,count:products.count)
      throw V10LicenseFailure("subscription_product_mismatch")
    }
    let idMatch=p.id==productId, typeMatch=p.type == .autoRenewable, priceMatch=p.price == Decimal(10),
      currencyMatch=p.priceFormatStyle.currencyCode=="CNY"
    let periodMatch=p.subscription.map { $0.subscriptionPeriod.unit == .month && $0.subscriptionPeriod.value==1 } ?? false
    recordLoad(diagnosticAttempt,"product_received",started:started,
      flags:["idMatch":idMatch,"typeMatch":typeMatch,"priceMatch":priceMatch,
             "currencyMatch":currencyMatch,"periodMatch":periodMatch],count:products.count)
    guard idMatch,typeMatch,priceMatch,currencyMatch,periodMatch else {
      throw V10LicenseFailure("subscription_product_mismatch")
    }
    return p
  }
  private func trialConfigured(_ p:Product) -> Bool {
    guard let offer=p.subscription?.introductoryOffer else{return false}
    return offer.paymentMode == .freeTrial && offer.period.unit == .week && offer.period.value==1 && offer.periodCount==1
  }
  private func handle(_ call:FlutterMethodCall) async throws -> Any {
    guard #available(iOS 15.0,*) else{throw V10LicenseFailure("storekit_unavailable")}
    let a=call.arguments as? [String:Any] ?? [:]
    guard let owner=a["ownerId"] as? String,!owner.isEmpty else{throw V10LicenseFailure("device_account_required")}
    switch call.method {
    case "manage":
      guard let scene=UIApplication.shared.connectedScenes.first(where:{$0.activationState == .foregroundActive}) as? UIWindowScene else{throw V10LicenseFailure("subscription_ui_unavailable")}
      try await AppStore.showManageSubscriptions(in:scene);return [:]
    case "load":
      loadAttempt += 1
      let attempt=loadAttempt,started=ProcessInfo.processInfo.systemUptime
      recordLoad(attempt,"load_started",started:started)
      do {
        let p=try await product(diagnosticAttempt:attempt,started:started)
        recordLoad(attempt,"eligibility_started",started:started)
        let eligible=await p.subscription!.isEligibleForIntroOffer
        recordLoad(attempt,"eligibility_finished",started:started)
        let trial=trialConfigured(p)
        recordLoad(attempt,"trial_checked",started:started,flags:["trialConfigured":trial])
        guard trial else{throw V10LicenseFailure("subscription_trial_not_configured")}
        recordLoad(attempt,"load_completed",started:started)
        return ["productId":p.id,"displayName":p.displayName,"priceText":p.displayPrice,"priceMinorCny":1000,
          "currency":"CNY","period":"P1M","trialDays":7,"trialEligible":eligible,"validated":true]
      } catch {
        recordLoad(attempt,"load_failed",started:started,error:error)
        throw error
      }
    case "purchase":
      guard !busy,let token=a["appAccountToken"] as? String,let uuid=UUID(uuidString:token),
        let now=a["serverNowMs"] as? Int64,a["consentConfirmed"] as? Bool==true else{throw V10LicenseFailure("subscription_consent_required")}
      busy=true;defer{busy=false}
      try await resourceReadiness()
      let p=try await product();guard trialConfigured(p) else{throw V10LicenseFailure("subscription_trial_not_configured")}
      // Re-read eligibility immediately before displaying Apple's sheet. A
      // changed offer must return to our actual-terms UI before any purchase.
      let eligible=await p.subscription!.isEligibleForIntroOffer
      guard a["trialEligible"] as? Bool==eligible else{throw V10LicenseFailure("subscription_offer_changed")}
      switch try await p.purchase(options:[.appAccountToken(uuid)]) {
      case .success(let verification):return ["status":"success","proofs":[try await proof(verification,owner:owner,now:now,current:false)]]
      case .pending:return ["status":"pending","proofs":[]]
      case .userCancelled:return ["status":"cancelled","proofs":[]]
      @unknown default:throw V10LicenseFailure("subscription_unknown_result")
      }
    case "restore","pending":
      guard !busy,let now=a["serverNowMs"] as? Int64 else{throw V10LicenseFailure("subscription_busy")}
      busy=true;defer{busy=false}
      if call.method=="restore" {guard a["userInitiated"] as? Bool==true else{throw V10LicenseFailure("restore_consent_required")};try await AppStore.sync()}
      var proofs=[[String:Any]](),seen=Set<UInt64>()
      for await v in Transaction.currentEntitlements {
        if case .verified(let t)=v,t.productID==productId,seen.insert(t.id).inserted {
          proofs.append(try await proof(v,owner:owner,now:now,current:true))
        }
      }
      for await v in Transaction.unfinished {
        if case .verified(let t)=v,t.productID==productId,seen.insert(t.id).inserted {
          proofs.append(try await proof(v,owner:owner,now:now,current:false))
        }
      }
      return ["status":"restored","proofs":proofs]
    case "finish":
      guard let id=a["transactionId"] as? String,let pair=pending[id],pair.1==owner,
        a["acknowledgedTransactionId"] as? String==id else{throw V10LicenseFailure("subscription_ack_binding")}
      await pair.0.finish();pending.removeValue(forKey:id);return ["status":"finished"]
    default:throw V10LicenseFailure("subscription_method")
    }
  }
  private func proof(_ verification:VerificationResult<Transaction>,owner:String,now:Int64,current:Bool) async throws -> [String:Any] {
    guard case .verified(let t)=verification,t.productID==productId,t.productType == .autoRenewable else{throw V10LicenseFailure("subscription_unverified")}
    let envelope=try await license.signedStoreKit(owner:owner,jws:verification.jwsRepresentation,currentEntitlement:current,serverNowMs:now)
    pending[String(t.id)]=(t,owner)
    return ["transactionId":String(t.id),"envelope":envelope]
  }
  private func resourceReadiness() async throws {
    guard #available(iOS 26.0,*) else{throw V10LicenseFailure("ios_26_required")}
    for language in ["zh","en"] {
      let locale=try await AppleSpeechResources.locale(language)
      let module=SpeechTranscriber(locale:locale,preset:.timeIndexedProgressiveTranscription)
      let status=await AppleSpeechResources.snapshot(language:language,locale:locale,transcriber:module,stage:"subscription_preflight")
      try status.requireReady()
      guard SystemSpeechVoiceCatalog.resolve(language:language) != nil else{throw V10LicenseFailure("speech_voice_unavailable")}
    }
    _=try AppleSpeechResources.sileroURL()
    let source=Locale.Language(identifier:"zh-Hans"),target=Locale.Language(identifier:"en")
    guard await LanguageAvailability().status(from:source,to:target) == .installed,
      await LanguageAvailability().status(from:target,to:source) == .installed else{throw V10LicenseFailure("translation_resource_not_installed")}
  }
}
