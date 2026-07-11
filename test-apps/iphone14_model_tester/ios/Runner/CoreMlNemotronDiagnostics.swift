import Foundation

final class CoreMlNemotronDiagnosticProvider {
  private let providerId = "coreml_nemotron"
  private let modelId = "nemotron_coreml_2240ms"
  private let scanner = CoreMlNemotronModelScanner()

  func status() -> [String: Any] {
    let scan = scanner.scan()
    return [
      "providerId": providerId,
      "modelId": modelId,
      "providerIntegrated": true,
      "runtimeLinked": false,
      "ready": false,
      "reason": reason(scan: scan),
      "modelScan": scan
    ]
  }

  func start(
    arguments: Any?,
    emit: @escaping ([String: Any]) -> Void
  ) -> [String: Any] {
    let scan = scanner.scan()
    emit([
      "type": "provider.diagnostic",
      "providerId": providerId,
      "modelId": modelId,
      "modelReady": scan["ready"] as? Bool ?? false,
      "runtimeLinked": false,
      "reason": reason(scan: scan),
      "timestampMs": Self.nowMs()
    ])
    emit([
      "type": "error",
      "providerId": providerId,
      "modelId": modelId,
      "message": startMessage(scan: scan),
      "timestampMs": Self.nowMs()
    ])
    return [
      "started": false,
      "providerId": providerId,
      "modelId": modelId,
      "reason": reason(scan: scan),
      "diagnostics": scan
    ]
  }

  func stop(emit: @escaping ([String: Any]) -> Void) {
    emit([
      "type": "stopped",
      "providerId": providerId,
      "modelId": modelId,
      "timestampMs": Self.nowMs()
    ])
  }

  private func reason(scan: [String: Any]) -> String {
    guard scan["ready"] as? Bool == true else {
      return "model_not_staged_in_test_app"
    }
    return "coreml_runtime_not_linked"
  }

  private func startMessage(scan: [String: Any]) -> String {
    if scan["ready"] as? Bool == true {
      return "Nemotron model files are present, but FluidAudio runtime is not linked into this test app yet."
    }
    return "Nemotron model files are not staged in this independent test app. Stage Models/multilingual/2240ms before running CoreML ASR."
  }

  private static func nowMs() -> Int {
    Int(Date().timeIntervalSince1970 * 1000)
  }
}

final class CoreMlNemotronModelScanner {
  private let expectedFiles = [
    "metadata.json",
    "tokenizer.json",
    "preprocessor.mlmodelc",
    "encoder.mlmodelc",
    "decoder.mlmodelc",
    "joint.mlmodelc",
    "decoder_joint.mlmodelc"
  ]

  func scan() -> [String: Any] {
    let reports = candidateRoots().map(scanRoot)
    let selected = reports.first { $0["ready"] as? Bool == true }
      ?? reports.first { $0["exists"] as? Bool == true }
      ?? reports.first
    return [
      "ready": selected?["ready"] as? Bool ?? false,
      "selectedRoot": selected?["root"] as Any,
      "selectedMissing": selected?["missing"] as Any,
      "candidateCount": reports.count,
      "reports": reports
    ]
  }

  private func candidateRoots() -> [URL] {
    var roots: [URL] = []
    if let resourceURL = Bundle.main.resourceURL {
      let models = resourceURL.appendingPathComponent("Models", isDirectory: true)
      roots.append(models.appendingPathComponent("NemotronASRStreaming", isDirectory: true))
      roots.append(
        models
          .appendingPathComponent("multilingual", isDirectory: true)
          .appendingPathComponent("2240ms", isDirectory: true)
      )
    }
    if let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
      let models = documents.appendingPathComponent("Models", isDirectory: true)
      roots.append(models.appendingPathComponent("NemotronASRStreaming", isDirectory: true))
      roots.append(
        models
          .appendingPathComponent("multilingual", isDirectory: true)
          .appendingPathComponent("2240ms", isDirectory: true)
      )
    }
    return roots
  }

  private func scanRoot(_ root: URL) -> [String: Any] {
    let missing = expectedFiles.filter { name in
      !FileManager.default.fileExists(
        atPath: root.appendingPathComponent(name, isDirectory: name.hasSuffix(".mlmodelc")).path
      )
    }
    let exists = FileManager.default.fileExists(atPath: root.path)
    return [
      "root": root.path,
      "exists": exists,
      "ready": exists && missing.isEmpty,
      "missing": missing
    ]
  }
}
