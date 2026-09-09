import Foundation

@main
struct LocalResourcePreparationErrorTest {
  static func main() throws {
    let storage = NSError(domain: NSPOSIXErrorDomain, code: 28)
    precondition(localResourcePreparationErrorCode(storage) == "resource_storage_full")
    precondition(localResourcePreparationErrorCode(NSError(domain: NSCocoaErrorDomain,
      code: NSFileWriteOutOfSpaceError)) == "resource_storage_full")
    precondition(localResourcePreparationErrorCode(NSError(domain: NSURLErrorDomain,
      code: NSURLErrorCannotWriteToFile, userInfo: [NSUnderlyingErrorKey: storage])) == "resource_storage_full")
    precondition(localResourcePreparationErrorCode(NSError(domain: NSURLErrorDomain,
      code: NSURLErrorNotConnectedToInternet)) == "resource_network_unavailable")
    precondition(localResourcePreparationErrorCode(CancellationError()) == "resource_preparation_cancelled")
    precondition(localResourcePreparationErrorCode(NSError(domain: NSCocoaErrorDomain,
      code: NSUserCancelledError)) == "resource_preparation_cancelled")
    precondition(localResourcePreparationErrorCode(LocalResourcePreparationError.unauthorized) == "resource_download_not_authorized")
    precondition(localResourcePreparationErrorCode(LocalResourcePreparationError.notReady) == "resource_preparation_not_ready")
    precondition(localResourcePreparationErrorCode(NSError(domain: "unknown", code: 1)) == "resource_preparation_failed")
    let valid = try validatedResourceRequestID(["requestId": "request-fr-ja"])
    precondition(valid == "request-fr-ja")
    let authorized = try authorizedResourceRequestID(["requestId": "request-fr-ja", "downloadAuthorized": true])
    precondition(authorized == valid)
    for flag: Any in [false, "true", 1, NSNull()] {
      do { _ = try authorizedResourceRequestID(["requestId": valid, "downloadAuthorized": flag]); fatalError("Non-boolean consent accepted") }
      catch LocalResourcePreparationError.unauthorized {}
    }
    for bad: [String: Any] in [[:], ["requestId": ""], ["requestId": 123], ["requestId": String(repeating: "x", count: 129)]] {
      do { _ = try validatedResourceRequestID(bad); fatalError("Invalid ID accepted") }
      catch LocalResourcePreparationError.invalidIdentity {}
    }
    print("PASS resource error mapping, nested disk-full, network/cancel, authorization/readiness codes and request identity bounds")
  }
}
