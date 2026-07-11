import CoreML
import Foundation

struct CoreMlQwen3AsrInterfaceReport {
  let modelName: String
  let url: URL
  let inputs: [[String: Any]]
  let outputs: [[String: Any]]

  func payload() -> [String: Any] {
    [
      "modelName": modelName,
      "path": url.path,
      "inputs": inputs,
      "outputs": outputs
    ]
  }
}

enum CoreMlQwen3AsrDiagnostics {
  static func inspect(modelURLs: [(String, URL)]) -> [[String: Any]] {
    let configuration = MLModelConfiguration()
    configuration.computeUnits = .all
    return modelURLs.map { name, url in
      do {
        let model = try MLModel(contentsOf: url, configuration: configuration)
        return CoreMlQwen3AsrInterfaceReport(
          modelName: name,
          url: url,
          inputs: featurePayload(model.modelDescription.inputDescriptionsByName),
          outputs: featurePayload(model.modelDescription.outputDescriptionsByName)
        ).payload()
      } catch {
        return [
          "modelName": name,
          "path": url.path,
          "error": error.localizedDescription
        ]
      }
    }
  }

  static func featurePayload(
    _ features: [String: MLFeatureDescription]
  ) -> [[String: Any]] {
    features
      .sorted { $0.key < $1.key }
      .map { name, description in
        [
          "name": name,
          "type": featureTypeName(description.type),
          "optional": description.isOptional,
          "shape": shapePayload(description)
        ]
      }
  }

  private static func shapePayload(_ description: MLFeatureDescription) -> Any {
    guard let constraint = description.multiArrayConstraint else { return NSNull() }
    return constraint.shape.map { $0.intValue }
  }

  private static func featureTypeName(_ type: MLFeatureType) -> String {
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
