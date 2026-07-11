import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../../platform/asr/asr_text_segment.dart';
import '../../../../platform/asr/core_ml_nemotron_asr_provider.dart';
import '../../../../platform/asr/mobile_asr_provider.dart';
import '../../../../platform/sharing/file_share_service.dart';
import '../../../../platform/sharing/local_file_share_service.dart';
import '../../../../platform/translation/mobile_translation_provider.dart';
import '../../../realtime/data/api/api_health_client.dart';
import '../../data/core_ml_nemotron_diagnostics_report.dart';
import '../widgets/api_health_panel.dart';
import '../widgets/core_ml_nemotron_diagnostics_widgets.dart';
import '../widgets/core_ml_nemotron_translation_rows.dart';
import 'core_ml_nemotron_diagnostics_helpers.dart';

part 'core_ml_nemotron_diagnostics_page_services.dart';

class CoreMlNemotronDiagnosticsPage extends StatefulWidget {
  const CoreMlNemotronDiagnosticsPage({
    this.provider,
    this.config,
    this.shareService,
    this.apiHealthFetcher,
    this.gatewayHealthFetcher,
    this.translationProvider,
    this.selfTestDuration = const Duration(seconds: 10),
    super.key,
  });

  final MobileAsrProvider? provider;
  final AppConfig? config;
  final FileShareService? shareService;
  final ApiHealthFetcher? apiHealthFetcher;
  final GatewayHealthFetcher? gatewayHealthFetcher;
  final MobileTranslationProvider? translationProvider;
  final Duration selfTestDuration;

  @override
  State<CoreMlNemotronDiagnosticsPage> createState() =>
      _CoreMlNemotronDiagnosticsPageState();
}

