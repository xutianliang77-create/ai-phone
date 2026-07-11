import Foundation

struct CoreMlQwen3AsrBundle {
  let variant: String
  let rootURL: URL
  let metadataURL: URL?
  let vocabURL: URL?
  let configURL: URL?
  let embeddingsURL: URL?
  let audioEncoderURL: URL?
  let audioEncoderV2URL: URL?
  let decoderStatefulURL: URL?

  var modelReady: Bool {
    metadataURL != nil
      && vocabURL != nil
      && embeddingsURL != nil
      && audioEncoderURL != nil
      && audioEncoderV2URL != nil
      && decoderStatefulURL != nil
  }

  func modelURLs() -> [(String, URL)] {
    [
      ("audioEncoder", audioEncoderURL),
      ("audioEncoderV2", audioEncoderV2URL),
      ("decoderStateful", decoderStatefulURL)
    ].compactMap { name, url in
      guard let url else { return nil }
      return (name, url)
    }
  }

  func componentPayload() -> [String: Any] {
    [
      "metadata": metadataURL?.path as Any,
      "vocab": vocabURL?.path as Any,
      "config": configURL?.path as Any,
      "embeddings": embeddingsURL?.path as Any,
      "audioEncoder": audioEncoderURL?.path as Any,
      "audioEncoderV2": audioEncoderV2URL?.path as Any,
      "decoderStateful": decoderStatefulURL?.path as Any
    ]
  }
}

final class CoreMlQwen3AsrModelStore {
  private let modelDirectoryName = "Qwen3ASRCoreML"
  private let variants = ["int8", "f32"]

  func findBundle(preferredVariant: String?) -> CoreMlQwen3AsrBundle? {
    let orderedVariants = variantOrder(preferredVariant)
    for root in candidateRoots(variants: orderedVariants) {
      if let bundle = makeBundle(root: root.url, variant: root.variant) {
        return bundle
      }
    }
    return nil
  }

  func scanPayload(preferredVariant: String?) -> [String: Any] {
    let writableDirectories = ensureWritableModelDirectories()
    let reports = candidateRoots(variants: variantOrder(preferredVariant))
      .map { scanReport(root: $0.url, variant: $0.variant) }
    let selected = reports.first { $0["modelReady"] as? Bool == true }
      ?? reports.first { $0["exists"] as? Bool == true }
      ?? reports.first
    return [
      "candidateCount": reports.count,
      "preferredVariant": preferredVariant ?? "",
      "selectedRoot": selected?["root"] as Any,
      "selectedVariant": selected?["variant"] as Any,
      "selectedStatus": selected?["status"] as Any,
      "selectedMissing": selected?["missing"] as Any,
      "writableDirectories": writableDirectories,
      "reports": reports
    ]
  }

  func ensureWritableModelDirectories() -> [String] {
    guard let documents = FileManager.default.urls(
      for: .documentDirectory,
      in: .userDomainMask
    ).first else { return [] }
    let models = documents.appendingPathComponent("Models", isDirectory: true)
    return variants.compactMap { variant in
      let url = models
        .appendingPathComponent(modelDirectoryName, isDirectory: true)
        .appendingPathComponent(variant, isDirectory: true)
      do {
        try FileManager.default.createDirectory(
          at: url,
          withIntermediateDirectories: true
        )
        return url.path
      } catch {
        return nil
      }
    }
  }

  private func variantOrder(_ preferredVariant: String?) -> [String] {
    let normalized = normalizeVariant(preferredVariant)
    return [normalized] + variants.filter { $0 != normalized }
  }

  private func normalizeVariant(_ value: String?) -> String {
    let lowered = (value ?? "int8").lowercased()
    if lowered.contains("f32") { return "f32" }
    return "int8"
  }

  private func candidateRoots(variants: [String]) -> [(variant: String, url: URL)] {
    guard let documents = FileManager.default.urls(
      for: .documentDirectory,
      in: .userDomainMask
    ).first else { return [] }
    let models = documents.appendingPathComponent("Models", isDirectory: true)
    return variants.map { variant in
      (
        variant,
        models
          .appendingPathComponent(modelDirectoryName, isDirectory: true)
          .appendingPathComponent(variant, isDirectory: true)
      )
    }
  }

  private func makeBundle(root: URL, variant: String) -> CoreMlQwen3AsrBundle? {
    guard FileManager.default.fileExists(atPath: root.path) else { return nil }
    return CoreMlQwen3AsrBundle(
      variant: variant,
      rootURL: root,
      metadataURL: component("metadata.json", in: root),
      vocabURL: component("vocab.json", in: root),
      configURL: component("config.json", in: root),
      embeddingsURL: component("qwen3_asr_embeddings.bin", in: root),
      audioEncoderURL: component("qwen3_asr_audio_encoder.mlmodelc", in: root),
      audioEncoderV2URL: component("qwen3_asr_audio_encoder_v2.mlmodelc", in: root),
      decoderStatefulURL: component("qwen3_asr_decoder_stateful.mlmodelc", in: root)
    )
  }

  private func scanReport(root: URL, variant: String) -> [String: Any] {
    let bundle = makeBundle(root: root, variant: variant)
    let exists = FileManager.default.fileExists(atPath: root.path)
    let missing = missingComponents(bundle: bundle)
    let modelReady = bundle?.modelReady ?? false
    return [
      "root": root.path,
      "variant": variant,
      "exists": exists,
      "modelReady": modelReady,
      "status": modelReady ? "ready" : exists ? "model_incomplete" : "model_not_found",
      "missing": missing,
      "components": bundle?.componentPayload() as Any
    ]
  }

  private func missingComponents(bundle: CoreMlQwen3AsrBundle?) -> [String] {
    guard let bundle else {
      return [
        "metadata.json",
        "vocab.json",
        "qwen3_asr_embeddings.bin",
        "qwen3_asr_audio_encoder.mlmodelc",
        "qwen3_asr_audio_encoder_v2.mlmodelc",
        "qwen3_asr_decoder_stateful.mlmodelc"
      ]
    }
    var missing: [String] = []
    if bundle.metadataURL == nil { missing.append("metadata.json") }
    if bundle.vocabURL == nil { missing.append("vocab.json") }
    if bundle.embeddingsURL == nil { missing.append("qwen3_asr_embeddings.bin") }
    if bundle.audioEncoderURL == nil { missing.append("qwen3_asr_audio_encoder.mlmodelc") }
    if bundle.audioEncoderV2URL == nil { missing.append("qwen3_asr_audio_encoder_v2.mlmodelc") }
    if bundle.decoderStatefulURL == nil { missing.append("qwen3_asr_decoder_stateful.mlmodelc") }
    return missing
  }

  private func component(_ name: String, in root: URL) -> URL? {
    let url = root.appendingPathComponent(name, isDirectory: name.hasSuffix(".mlmodelc"))
    return FileManager.default.fileExists(atPath: url.path) ? url : nil
  }
}
