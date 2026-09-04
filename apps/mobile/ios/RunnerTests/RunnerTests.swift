import Flutter
import integration_test
import UIKit
import XCTest

class RunnerTests: XCTestCase {

  func testIntegrationTest() {
    var result: NSString?
    let passed = IntegrationTestIosTest().testIntegrationTest(&result)
    XCTAssertTrue(passed, result as String? ?? "Integration test failed")
  }

}
