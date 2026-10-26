import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../data/realtime_runtime_settings.dart';
import '../../data/realtime_settings_store.dart';
import '../../data/voice_preset_catalog.dart';
import '../widgets/realtime_settings_panel.dart';

class RealtimePreferencesPage extends StatefulWidget {
  const RealtimePreferencesPage({
    this.title = '同传设置',
    this.settingsStore,
    this.voicePresetClient,
    this.config,
    super.key,
  });

  final String title;
  final RealtimeSettingsStore? settingsStore;
  final VoicePresetClient? voicePresetClient;
  final AppConfig? config;

  @override
  State<RealtimePreferencesPage> createState() =>
      _RealtimePreferencesPageState();
}

class _RealtimePreferencesPageState extends State<RealtimePreferencesPage> {
  late final AppConfig _config = widget.config ?? AppConfig.fromEnvironment();
  late final RealtimeSettingsStore _store =
      widget.settingsStore ?? const FileRealtimeSettingsStore();
  late final VoicePresetClient _voiceClient = widget.voicePresetClient ??
      VoicePresetClient(baseUrl: _config.apiBaseUrl);
  late final bool _ownsVoiceClient = widget.voicePresetClient == null;
  RealtimeRuntimeSettings? _settings;
  List<VoicePreset> _presets = const <VoicePreset>[];
  bool _loadingPresets = true;
  Object? _error;
  String? _scopeMessage;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    if (_ownsVoiceClient) _voiceClient.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: SafeArea(
        child: _settings == null
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.fromLTRB(8, 12, 8, 24),
                children: <Widget>[
                  RealtimeSettingsPanel(
                    settings: _settings!,
                    onlineCoreOnly: _config.isFormalRelease && !_config.onDeviceOnly,
                    enabled: true,
                    onChanged: _save,
                    voicePresets: _presets,
                    voicePresetsLoading: _loadingPresets,
                  ),
                  if (_error != null || _scopeMessage != null)
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                        _scopeMessage ?? '部分在线音色暂不可用，其他设置仍可保存。',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                ],
              ),
      ),
    );
  }

  Future<void> _load() async {
    final config = _config;
    final saved = await _store.load();
    if (!mounted) return;
    final unsupported = saved != null && !saved.isSupportedIn(config);
    setState(() {
      _settings = unsupported
          ? RealtimeRuntimeSettings.fromConfig(config)
          : saved ?? RealtimeRuntimeSettings.fromConfig(config);
      if (unsupported) _scopeMessage = '原设置已保留，请选择此版本支持的中英模式和系统声音。';
    });
    try {
      final catalog = await _voiceClient.load();
      if (!mounted) return;
      setState(() {
        _presets = catalog.presets;
        _loadingPresets = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loadingPresets = false;
      });
    }
  }

  Future<void> _save(RealtimeRuntimeSettings settings) async {
    if (!settings.isSupportedIn(_config)) {
      setState(() => _scopeMessage = '此模式暂不受支持，原设置未修改。');
      return;
    }
    setState(() {
      _settings = settings;
      _scopeMessage = null;
    });
    try {
      await _store.save(settings);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    }
  }
}
