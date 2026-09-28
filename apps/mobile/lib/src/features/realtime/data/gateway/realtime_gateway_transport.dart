import '../api/realtime_session.dart';
import '../../../../platform/asr/device_text_language.dart';

Uri realtimeGatewayEndpoint(RealtimeSession session) => session.endpoint;

Iterable<String> realtimeGatewayProtocols(RealtimeSession session) => <String>[
      'ai-phone.realtime.v1',
      'ai-phone.token.${session.realtimeToken}',
      if (session.syncBinding != null && supportsDeviceTextLanguage) deviceTextLanguageProtocol,
    ];
