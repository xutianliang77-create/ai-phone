/// Development-only diagnostic package. Normal builds never set these flags.
const bool controlDiagnosticReadOnly =
    String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') == 'A13_QA' &&
    bool.fromEnvironment('WUJIE_CONTROL_DIAGNOSTICS') &&
    bool.fromEnvironment('WUJIE_CONTROL_DIAGNOSTICS_READONLY');

void requireDiagnosticReadOnlyRequest(String method, String path) {
  if (controlDiagnosticReadOnly &&
      !(method == 'GET' && path == '/auth/deployment')) {
    throw StateError('control_diagnostic_read_only');
  }
}
