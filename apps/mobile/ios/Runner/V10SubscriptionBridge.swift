import Flutter
import StoreKit
import UIKit
import Speech
import Translation
import CryptoKit

/// StoreKit is the only source of purchase JWS and introductory-offer
/// eligibility. Dart cannot ask the enclave to sign an arbitrary transaction.
@MainActor
final class V10SubscriptionBridge: NSObject, @preconcurrency FlutterStreamHandler {
  private let license: V10DeviceLicenseBridge
  private var pending: [String:(Transaction,String,Bool)] = [:]
  private var busy = false
  private var loadAttempt = 0
  private var loadEvents = [[String:Any]]()
  private var loadIds = [Int:String]()
  private var loadEventsLoaded = false
  private var updateSink: FlutterEventSink?
  private var updatesTask: Task<Void,Never>?
  init(license: V10DeviceLicenseBridge) { self.license = license; super.init() }
  private var productId: String { Bundle.main.object(forInfoDictionaryKey:"WujieV10SubscriptionProductId") as? String ?? "" }
  func register(messenger: FlutterBinaryMessenger) {
    FlutterEventChannel(name:"translation_mobile/v10_subscription/events",binaryMessenger:messenger).setStreamHandler(self)
    if updatesTask == nil {
      updatesTask=Task { @MainActor [weak self] in
        for await update in Transaction.updates {
          guard let self else { return }
          if case .verified(let transaction)=update,transaction.productID==self.productId {
            if let token=transaction.appAccountToken {UserDefaults.standard.set(true,forKey:self.approvalKey(token))}
            self.updateSink?(["type":"unfinished_transaction"])
          }
        }
      }
    }
    FlutterMethodChannel(name:"translation_mobile/v10_subscription",binaryMessenger:messenger).setMethodCallHandler{[weak self]call,result in Task{@MainActor in
      do { guard let self else{return}; result(try await self.handle(call)) }
      catch {result(FlutterError(code:(error as? V10LicenseFailure)?.code ?? "subscription_unavailable",message:"订阅操作未完成，请保留原购买记录并重试同步。",details:nil))}
    }}
  }
  func onListen(withArguments arguments:Any?,eventSink events:@escaping FlutterEventSink) -> FlutterError? {
    updateSink=events
    Task { @MainActor [weak self] in
      guard let self else {return}
      for await value in Transaction.unfinished {
        if case .verified(let transaction)=value,transaction.productID==self.productId {
          if let token=transaction.appAccountToken {UserDefaults.standard.set(true,forKey:self.approvalKey(token))}
          self.updateSink?(["type":"unfinished_transaction"])
        }
      }
    }
    return nil
  }
  func onCancel(withArguments arguments:Any?) -> FlutterError? { updateSink=nil; return nil }
  private func approvalKey(_ token:UUID) -> String {
    let data=Data("\(productId):\(token.uuidString.lowercased())".utf8)
    let digest=SHA256.hash(data:data).map {String(format:"%02x",$0)}.joined()
    return "v10-pending-approval.\(digest)"
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
    if let id=loadIds[attempt] { event["requestId"]=id }
    let allowedFlags = ["productConfigured","idMatch","typeMatch","priceMatch","currencyMatch","periodMatch","trialConfigured",
      "offerPresent","offerFreeTrial","offerPayUpFront","offerPayAsYouGo","offerUnitWeek","offerUnitDay",
      "offerValueOne","offerValueSeven","offerCountOne"]
    for (key,value) in flags where allowedFlags.contains(key) { event[key]=value }
    if let count { event["productCount"] = min(3,max(0,count)) }
    if let error {
      let code=(error as? V10LicenseFailure)?.code
      let allowedCodes=["subscription_product_mismatch","subscription_trial_not_configured","storekit_unavailable","device_account_required"]
      var category=code.flatMap { allowedCodes.contains($0) ? $0 : nil } ?? "subscription_unavailable"
      if let storeError=error as? StoreKitError {
        switch storeError {
        case .networkError: category="storekit_network_error"
        case .systemError: category="storekit_system_error"
        case .notAvailableInStorefront: category="storekit_storefront_unavailable"
        case .notEntitled: category="storekit_not_entitled"
        case .userCancelled: category="storekit_cancelled"
        case .unsupported: category="storekit_unsupported"
        default: category="storekit_other"
        }
      }
      event["errorCode"] = category
      let native=error as NSError
      if ["SKErrorDomain","ASDErrorDomain","AMSErrorDomain","NSURLErrorDomain"].contains(native.domain) {
        event["nativeErrorDomain"] = native.domain
        event["nativeErrorCode"] = native.code
      }
    }
    guard let documents=FileManager.default.urls(for:.documentDirectory,in:.userDomainMask).first else { return }
    let file=documents.appendingPathComponent("wujie-subscription-native-stages.json")
    if !loadEventsLoaded {
      // Import only allowlisted metadata from an earlier process/build.
      if let data=try? Data(contentsOf:file),data.count<=65536,
         let root=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],
         let events=root["events"] as? [[String:Any]] {
        let stages=["load_started","product_config_checked","product_request_started","product_empty","product_received","eligibility_started","eligibility_finished","trial_checked","load_completed","load_failed"]
        let codes=["subscription_product_mismatch","subscription_trial_not_configured","storekit_unavailable","device_account_required","subscription_unavailable","storekit_network_error","storekit_system_error","storekit_storefront_unavailable","storekit_not_entitled","storekit_cancelled","storekit_unsupported","storekit_other"]
        for old in events.suffix(30) {
          guard let oldStage=old["stage"] as? String,stages.contains(oldStage),
            let oldAttempt=old["attempt"] as? Int,(1...1000000).contains(oldAttempt),
            let duration=old["durationMs"] as? Int,(0...600000).contains(duration),
            let at=old["at"] as? String,ISO8601DateFormatter().date(from:at) != nil else { continue }
          var safe:[String:Any]=["stage":oldStage,"attempt":oldAttempt,"durationMs":duration,"at":at]
          if let id=old["requestId"] as? String,id.range(of:"^[a-f0-9]{32}$",options:.regularExpression) != nil { safe["requestId"]=id }
          for key in allowedFlags { if let value=old[key] as? Bool { safe[key]=value } }
          if let count=old["productCount"] as? Int,(0...3).contains(count) { safe["productCount"]=count }
          if let code=old["errorCode"] as? String,codes.contains(code) { safe["errorCode"]=code }
          if let domain=old["nativeErrorDomain"] as? String,["SKErrorDomain","ASDErrorDomain","AMSErrorDomain","NSURLErrorDomain"].contains(domain),
             let number=old["nativeErrorCode"] as? Int {safe["nativeErrorDomain"]=domain;safe["nativeErrorCode"]=number}
          loadEvents.append(safe)
        }
      }
      loadEventsLoaded=true
    }
    loadEvents.append(event)
    if loadEvents.count > 30 { loadEvents.removeFirst(loadEvents.count-30) }
    let payload:[String:Any] = ["build":Bundle.main.object(forInfoDictionaryKey:"CFBundleVersion") as? String ?? "unknown",
      "credentialsRecorded":false,"events":loadEvents]
    guard let data=try? JSONSerialization.data(withJSONObject:payload) else { return }
    try? data.write(to:file,options:.atomic)
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
  // Only product metadata is recorded. Offer eligibility, account identity,
  // transaction data and raw StoreKit payloads remain excluded.
  private func offerDiagnosticFlags(_ offer:Product.SubscriptionOffer?,configured:Bool) -> [String:Bool] {
    var flags=["trialConfigured":configured,"offerPresent":offer != nil]
    guard let offer else { return flags }
    flags["offerFreeTrial"]=offer.paymentMode == .freeTrial
    flags["offerPayUpFront"]=offer.paymentMode == .payUpFront
    flags["offerPayAsYouGo"]=offer.paymentMode == .payAsYouGo
    flags["offerUnitWeek"]=offer.period.unit == .week
    flags["offerUnitDay"]=offer.period.unit == .day
    flags["offerValueOne"]=offer.period.value == 1
    flags["offerValueSeven"]=offer.period.value == 7
    flags["offerCountOne"]=offer.periodCount == 1
    return flags
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
      if let id=a["diagnosticId"] as? String,id.range(of:"^[a-f0-9]{32}$",options:.regularExpression) != nil { loadIds[attempt]=id }
      defer { loadIds.removeValue(forKey:attempt) }
      recordLoad(attempt,"load_started",started:started)
      do {
        let p=try await product(diagnosticAttempt:attempt,started:started)
        recordLoad(attempt,"eligibility_started",started:started)
        let eligible=await p.subscription!.isEligibleForIntroOffer
        recordLoad(attempt,"eligibility_finished",started:started)
        let trial=trialConfigured(p)
        recordLoad(attempt,"trial_checked",started:started,
          flags:offerDiagnosticFlags(p.subscription?.introductoryOffer,configured:trial))
        guard trial else{throw V10LicenseFailure("subscription_trial_not_configured")}
        recordLoad(attempt,"load_completed",started:started)
        let approvalPending=(a["appAccountToken"] as? String).flatMap(UUID.init(uuidString:))
          .map { UserDefaults.standard.bool(forKey:approvalKey($0)) } ?? false
        return ["productId":p.id,"displayName":p.displayName,"priceText":p.displayPrice,"priceMinorCny":1000,
          "currency":"CNY","period":"P1M","trialDays":7,"trialEligible":eligible,"validated":true,
          "pendingApproval":approvalPending]
      } catch {
        recordLoad(attempt,"load_failed",started:started,error:error)
        throw error
      }
    case "purchase":
      guard !busy,let token=a["appAccountToken"] as? String,let uuid=UUID(uuidString:token),
        let now=a["serverNowMs"] as? Int64,a["consentConfirmed"] as? Bool==true else{throw V10LicenseFailure("subscription_consent_required")}
      guard !UserDefaults.standard.bool(forKey:approvalKey(uuid)) else{throw V10LicenseFailure("subscription_pending_approval")}
      busy=true;defer{busy=false}
      try await resourceReadiness()
      let p=try await product();guard trialConfigured(p) else{throw V10LicenseFailure("subscription_trial_not_configured")}
      // Re-read eligibility immediately before displaying Apple's sheet. A
      // changed offer must return to our actual-terms UI before any purchase.
      let eligible=await p.subscription!.isEligibleForIntroOffer
      guard a["trialEligible"] as? Bool==eligible else{throw V10LicenseFailure("subscription_offer_changed")}
      switch try await p.purchase(options:[.appAccountToken(uuid)]) {
      case .success(let verification):
        // A successful Apple purchase is not complete until the server has
        // durably acknowledged it and StoreKit finish succeeds.
        UserDefaults.standard.set(true,forKey:approvalKey(uuid))
        if case .verified(let transaction)=verification,transaction.appAccountToken != uuid {throw V10LicenseFailure("subscription_account_mismatch")}
        return ["status":"success","proofs":[try await proof(verification,owner:owner,now:now,current:false)]]
      case .pending:UserDefaults.standard.set(true,forKey:approvalKey(uuid));return ["status":"pending","proofs":[]]
      case .userCancelled:return ["status":"cancelled","proofs":[]]
      @unknown default:throw V10LicenseFailure("subscription_unknown_result")
      }
    case "restore","pending":
      guard !busy,let now=a["serverNowMs"] as? Int64,let raw=a["appAccountToken"] as? String,
        let uuid=UUID(uuidString:raw) else{throw V10LicenseFailure("subscription_busy")}
      busy=true;defer{busy=false}
      if call.method=="restore" {guard a["userInitiated"] as? Bool==true else{throw V10LicenseFailure("restore_consent_required")};try await AppStore.sync()}
      var proofs=[[String:Any]](),seen=Set<UInt64>()
      for await v in Transaction.currentEntitlements {
        if case .verified(let t)=v,t.productID==productId,(call.method=="restore" || t.appAccountToken == nil || t.appAccountToken == uuid),seen.insert(t.id).inserted {
          proofs.append(try await proof(v,owner:owner,now:now,current:true,userInitiatedRestore:call.method=="restore",targetAccountToken:uuid.uuidString))
        }
      }
      for await v in Transaction.unfinished {
        if case .verified(let t)=v,t.productID==productId,(t.appAccountToken == nil || t.appAccountToken == uuid),seen.insert(t.id).inserted {
          proofs.append(try await proof(v,owner:owner,now:now,current:false))
        }
      }
      return ["status":"restored","proofs":proofs]
    case "clearPendingApproval":
      guard !busy,a["userConfirmedDecline"] as? Bool==true,
        let raw=a["appAccountToken"] as? String,let uuid=UUID(uuidString:raw) else{throw V10LicenseFailure("subscription_confirmation_required")}
      busy=true;defer{busy=false}
      // Apple may send no transaction when an Ask-to-Buy request is declined.
      // The customer must confirm that outcome; do not silently clear a
      // verified unfinished or currently entitled transaction.
      for await v in Transaction.unfinished {
        if case .verified(let t)=v,t.productID==productId,(t.appAccountToken == nil || t.appAccountToken == uuid) {
          throw V10LicenseFailure("subscription_sync_required")
        }
      }
      for await v in Transaction.currentEntitlements {
        if case .verified(let t)=v,t.productID==productId,(t.appAccountToken == nil || t.appAccountToken == uuid) {
          throw V10LicenseFailure("subscription_already_active")
        }
      }
      UserDefaults.standard.removeObject(forKey:approvalKey(uuid));return ["status":"cleared"]
    case "finish":
      guard let id=a["transactionId"] as? String,let pair=pending[id],pair.1==owner,
        let raw=a["appAccountToken"] as? String,let uuid=UUID(uuidString:raw),
        (pair.0.appAccountToken == nil || pair.0.appAccountToken == uuid || (pair.2 && a["restoreAcknowledged"] as? Bool==true)),
        a["acknowledgedTransactionId"] as? String==id else{throw V10LicenseFailure("subscription_ack_binding")}
      await pair.0.finish()
      UserDefaults.standard.removeObject(forKey:approvalKey(uuid))
      if pair.2,let old=pair.0.appAccountToken {UserDefaults.standard.removeObject(forKey:approvalKey(old))}
      pending.removeValue(forKey:id);return ["status":"finished"]
    default:throw V10LicenseFailure("subscription_method")
    }
  }
  private func proof(_ verification:VerificationResult<Transaction>,owner:String,now:Int64,current:Bool,userInitiatedRestore:Bool=false,targetAccountToken:String?=nil) async throws -> [String:Any] {
    guard case .verified(let t)=verification,t.productID==productId,t.productType == .autoRenewable else{throw V10LicenseFailure("subscription_unverified")}
    let envelope=try await license.signedStoreKit(owner:owner,jws:verification.jwsRepresentation,currentEntitlement:current,serverNowMs:now,userInitiatedRestore:userInitiatedRestore,targetAccountToken:targetAccountToken)
    pending[String(t.id)]=(t,owner,current && userInitiatedRestore)
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
