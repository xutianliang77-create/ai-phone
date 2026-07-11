import CoreML
import Foundation

struct CoreMlNemotronBundle {
  let name: String
  let rootURL: URL
  let layout: String
  let encoderURL: URL?
  let decoderURL: URL?
  let jointURL: URL?
  let decoderJointURL: URL?
  let preprocessorURL: URL?
  let vocabURL: URL?
  let languagesURL: URL?
  let configURL: URL?
  let metadataURL: URL?

  func componentPayload() -> [String: Any] {
    [
      "encoder": encoderURL?.path as Any,
      "decoder": decoderURL?.path as Any,
      "joint": jointURL?.path as Any,
      "decoderJoint": decoderJointURL?.path as Any,
      "preprocessor": preprocessorURL?.path as Any,
      "vocab": vocabURL?.path as Any,
      "languages": languagesURL?.path as Any,
      "config": configURL?.path as Any,
      "metadata": metadataURL?.path as Any
    ]
  }

  var isFluidAudioReady: Bool {
    preprocessorURL != nil
      && metadataURL != nil
      && vocabURL != nil
  }
}

final class CoreMlNemotronModelStore {
  private let modelDirectoryName = "NemotronASRStreaming"

  func findBundle() -> CoreMlNemotronBundle? {
    for root in candidateRoots() {
      if let bundle = makeBundle(root: root) {
        return bundle
      }
    }
    return nil
  }

  func scanPayload() -> [String: Any] {
    let reports = candidateRoots().map { scanReport(root: $0) }
    let selected = reports.first { report in
      report["bundleDetected"] as? Bool == true
    } ?? reports.first
    return [
      "candidateCount": reports.count,
      "selectedRoot": selected?["root"] as Any,
      "selectedStatus": selected?["status"] as Any,
      "selectedLayout": selected?["layout"] as Any,
      "selectedMissing": selected?["missing"] as Any,
      "reports": reports
    ]
  }

  func loadBundle() throws -> LoadedCoreMlNemotronBundle {
    guard let bundle = findBundle() else {
      throw NSError(
        domain: "CoreMlNemotronAsr",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Nemotron Core ML bundle was not found"]
      )
    }
    return try LoadedCoreMlNemotronBundle(bundle: bundle)
  }

  private func candidateRoots() -> [URL] {
    var roots: [URL] = []
    appendBundleCandidates(to: &roots)
    appendDocumentsCandidates(to: &roots)
    return roots
  }

  private func appendBundleCandidates(to roots: inout [URL]) {
    if let root = Bundle.main.url(
      forResource: modelDirectoryName,
      withExtension: nil,
      subdirectory: "Models"
    ) {
      roots.append(root)
    }
    appendTierCandidates(
      base: Bundle.main.resourceURL?.appendingPathComponent("Models", isDirectory: true),
      to: &roots
    )
  }

  private func appendDocumentsCandidates(to roots: inout [URL]) {
    guard let documents = FileManager.default.urls(
      for: .documentDirectory,
      in: .userDomainMask
    ).first else { return }
    let models = documents.appendingPathComponent("Models", isDirectory: true)
    roots.append(models.appendingPathComponent(modelDirectoryName, isDirectory: true))
    appendTierCandidates(base: models, to: &roots)
  }

  private func appendTierCandidates(base: URL?, to roots: inout [URL]) {
    guard let base else { return }
    let modelFolders = ["multilingual", "latin"]
    let tiers = ["2240ms", "1120ms", "560ms", "4480ms"]
    for modelFolder in modelFolders {
      for tier in tiers {
        roots.append(
          base
            .appendingPathComponent(modelFolder, isDirectory: true)
            .appendingPathComponent(tier, isDirectory: true)
        )
      }
    }
  }

  private func makeBundle(root: URL) -> CoreMlNemotronBundle? {
    let fileManager = FileManager.default
    guard fileManager.fileExists(atPath: root.path) else { return nil }

    let encoder = component("encoder.mlmodelc", in: root)
    let decoder = component("decoder.mlmodelc", in: root)
    let joint = component("joint.mlmodelc", in: root)
    let decoderJoint = component("decoder_joint.mlmodelc", in: root)
    let preprocessor = component("preprocessor.mlmodelc", in: root)
    let hasSplitCore = encoder != nil && decoder != nil && joint != nil
    let hasFusedCore = encoder != nil && decoderJoint != nil
    guard hasSplitCore || hasFusedCore else { return nil }

    return CoreMlNemotronBundle(
      name: modelDirectoryName,
      rootURL: root,
      layout: hasFusedCore ? "fluid_split_fused" : "split_encoder_decoder_joint",
      encoderURL: encoder,
      decoderURL: decoder,
      jointURL: joint,
      decoderJointURL: decoderJoint,
      preprocessorURL: preprocessor,
      vocabURL: firstExisting(["vocab.json", "tokenizer.json"], in: root),
      languagesURL: component("languages.json", in: root),
      configURL: component("config.json", in: root),
      metadataURL: component("metadata.json", in: root)
    )
  }

