import 'core_ml_nemotron_diagnostics_test.dart' as diagnostics;
import 'core_ml_nemotron_local_mvp_test.dart' as local_mvp;
import 'core_ml_nemotron_self_test.dart' as self_test;

void main() {
  diagnostics.main();
  self_test.main();
  local_mvp.main();
}
