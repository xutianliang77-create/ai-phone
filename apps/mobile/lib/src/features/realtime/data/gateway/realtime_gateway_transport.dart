import '../api/realtime_session.dart';

Uri realtimeGatewayEndpoint(RealtimeSession session) => session.endpoint;

Iterable<String> realtimeGatewayProtocols(RealtimeSession session) => <String>[
      'ai-phone.realtime.v1',
      'ai-phone.token.${session.realtimeToken}',
    ];
