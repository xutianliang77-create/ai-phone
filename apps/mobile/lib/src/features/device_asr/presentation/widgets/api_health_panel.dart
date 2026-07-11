import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../realtime/data/api/api_health_client.dart';
import 'core_ml_nemotron_diagnostics_widgets.dart';

class ApiHealthPanel extends StatelessWidget {
  const ApiHealthPanel({
    required this.apiBaseUrl,
    this.health,
    this.gatewayHealth,
    this.error,
    this.gatewayError,
    super.key,
  });

  final Uri apiBaseUrl;
  final ApiHealthInfo? health;
  final GatewayHealthInfo? gatewayHealth;
  final String? error;
  final String? gatewayError;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final health = this.health;
    return Column(
      children: <Widget>[
        StatusRow(label: l10n.apiBaseUrl, value: apiBaseUrl.toString()),
        if (_isLocalOnlyAddress(apiBaseUrl.host))
          StatusRow(label: l10n.warning, value: l10n.localAddressWarning),
        StatusRow(
          label: l10n.apiHealthStatus,
          value: health == null
              ? l10n.notChecked
              : l10n.diagnosticsValue(health.status),
        ),
        ..._apiRows(context, health),
        if (_usesLocalOnlyEndpoint(health?.realtimeWsEndpoint))
          StatusRow(label: l10n.warning, value: l10n.localAddressWarning),
        StatusRow(
          label: l10n.gatewayHealthStatus,
          value: gatewayHealth == null
              ? l10n.notChecked
              : l10n.diagnosticsValue(gatewayHealth!.status),
        ),
        ..._gatewayRows(context, gatewayHealth),
        if (error != null)
          StatusRow(label: l10n.lastError, value: l10n.errorMessage(error!)),
        if (gatewayError != null)
          StatusRow(
            label: l10n.gatewayHealthStatus,
            value: l10n.errorMessage(gatewayError!),
          ),
      ],
    );
  }

  List<Widget> _apiRows(BuildContext context, ApiHealthInfo? health) {
    final l10n = context.l10n;
    if (health == null) return const <Widget>[];
    return <Widget>[
      if (health.service != null)
        StatusRow(label: l10n.apiService, value: health.service!),
      if (health.version != null)
        StatusRow(label: l10n.serviceVersion, value: health.version!),
      if (health.realtimeWsEndpoint != null)
        StatusRow(
          label: l10n.realtimeWsEndpoint,
          value: health.realtimeWsEndpoint!,
        ),
      if (health.regionEdition != null)
        StatusRow(
          label: l10n.regionEdition,
          value: l10n.diagnosticsValue(health.regionEdition!),
        ),
      if (health.dataRegion != null)
        StatusRow(label: l10n.dataRegion, value: health.dataRegion!),
      if (health.callProviderPolicy != null)
        StatusRow(
          label: l10n.callProviderPolicy,
          value: l10n.diagnosticsValue(health.callProviderPolicy!),
        ),
      if (health.complianceProfile != null)
        StatusRow(
          label: l10n.complianceProfile,
          value: l10n.diagnosticsValue(health.complianceProfile!),
        ),
    ];
  }

  List<Widget> _gatewayRows(
    BuildContext context,
    GatewayHealthInfo? gatewayHealth,
  ) {
    final l10n = context.l10n;
    if (gatewayHealth == null) return const <Widget>[];
    return <Widget>[
      if (gatewayHealth.service != null)
        StatusRow(label: l10n.gatewayService, value: gatewayHealth.service!),
      if (gatewayHealth.provider != null)
        StatusRow(
          label: l10n.gatewayProvider,
          value: l10n.diagnosticsValue(gatewayHealth.provider!),
        ),
      if (gatewayHealth.resolvedProvider != null)
        StatusRow(
          label: l10n.gatewayResolvedProvider,
          value: l10n.diagnosticsValue(gatewayHealth.resolvedProvider!),
        ),
      if (gatewayHealth.asrProvider != null)
        StatusRow(
          label: l10n.gatewayAsrProvider,
          value: l10n.diagnosticsValue(gatewayHealth.asrProvider!),
        ),
      if (gatewayHealth.asrEndpoint != null)
        StatusRow(
          label: l10n.diagnosticsLabel('gateway.asrEndpoint'),
          value: gatewayHealth.asrEndpoint!,
        ),
      if (gatewayHealth.asrHealthUrl != null)
        StatusRow(
          label: l10n.diagnosticsLabel('gateway.asrHealthUrl'),
          value: gatewayHealth.asrHealthUrl!,
        ),
      if (gatewayHealth.translationEndpoint != null)
        StatusRow(
          label: l10n.diagnosticsLabel('gateway.translationEndpoint'),
          value: gatewayHealth.translationEndpoint!,
        ),
      if (gatewayHealth.translationModel != null)
        StatusRow(
          label: l10n.diagnosticsLabel('gateway.translationModel'),
          value: gatewayHealth.translationModel!,
        ),
      if (gatewayHealth.sessionEventSink != null)
        StatusRow(
          label: l10n.gatewaySessionEventSink,
          value: l10n.diagnosticsValue(gatewayHealth.sessionEventSink!),
        ),
    ];
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
