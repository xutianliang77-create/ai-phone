import Foundation
import CoreFoundation

enum LocalResourcePreparationError: String, Error, LocalizedError {
  case unauthorized = "resource_download_not_authorized"
  case invalidIdentity = "resource_request_id_invalid"
  case cancelled = "resource_preparation_cancelled"
  case timeout = "resource_preparation_timeout"
  case busy = "resource_preparation_busy"
  case notReady = "resource_preparation_not_ready"
  case uiUnavailable = "resource_ui_unavailable"
  var errorDescription: String? { rawValue }
}

func localResourcePreparationErrorCode(_ error: Error) -> String {
  if let known = error as? LocalResourcePreparationError { return known.rawValue }
  if error is CancellationError { return LocalResourcePreparationError.cancelled.rawValue }
  var value = error as NSError
  var networkFailure = false
  for _ in 0..<4 {
    if (value.domain == NSCocoaErrorDomain && value.code == NSFileWriteOutOfSpaceError) ||
        (value.domain == NSPOSIXErrorDomain && value.code == 28) { return "resource_storage_full" }
    if (value.domain == NSURLErrorDomain && value.code == NSURLErrorCancelled) ||
        (value.domain == NSCocoaErrorDomain && value.code == NSUserCancelledError) {
      return LocalResourcePreparationError.cancelled.rawValue
    }
    if value.domain == NSURLErrorDomain { networkFailure = true }
    guard let underlying = value.userInfo[NSUnderlyingErrorKey] as? NSError else { break }
    value = underlying
  }
  return networkFailure ? "resource_network_unavailable" : "resource_preparation_failed"
}

func validatedResourceRequestID(_ arguments: [String: Any]) throws -> String {
  guard let id = arguments["requestId"] as? String, !id.isEmpty, id.count <= 128 else {
    throw LocalResourcePreparationError.invalidIdentity
  }
  return id
}

func authorizedResourceRequestID(_ arguments: [String: Any]) throws -> String {
  guard let flag = arguments["downloadAuthorized"] as? NSNumber,
        CFGetTypeID(flag) == CFBooleanGetTypeID(), flag.boolValue else {
    throw LocalResourcePreparationError.unauthorized
  }
  return try validatedResourceRequestID(arguments)
}
