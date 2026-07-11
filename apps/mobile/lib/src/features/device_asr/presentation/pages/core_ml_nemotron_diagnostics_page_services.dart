part of 'core_ml_nemotron_diagnostics_page.dart';

Future<void> _checkDiagnosticsServices(
  _CoreMlNemotronDiagnosticsPageState state,
) async {
  state._applyState(() {
    state._busy = true;
    state._error = null;
    state._gatewayHealth = null;
    state._apiHealthError = null;
    state._gatewayHealthError = null;
  });
  try {
    state._apiHealth = await state._apiHealthFetcher(state._config.apiBaseUrl);
    final endpoint = state._apiHealth?.realtimeWsEndpoint;
    if (endpoint != null && endpoint.isNotEmpty) {
      try {
        state._gatewayHealth = await state._gatewayHealthFetcher(endpoint);
      } catch (error) {
        state._gatewayHealth = null;
        state._gatewayHealthError = diagnosticsDisplayMessage(error);
      }
    }
  } catch (error) {
    state._apiHealth = null;
    state._gatewayHealth = null;
    state._apiHealthError = diagnosticsDisplayMessage(error);
  } finally {
    state._applyState(() => state._busy = false);
  }
}

Future<void> _refreshTranslationAvailability(
  _CoreMlNemotronDiagnosticsPageState state,
) async {
  final provider = state._translationProvider;
  final config = diagnosticsTranslationConfig(state._config);
  if (provider == null) {
    state._translationAvailability = _translationUnavailable(
      config,
      'on_device_translation_disabled',
    );
    return;
  }
  if (provider is MobileTranslationDiagnostics) {
    final diagnostics = provider as MobileTranslationDiagnostics;
    state._translationAvailability = await diagnostics.availability(config);
    return;
  }
  state._translationAvailability = _translationUnavailable(
    config,
    'translation_diagnostics_unavailable',
  );
}

MobileTranslationAvailability _translationUnavailable(
  MobileTranslationConfig config,
  String reason,
) {
  return MobileTranslationAvailability(
    available: false,
    provider: 'unavailable',
    sourceLanguage: config.sourceLanguage,
    targetLanguage: config.targetLanguage,
    status: 'unavailable',
    reason: reason,
  );
}