  private func scanReport(root: URL) -> [String: Any] {
    let fileManager = FileManager.default
    let encoder = component("encoder.mlmodelc", in: root)
    let decoder = component("decoder.mlmodelc", in: root)
    let joint = component("joint.mlmodelc", in: root)
    let decoderJoint = component("decoder_joint.mlmodelc", in: root)
    let preprocessor = component("preprocessor.mlmodelc", in: root)
    let vocab = firstExisting(["vocab.json", "tokenizer.json"], in: root)
    let metadata = component("metadata.json", in: root)
    let hasSplitCore = encoder != nil && decoder != nil && joint != nil
    let hasFusedCore = encoder != nil && decoderJoint != nil
    let bundleDetected = fileManager.fileExists(atPath: root.path)
      && (hasSplitCore || hasFusedCore)
    let fluidReady = bundleDetected
      && preprocessor != nil
      && metadata != nil
      && vocab != nil
    return [
      "root": root.path,
      "exists": fileManager.fileExists(atPath: root.path),
      "bundleDetected": bundleDetected,
      "status": fluidReady
        ? "ready"
        : bundleDetected ? "model_incomplete" : "model_not_found",
      "layout": hasFusedCore
        ? "fluid_split_fused"
        : hasSplitCore ? "split_encoder_decoder_joint" : "missing",
      "missing": missingComponents(
        hasSplitCore: hasSplitCore,
        hasFusedCore: hasFusedCore,
        encoder: encoder,
        decoder: decoder,
        joint: joint,
        decoderJoint: decoderJoint,
        preprocessor: preprocessor,
        metadata: metadata,
        vocab: vocab
      )
    ]
  }

  private func missingComponents(
    hasSplitCore: Bool,
    hasFusedCore: Bool,
    encoder: URL?,
    decoder: URL?,
    joint: URL?,
    decoderJoint: URL?,
    preprocessor: URL?,
    metadata: URL?,
    vocab: URL?
  ) -> [String] {
    var missing: [String] = []
    if !hasSplitCore && !hasFusedCore {
      if encoder == nil { missing.append("encoder.mlmodelc") }
      if decoder == nil && decoderJoint == nil {
        missing.append("decoder.mlmodelc or decoder_joint.mlmodelc")
      }
      if decoder != nil && joint == nil && decoderJoint == nil {
        missing.append("joint.mlmodelc when decoder_joint.mlmodelc is absent")
      }
    }
    if preprocessor == nil { missing.append("preprocessor.mlmodelc") }
    if metadata == nil { missing.append("metadata.json") }
    if vocab == nil { missing.append("vocab.json or tokenizer.json") }
    return missing
  }

  private func component(_ name: String, in root: URL) -> URL? {
    let url = root.appendingPathComponent(name, isDirectory: name.hasSuffix(".mlmodelc"))
    return FileManager.default.fileExists(atPath: url.path) ? url : nil
  }

  private func firstExisting(_ names: [String], in root: URL) -> URL? {
    for name in names {
      if let url = component(name, in: root) {
        return url
      }
    }
    return nil
  }
}

final class LoadedCoreMlNemotronBundle {
  private let bundle: CoreMlNemotronBundle
  private let models: [String: MLModel]

  init(bundle: CoreMlNemotronBundle) throws {
    self.bundle = bundle
    var loaded: [String: MLModel] = [:]
    let configuration = MLModelConfiguration()
    configuration.computeUnits = .all

    for (name, url) in bundle.modelURLs() {
      loaded[name] = try MLModel(contentsOf: url, configuration: configuration)
    }
    models = loaded
  }

  func payload() -> [String: Any] {
    [
      "modelPath": bundle.rootURL.path,
      "layout": bundle.layout,
      "models": models.mapValues { model in
        [
          "inputs": featurePayload(model.modelDescription.inputDescriptionsByName),
          "outputs": featurePayload(model.modelDescription.outputDescriptionsByName)
        ]
      },
      "components": bundle.componentPayload()
    ]
  }

  private func featurePayload(
    _ features: [String: MLFeatureDescription]
  ) -> [[String: Any]] {
    features
      .sorted { $0.key < $1.key }
      .map { name, description in
        [
          "name": name,
          "type": featureTypeName(description.type),
          "optional": description.isOptional
        ]
      }
  }

  private func featureTypeName(_ type: MLFeatureType) -> String {
    switch type {
    case .invalid:
      return "invalid"
    case .int64:
      return "int64"
    case .double:
      return "double"
    case .string:
      return "string"
    case .image:
      return "image"
    case .multiArray:
      return "multiArray"
    case .dictionary:
      return "dictionary"
    case .sequence:
      return "sequence"
    @unknown default:
      return "unknown"
    }
  }
}

private extension CoreMlNemotronBundle {
  func modelURLs() -> [(String, URL)] {
    [
      ("preprocessor", preprocessorURL),
      ("encoder", encoderURL),
      ("decoder", decoderURL),
      ("joint", jointURL),
      ("decoderJoint", decoderJointURL)
    ].compactMap { name, url in
      guard let url else { return nil }
      return (name, url)
    }
  }
}