class _CoreMlNemotronDiagnosticsPageState
    extends State<CoreMlNemotronDiagnosticsPage> {
  late final MobileAsrProvider _provider =
      widget.provider ?? CoreMlNemotronAsrProvider();
  late final AppConfig _config = widget.config ?? AppConfig.fromEnvironment();
  late final FileShareService _shareService =
      widget.shareService ?? LocalFileShareService();
  late final ApiHealthFetcher _apiHealthFetcher =
      widget.apiHealthFetcher ?? fetchApiHealth;
  late final GatewayHealthFetcher _gatewayHealthFetcher =
      widget.gatewayHealthFetcher ?? fetchGatewayHealth;
  late final MobileTranslationProvider? _translationProvider =
      widget.translationProvider ?? diagnosticsTranslationProvider(_config);
  MobileAsrAvailability? _availability;
  MobileTranslationAvailability? _translationAvailability;
  ApiHealthInfo? _apiHealth;
  GatewayHealthInfo? _gatewayHealth;
  Map<String, Object?> _modelDetails = const <String, Object?>{};
  final List<AsrTextSegment> _selfTestSegments = <AsrTextSegment>[];
  StreamSubscription<AsrTextSegment>? _selfTestSubscription;
  Timer? _selfTestTimer;
  Timer? _selfTestStatsTimer;
  String? _error;
  String? _apiHealthError;
  String? _gatewayHealthError;
  String? _selfTestMessage;
  bool _busy = false;
  bool _selfTestRunning = false;
  late bool _allowDownload = _config.deviceAsrAutoDownloadModel;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  @override
  void dispose() {
    _selfTestTimer?.cancel();
    _selfTestStatsTimer?.cancel();
    unawaited(_selfTestSubscription?.cancel());
    if (widget.provider == null) {
      unawaited(_provider.dispose());
    } else {
      unawaited(_provider.stop());
    }
    if (widget.translationProvider == null) {
      unawaited(_translationProvider?.dispose());
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.deviceAsrDiagnostics)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: <Widget>[
          if (_busy) const LinearProgressIndicator(),
          ActionBar(
            onRefresh: _busy ? null : _refresh,
            onInspect: _busy ? null : _inspectModel,
            onPrepare: _busy ? null : _prepareModel,
            onCheckService:
                _busy ? null : () => _checkDiagnosticsServices(this),
            onSelfTest: _busy ? null : _toggleSelfTest,
            onExport: _busy ? null : _shareDiagnosticsReport,
            selfTestRunning: _selfTestRunning,
          ),
          SwitchListTile(
            value: _allowDownload,
            contentPadding: EdgeInsets.zero,
            title: Text(l10n.allowModelDownload),
            onChanged: _busy
                ? null
                : (value) => setState(() => _allowDownload = value),
          ),
          const Divider(),
          SectionTitle(l10n.serviceConnection),
          ApiHealthPanel(
            apiBaseUrl: _config.apiBaseUrl,
            health: _apiHealth,
            gatewayHealth: _gatewayHealth,
            error: _apiHealthError,
            gatewayError: _gatewayHealthError,
          ),
          const Divider(),
          SectionTitle(l10n.availability),
          _availability == null
              ? ListTile(title: Text(l10n.unknown))
              : AvailabilityRows(availability: _availability!),
          const Divider(),
          SectionTitle(l10n.onDeviceTranslation),
          TranslationAvailabilityRows(availability: _translationAvailability),
          if (_error != null) ...[
            const Divider(),
            SectionTitle(l10n.lastError),
            SelectableText(l10n.runtimeMessage(_error!)),
          ],
          if (_modelDetails.isNotEmpty) ...[
            const Divider(),
            SectionTitle(l10n.nativeDetails),
            DetailsList(details: _modelDetails),
          ],
          const Divider(),
          SelfTestPanel(
            running: _selfTestRunning,
            segments: _selfTestSegments,
            message: _selfTestMessage,
            runtimeDetails: _modelDetails,
          ),
        ],
      ),
    );
  }

  Future<void> _refresh() async {
    await _run(() async {
      final diagnostics = _provider as MobileAsrDiagnostics;
      _availability = await diagnostics.availability(_deviceConfig);
      _modelDetails = _availability?.details ?? const <String, Object?>{};
      await _refreshTranslationAvailability(this);
    });
  }

  Future<void> _inspectModel() async {
    await _run(() async {
      final inspector = _provider as MobileAsrModelInspector;
      _modelDetails = await inspector.inspectModel();
    });
  }

  Future<void> _prepareModel() async {
    await _run(() async {
      final preparation = _provider as MobileAsrPreparation;
      final diagnostics = _provider as MobileAsrDiagnostics;
      await preparation.prepare(_deviceConfig);
      _availability = await diagnostics.availability(_deviceConfig);
      _modelDetails = _availability?.details ?? const <String, Object?>{};
    });
  }

  Future<void> _toggleSelfTest() async {
    if (_selfTestRunning) {
      await _stopSelfTest(message: 'Device ASR self-test stopped');
      return;
    }
    await _startSelfTest();
  }

  Future<void> _shareDiagnosticsReport() async {
    final currentError = _error;
    await _run(() async {
      final report = CoreMlNemotronDiagnosticsReport(
        capturedAt: DateTime.now(),
        config: _config,
        allowDownload: _allowDownload,
        apiHealth: _apiHealth,
        gatewayHealth: _gatewayHealth,
        apiHealthError: _apiHealthError,
        gatewayHealthError: _gatewayHealthError,
        availability: _availability,
        translationAvailability: _translationAvailability,
        modelDetails: _modelDetails,
        selfTestSegments: List<AsrTextSegment>.unmodifiable(_selfTestSegments),
        selfTestRunning: _selfTestRunning,
        selfTestMessage: _selfTestMessage,
        error: currentError,
      );
      final path = await _shareService.saveExportFile(
        report.toUtf8Bytes(),
        report.filename,
      );
      await _shareService.shareFile(path, mimeType: 'application/json');
      _selfTestMessage = 'Diagnostics report ready';
    });
  }

  Future<void> _startSelfTest() async {
    setState(() {
      _busy = true;
      _error = null;
      _selfTestMessage = 'Starting device ASR self-test';
      _selfTestSegments.clear();
    });
    try {
      await _selfTestSubscription?.cancel();
      _selfTestSubscription = _provider.segments.listen(
        _handleSelfTestSegment,
        onError: (Object error) {
          if (!mounted) return;
          setState(() => _error = diagnosticsDisplayMessage(error));
          unawaited(_stopSelfTest(message: 'Device ASR self-test stopped'));
        },
      );
      await _provider.requestPermission();
      final preparation = _provider as MobileAsrPreparation;
      await preparation.prepare(_deviceConfig);
      await _provider.start(_deviceConfig);
      await _refreshSelfTestRuntimeDetails();
      _selfTestStatsTimer = Timer.periodic(const Duration(seconds: 1), (_) {
        unawaited(_refreshSelfTestRuntimeDetails());
      });
      _selfTestTimer = Timer(widget.selfTestDuration, () {
        unawaited(_stopSelfTest(message: 'Device ASR self-test finished'));
      });
      if (!mounted) return;
      setState(() {
        _busy = false;
        _selfTestRunning = true;
        _selfTestMessage = 'Listening for ASR segments';
      });
    } catch (error) {
      _selfTestStatsTimer?.cancel();
      try {
        await _provider.stop();
        await _refreshSelfTestRuntimeDetails();
      } catch (_) {}
      unawaited(_selfTestSubscription?.cancel() ?? Future<void>.value());
      _selfTestSubscription = null;
      if (!mounted) return;
      setState(() {
        _busy = false;
        _selfTestRunning = false;
        _error = diagnosticsDisplayMessage(error);
      });
    }
  }

  Future<void> _stopSelfTest({required String message}) async {
    _selfTestTimer?.cancel();
    _selfTestStatsTimer?.cancel();
    setState(() => _busy = true);
    try {
      await _provider.stop();
      await _refreshSelfTestRuntimeDetails();
    } catch (error) {
      _error = diagnosticsDisplayMessage(error);
    } finally {
      await _selfTestSubscription?.cancel();
      _selfTestSubscription = null;
      if (mounted) {
        setState(() {
          _busy = false;
          _selfTestRunning = false;
          _selfTestMessage = message;
        });
      }
    }
  }

  void _handleSelfTestSegment(AsrTextSegment segment) {
    if (!mounted) return;
    final existingIndex = _selfTestSegments.indexWhere(
      (candidate) => candidate.id == segment.id,
    );
    setState(() {
      if (existingIndex >= 0) {
        _selfTestSegments[existingIndex] = segment;
      } else {
        _selfTestSegments.add(segment);
      }
    });
    unawaited(_refreshSelfTestRuntimeDetails());
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      _error = diagnosticsDisplayMessage(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _applyState(VoidCallback update) {
    if (mounted) setState(update);
  }

  MobileAsrConfig get _deviceConfig =>
      diagnosticsDeviceConfig(_config, _allowDownload);

  Future<void> _refreshSelfTestRuntimeDetails() async {
    if (_provider is! MobileAsrRuntimeInspector) return;
    final inspector = _provider as MobileAsrRuntimeInspector;
    try {
      final details = await inspector.nativeAvailability();
      if (mounted) setState(() => _modelDetails = details);
    } catch (_) {}
  }
}
