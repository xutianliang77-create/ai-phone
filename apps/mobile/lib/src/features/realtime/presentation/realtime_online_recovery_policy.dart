import '../data/realtime_runtime_settings.dart';
import 'controllers/realtime_controller.dart';
import 'controllers/realtime_gateway_diagnostic.dart';

bool shouldShowOnlineRecovery({
  required RealtimeProcessingMode processingMode,
  required RealtimeStatus status,
  required RealtimeGatewayDiagnostic? diagnostic,
}) {
  if (processingMode != RealtimeProcessingMode.online) return false;
  if (diagnostic == null) return false;
  return status == RealtimeStatus.listening ||
      status == RealtimeStatus.paused ||
      status == RealtimeStatus.ended;
}
