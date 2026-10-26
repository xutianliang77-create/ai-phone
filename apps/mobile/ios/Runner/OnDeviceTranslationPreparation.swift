import SwiftUI
import Translation
import UIKit

/// A temporary SDK preparation sheet attached to the existing Flutter view.
/// Never replaces the root/Scene or translates sample text. The SDK cancellation
/// closure is retained only while its attached view is alive.
@available(iOS 26.0, *)
@MainActor
final class OnDeviceTranslationPreparation: ObservableObject {
  let id: String
  @Published private(set) var configuration: TranslationSession.Configuration?
  private var finished = false
  private var presenting = false
  private var finishError: Error?
  private var continuation: CheckedContinuation<Void, Error>?
  private var host: UIViewController?
  private var cancelSession: (() -> Void)?
  private var deadline: Task<Void, Never>?
  init(id: String) { self.id = id }

  func ensureActive() throws {
    if finished { throw LocalResourcePreparationError.cancelled }
  }

  func run(source: Locale.Language, target: Locale.Language, presenter: UIViewController?) async throws {
    try ensureActive()
    guard let presenter, presenter.viewIfLoaded?.window != nil,
          presenter.view.window?.windowScene?.activationState == .foregroundActive,
          presenter.presentedViewController == nil else { throw LocalResourcePreparationError.uiUnavailable }
    try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
      let view = TranslationPreparationView(source: source, target: target, preparation: self)
      let host = UIHostingController(rootView: view)
      host.modalPresentationStyle = .pageSheet
      host.isModalInPresentation = true
      self.host = host
      presenting = true
      presenter.present(host, animated: true) { [weak self] in
        guard let self else { return }
        self.presenting = false
        if self.finished { self.dismissAndReply() }
        else { self.configuration = .init(source: source, target: target) }
      }
      deadline = Task { @MainActor [weak self] in
        do { try await Task.sleep(nanoseconds: 300_000_000_000) }
        catch { return }
        self?.finish(LocalResourcePreparationError.timeout)
      }
    }
  }

  fileprivate func install(_ session: TranslationSession) async {
    guard !finished else { return }
    // Used only while its attached view is alive; cleared before dismissal.
    cancelSession = { session.cancel() }
    do {
      try await session.prepareTranslation()
      guard !finished else { return }
      cancelSession = nil
      finish(nil)
    } catch {
      guard !finished else { return }
      cancelSession = nil
      finish(error)
    }
  }

  func cancel() { finish(LocalResourcePreparationError.cancelled) }
  func viewDisappeared() {
    // SwiftUI invalidates the SDK session when its attached view disappears.
    cancelSession = nil
    finish(LocalResourcePreparationError.cancelled)
  }
  private func finish(_ error: Error?) {
    guard !finished else { return }
    finished = true
    finishError = error
    deadline?.cancel(); deadline = nil
    cancelSession?(); cancelSession = nil
    configuration = nil
    if !presenting { dismissAndReply() }
  }

  private func dismissAndReply() {
    let reply = continuation; continuation = nil
    let error = finishError
    let complete: () -> Void = {
      if let error { reply?.resume(throwing: error) } else { reply?.resume() }
    }
    if let host { self.host = nil; host.dismiss(animated: true, completion: complete) }
    else { complete() }
  }
}

@available(iOS 26.0, *)
private struct TranslationPreparationView: View {
  let source: Locale.Language
  let target: Locale.Language
  @ObservedObject var preparation: OnDeviceTranslationPreparation
  private var chinese: Bool { Locale.current.language.languageCode?.identifier == "zh" }
  var body: some View {
    VStack(spacing: 20) {
      Text(chinese ? "准备离线翻译资源" : "Prepare offline translation").font(.headline)
      Text("\(source.minimalIdentifier) → \(target.minimalIdentifier)")
      ProgressView()
      Text(chinese ? "请完成系统语言包确认。这里只准备资源，不识别或翻译语音。" :
        "Complete the system language-pack prompt. This only prepares resources; no speech or text is translated.")
      Button(chinese ? "取消准备" : "Cancel preparation", action: preparation.cancel)
    }
    .padding(24)
    .translationTask(preparation.configuration) { session in await preparation.install(session) }
    .onDisappear { preparation.viewDisappeared() }
  }
}
