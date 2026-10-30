import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/diagnostics/control_diagnostic_policy.dart';
import 'package:translation_mobile/src/platform/diagnostics/control_transport_trace.dart';

void main() {
  test('diagnostic flags alone cannot enable QA behavior in a non-QA build', () {
    expect(const bool.fromEnvironment('WUJIE_CONTROL_DIAGNOSTICS'), isTrue);
    expect(const bool.fromEnvironment('WUJIE_CONTROL_DIAGNOSTICS_READONLY'), isTrue);
    expect(const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE'), isNot('A13_QA'));
    expect(controlDiagnosticReadOnly, isFalse);
    expect(newControlDiagnosticId(path: '/v10/device/configuration'), isNull);
  });
}
