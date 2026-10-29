import AVFoundation
import Flutter
import Speech

/// Reuses the selected SpeechAnalyzer session; this product bridge has no
/// online endpoint, prerecorded probe, server fallback or inference download.
@MainActor
final class V10AppleSpeechBridge: NSObject, FlutterStreamHandler {
  private let coordinator: AudioSessionCoordinator
  private let license: V10DeviceLicenseBridge
  private var sink: FlutterEventSink?
  private var session: AnyObject?
  private var preparation: Task<Void,Error>?
  private var preparationId: String?
  private var progress: Progress?
  private var leaseId: String?
  init(coordinator:AudioSessionCoordinator,license:V10DeviceLicenseBridge){self.coordinator=coordinator;self.license=license}
  func register(messenger:FlutterBinaryMessenger){
    FlutterMethodChannel(name:"translation_mobile/apple_speech_asr",binaryMessenger:messenger).setMethodCallHandler{[weak self]call,result in Task{@MainActor in
      do{guard let self else{return};result(try await self.handle(call))}catch{
        let native=error as NSError
        let domain=native.domain.range(of:"^[A-Za-z0-9._-]{1,120}$",options:.regularExpression) != nil ? native.domain:"unclassified"
        result(FlutterError(code:(error as? AppleSpeechFailure)?.rawValue ?? (error as? V10LicenseFailure)?.code ?? localResourcePreparationErrorCode(error),message:"本机识别未就绪",
          details:["stage":call.method,"nativeErrorDomain":domain,"nativeErrorCode":native.code]))
      }
    }}
    FlutterEventChannel(name:"translation_mobile/apple_speech_asr/events",binaryMessenger:messenger).setStreamHandler(self)
  }
  func onListen(withArguments a:Any?,eventSink events:@escaping FlutterEventSink)->FlutterError?{sink=events;return nil}
  func onCancel(withArguments a:Any?)->FlutterError?{sink=nil;Task{@MainActor in await stopForLicense()};return nil}
  @discardableResult func stopForLicense() async -> Bool {
    guard #available(iOS 26.0,*),let current=session as? AppleSpeechSession else{return true}
    let stopped=await current.stopForAuthorization()
    if stopped,session===current{session=nil;leaseId=nil}
    return stopped
  }
  private func handle(_ call:FlutterMethodCall) async throws -> Any {
    guard #available(iOS 26.0,*) else {
      if call.method=="isAvailable"{return ["canStart":false,"reason":"ios_26_required"]}
      throw V10LicenseFailure("ios_26_required")
    }
    let a=call.arguments as? [String:Any] ?? [:],language=a["language"] as? String ?? "auto"
    let pair=a["automaticPair"] as? [String] ?? AppleSpeechLanguageRouter.languages
    if language=="auto" && (pair.count != 2 || Set(pair) != Set(AppleSpeechLanguageRouter.languages)) {
      throw V10LicenseFailure("device_language_not_qualified")
    }
    if a["prerecordedInput"] != nil||a["inputKind"] != nil{throw V10LicenseFailure("product_capture_only")}
    switch call.method {
    case "requestPermission":
      let microphone=await withCheckedContinuation{c in AVAudioSession.sharedInstance().requestRecordPermission{c.resume(returning:$0)}}
      let speech=await withCheckedContinuation{c in SFSpeechRecognizer.requestAuthorization{c.resume(returning:$0)}}
      guard microphone,speech == .authorized else{throw V10LicenseFailure("permission_denied")};return [:]
    case "isAvailable":
      var payload=await AppleSpeechResources.availability(language:language,configuration:try AppleSpeechConfiguration(arguments:a),automaticPair:pair)
      if preparation != nil{payload["canStart"]=false;payload["reason"]="resource_preparation_busy"};return payload
    case "prepare":
      try await prepare(language,a,pair);return [:]
    case "cancelPreparation":
      if preparationId==a["requestId"] as? String{preparation?.cancel();progress?.cancel()};return [:]
    case "start":
      guard session==nil,preparation==nil,let capture=a["captureId"] as? String,!capture.isEmpty,
        let policy=a["languagePolicyKey"] as? String,!policy.isEmpty else{throw AppleSpeechFailure.busy}
      if language=="auto" && policy != "\(AppleSpeechLanguageRouter.version):\(pair.joined(separator:":"))" {
        throw V10LicenseFailure("device_language_policy_mismatch")
      }
      let checkedLanguages=language=="auto" ? pair:[language]
      let lease=try license.currentLeaseId()
      for value in checkedLanguages{try license.require(component:"asr",language:value,leaseId:lease)}
      let current=AppleSpeechSession(coordinator:coordinator,authorizationCheck:{[weak license] in
        guard let license else{throw V10LicenseFailure("authorization_required")}
        for value in checkedLanguages{try license.require(component:"asr",language:value,leaseId:lease)}
      }){[weak self]event in self?.sink?(event)}
      session=current;leaseId=lease
      do{try await current.start(language:language,download:false,captureId:capture,languagePolicyKey:policy,automaticPair:pair,configuration:try AppleSpeechConfiguration(arguments:a))}
      catch{let stopped=await current.stopForAuthorization();if stopped,session===current{session=nil;leaseId=nil};throw error};return [:]
    case "stop":
      if let current=session as? AppleSpeechSession{try await current.stop();if session===current{session=nil;leaseId=nil}};return [:]
    case "diagnostics":return (session as? AppleSpeechSession)?.diagnostics() ?? ["running":false]
    default:throw V10LicenseFailure("unsupported_native_method")
    }
  }
  @available(iOS 26.0,*)
  private func prepare(_ language:String,_ a:[String:Any],_ pair:[String]) async throws {
    guard preparation==nil,session==nil else{throw LocalResourcePreparationError.busy}
    let download=a["autoDownloadModel"] as? Bool==true
    let id=download ? try authorizedResourceRequestID(a):UUID().uuidString
    preparationId=id
    let task=Task{@MainActor in
      _=try AppleSpeechResources.sileroURL()
      for value in (language=="auto" ? pair:[language]) {
      let locale=try await AppleSpeechResources.locale(value)
      let transcriber=SpeechTranscriber(locale:locale,preset:.timeIndexedProgressiveTranscription)
      var state=await AppleSpeechResources.snapshot(language:value,locale:locale,transcriber:transcriber,stage:"prepare")
      if !download && state.canPrepareLocally{_ = try await AssetInventory.reserve(locale:locale)}
      try Task.checkCancellation()
      state=await AppleSpeechResources.snapshot(language:value,locale:locale,transcriber:transcriber,stage:"reserved")
      if !state.canStart{
        guard download else{throw AppleSpeechResourceReadinessError(snapshot:state)}
        if let request=try await AssetInventory.assetInstallationRequest(supporting:[transcriber]){self.progress=request.progress;try await request.downloadAndInstall()}
      }
      try Task.checkCancellation()
      let final=await AppleSpeechResources.snapshot(language:value,locale:locale,transcriber:transcriber,stage:"completed");try final.requireReady()
      }
    }
    preparation=task;defer{preparation=nil;preparationId=nil;progress=nil}
    do{try await appleSpeechWithDeadline(nanoseconds:300000000000){try await task.value}}catch{task.cancel();progress?.cancel();throw error}
  }
}
