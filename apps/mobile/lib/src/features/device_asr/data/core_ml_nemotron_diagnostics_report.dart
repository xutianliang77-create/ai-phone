import 'dart:convert';

import '../../../app/app_config.dart';
import '../../realtime/data/api/api_health_client.dart';
import '../../../platform/asr/asr_text_segment.dart';
import '../../../platform/asr/mobile_asr_provider.dart';
import '../../../platform/translation/mobile_translation_provider.dart';
import 'core_ml_nemotron_audio_diagnostic.dart';

class CoreMlNemotronDiagnosticsReport {
  static const _appName = 'translation_mobile';
  static const _appVersion = String.fromEnvironment(
    'APP_VERSION',
    defaultValue: '0.1.0',
  );
  static const _appBuildNumber = String.fromEnvironment(
    'APP_BUILD_NUMBER',
    defaultValue: '1',
  );

  const CoreMlNemotronDiagnosticsReport({
    required this.capturedAt,
    required this.config,
    required this.allowDownload,
    required this.apiHealth,
    required this.gatewayHealth,
    required this.apiHealthError,
    required this.gatewayHealthError,
    required this.availability,
    required this.translationAvailability,
    required this.modelDetails,
    required this.selfTestSegments,
    required this.selfTestRunning,
    required this.selfTestMessage,
    required this.error,
  });

  final DateTime capturedAt;
  final AppConfig config;
  final bool allowDownload;
  final ApiHealthInfo? apiHealth;
  final GatewayHealthInfo? gatewayHealth;
  final String? apiHealthError;
  final String? gatewayHealthError;
  final MobileAsrAvailability? availability;
  final MobileTranslationAvailability? translationAvailability;
  final Map<String, Object?> modelDetails;
  final List<AsrTextSegment> selfTestSegments;
  final bool selfTestRunning;
  final String? selfTestMessage;
  final String? error;

  String get filename {
    final timestamp = capturedAt
        .toUtc()
        .toIso8601String()
        .replaceAll(':', '-')
        .replaceAll('.', '-');
    return 'coreml-nemotron-diagnostics-$timestamp.json';
  }

  List<int> toUtf8Bytes() {
    return utf8.encode(const JsonEncoder.withIndent('  ').convert(toJson()));
  }

  Map<String, Object?> toJson() {
    return <String, Object?>{
      'capturedAt': capturedAt.toUtc().toIso8601String(),
      'app': const <String, Object?>{
        'name': _appName,
        'version': _appVersion,
        'buildNumber': _appBuildNumber,
      },
      'runtimeConfig': <String, Object?>{
        'apiBaseUrl': config.apiBaseUrl.toString(),
        'useMockAudio': config.useMockAudio,
        'useDeviceAsr': config.useDeviceAsr,
        'deviceAsrProvider': config.deviceAsrProvider,
        'deviceAsrLanguage': config.deviceAsrLanguage,
        'deviceAsrAutoDownloadModel': config.deviceAsrAutoDownloadModel,
        'deviceAsrModelChunkMs': config.deviceAsrModelChunkMs,
        'useLocalSessions': config.useLocalSessions,
        'useOnDeviceTranslation': config.useOnDeviceTranslation,
        'onDeviceTranslationProvider': config.onDeviceTranslationProvider,
        'onDeviceTranslationRequired': config.onDeviceTranslationRequired,
        'serverOwnedHistory': config.serverOwnedHistory,
        'allowDownloadSelected': allowDownload,
      },
      'provider': config.deviceAsrProvider,
      'language': config.deviceAsrLanguage,
      'modelChunkMs': config.deviceAsrModelChunkMs,
      'autoDownloadEnabledByBuild': config.deviceAsrAutoDownloadModel,
      'allowDownloadSelected': allowDownload,
      'serviceConnection': <String, Object?>{
        'apiBaseUrl': config.apiBaseUrl.toString(),
        'apiBaseUrlLocalOnly': _isLocalOnlyAddress(config.apiBaseUrl.host),
        'api': _apiHealthToJson(apiHealth),
        'realtimeWsEndpointLocalOnly': _usesLocalOnlyEndpoint(
          apiHealth?.realtimeWsEndpoint,
        ),
        'gateway': gatewayHealth?.toJson(),
        'apiError': apiHealthError,
        'gatewayError': gatewayHealthError,
      },
      'availability': availability == null
          ? null
          : <String, Object?>{
              'canStart': availability!.canStart,
              'reason': availability!.reason,
              'message': availability!.message,
              'details': availability!.details,
            },
      'translationAvailability': translationAvailability?.toJson(),
      'modelDetails': modelDetails,
      'selfTest': <String, Object?>{
        'running': selfTestRunning,
        'message': selfTestMessage,
        'audioDiagnostic':
            coreMlNemotronAudioDiagnostic(modelDetails)?.toJson(),
        'segments': selfTestSegments.map(_segmentToJson).toList(),
      },
      'error': error,
    };
  }

  Map<String, Object?> _segmentToJson(AsrTextSegment segment) {
    return <String, Object?>{
      'id': segment.id,
      'textCharCount': segment.text.length,
      'language': segment.language,
      'isFinal': segment.isFinal,
      'confidence': segment.confidence,
    };
  }

  Map<String, Object?>? _apiHealthToJson(ApiHealthInfo? health) {
    if (health == null) return null;
    return <String, Object?>{
      'status': health.status,
      'service': health.service,
      'version': health.version,
      'realtimeWsEndpoint': health.realtimeWsEndpoint,
      'regionEdition': health.regionEdition,
      'dataRegion': health.dataRegion,
      'callProviderPolicy': health.callProviderPolicy,
      'complianceProfile': health.complianceProfile,
    };
  }

  bool _usesLocalOnlyEndpoint(String? endpoint) {
    if (endpoint == null || endpoint.isEmpty) return false;
    final uri = Uri.tryParse(endpoint);
    return uri != null && _isLocalOnlyAddress(uri.host);
  }

  bool _isLocalOnlyAddress(String host) {
    return const <String>{'localhost', '127.0.0.1', '::1', '0.0.0.0'}
        .contains(host.toLowerCase());
  }
}
