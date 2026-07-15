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
    super.key,
  });

  final String title;
  final RealtimeSettingsStore? settingsStore;
  final VoicePresetClient? voicePresetClient;

  @override
  State<RealtimePreferencesPage> createState() =>
      _RealtimePreferencesPageState();
}

class _RealtimePreferencesPageState extends State<RealtimePreferencesPage> {
  late final RealtimeSettingsStore _store =
      widget.settingsStore ?? const FileRealtimeSettingsStore();
  late final VoicePresetClient _voiceClient = widget.voicePresetClient ??
      VoicePresetClient(baseUrl: AppConfig.fromEnvironment().apiBaseUrl);
  late final bool _ownsVoiceClient = widget.voicePresetClient == null;
  RealtimeRuntimeSettings? _settings;
  List<VoicePreset> _presets = const <VoicePreset>[];
  bool _loadingPresets = true;
  Object? _error;

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
                    enabled: true,
                    onChanged: _save,
                    voicePresets: _presets,
                    voicePresetsLoading: _loadingPresets,
                  ),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                        '部分在线音色暂不可用，其他设置仍可保存。',
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
    final config = AppConfig.fromEnvironment();
    final saved = await _store.load();
    if (!mounted) return;
    setState(
        () => _settings = saved ?? RealtimeRuntimeSettings.fromConfig(config));
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
    setState(() => _settings = settings);
    try {
      await _store.save(settings);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    }
  }
}
