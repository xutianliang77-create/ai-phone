import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../history/data/session_history_repository.dart';
import '../../../realtime/data/realtime_settings_store.dart';
import '../../../realtime/presentation/controllers/realtime_runtime_factories.dart';
import '../../../../platform/speech/speech_output_provider.dart';
import '../../../../platform/translation/mobile_translation_provider.dart';
import '../../../../platform/translation/supported_translation_language.dart';
import '../controllers/type_to_speak_controller.dart';

class TypeToSpeakPage extends StatefulWidget {
  const TypeToSpeakPage({
    this.translationProvider,
    this.speechOutputProvider,
    this.historyRepository,
    this.config,
    this.settingsStore,
    super.key,
  });

  final MobileTranslationProvider? translationProvider;
  final SpeechOutputProvider? speechOutputProvider;
  final SessionHistoryRepository? historyRepository;
  final AppConfig? config;
  final RealtimeSettingsStore? settingsStore;

  @override
  State<TypeToSpeakPage> createState() => _TypeToSpeakPageState();
}

class _TypeToSpeakPageState extends State<TypeToSpeakPage> {
  final _textController = TextEditingController();
  late final AppConfig _baseConfig =
      widget.config ?? AppConfig.fromEnvironment();
  late final RealtimeSettingsStore _settingsStore =
      widget.settingsStore ?? const FileRealtimeSettingsStore();
  late final SessionHistoryRepository _historyRepository;
  late final TypeToSpeakController _controller;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    if (widget.translationProvider != null &&
        widget.speechOutputProvider != null &&
        widget.historyRepository != null) {
      _initializeWithConfig(_baseConfig);
    } else {
      _initialize();
    }
  }

  Future<void> _initialize() async {
    final config =
        await resolveRealtimeSettingsConfig(_baseConfig, _settingsStore);
    _initializeWithConfig(config);
  }

  void _initializeWithConfig(AppConfig config) {
    final historyRepository =
        widget.historyRepository ?? SessionHistoryRepository.fromConfig(config);
    final controller = TypeToSpeakController(
      translationProvider:
          widget.translationProvider ?? _defaultTranslator(config),
      speechOutputProvider:
          widget.speechOutputProvider ?? SystemSpeechOutputProvider(),
      historyRepository: historyRepository,
      initialSourceLanguage: config.sourceLanguage,
      initialTargetLanguage: config.targetLanguage,
      autoReverseTargetLanguage: config.autoReverseTargetLanguage,
    );
    if (!mounted) {
      controller.dispose();
      if (widget.historyRepository == null) historyRepository.dispose();
      return;
    }
    _historyRepository = historyRepository;
    _controller = controller;
    setState(() => _ready = true);
  }

  @override
  void dispose() {
    _textController.dispose();
    if (_ready) _controller.dispose();
    if (_ready && widget.historyRepository == null) {
      _historyRepository.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    if (!_ready) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.typeToSpeak)),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(l10n.typeToSpeak)),
      body: SafeArea(
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: <Widget>[
                TextField(
                  controller: _textController,
                  minLines: 3,
                  maxLines: 6,
                  textInputAction: TextInputAction.newline,
                  decoration: InputDecoration(
                    labelText: l10n.typeToSpeakInput,
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: <Widget>[
                    FilledButton.icon(
                      onPressed: _isTranslating
                          ? null
                          : () => _controller.translate(_textController.text),
                      icon: const Icon(Icons.translate),
                      label: Text(l10n.translate),
                    ),
                    OutlinedButton.icon(
                      onPressed: _canSpeak ? _controller.speak : null,
                      icon: const Icon(Icons.volume_up_outlined),
                      label: Text(l10n.speakTranslation),
                    ),
                    OutlinedButton.icon(
                      onPressed: _canSave ? _controller.save : null,
                      icon: const Icon(Icons.save_outlined),
                      label: Text(l10n.saveToHistory),
                    ),
                    OutlinedButton.icon(
                      onPressed:
                          _controller.status == TypeToSpeakStatus.speaking
                              ? _controller.stopSpeaking
                              : null,
                      icon: const Icon(Icons.stop_circle_outlined),
                      label: Text(l10n.stopSpeaking),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                _DirectionLine(controller: _controller),
                const SizedBox(height: 16),
                Text(
                  l10n.translatedText,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                SelectableText(
                  _controller.translatedText.isEmpty
                      ? l10n.typeToSpeakNoTranslation
                      : _controller.translatedText,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                if (_controller.message != null) ...<Widget>[
                  const SizedBox(height: 12),
                  Text(
                    l10n.typeToSpeakStatusMessage(_controller.message!),
                    style: TextStyle(color: _messageColor(context)),
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  bool get _isTranslating {
    return _controller.status == TypeToSpeakStatus.translating;
  }

  bool get _canSave {
    return _controller.translatedText.trim().isNotEmpty &&
        _controller.savedSessionId == null &&
        _controller.status != TypeToSpeakStatus.translating &&
        _controller.status != TypeToSpeakStatus.saving;
  }

  bool get _canSpeak {
    return _controller.translatedText.trim().isNotEmpty &&
        _controller.status != TypeToSpeakStatus.translating;
  }

  Color _messageColor(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    if (_controller.status == TypeToSpeakStatus.saved) {
      return colorScheme.primary;
    }
    return colorScheme.error;
  }

  MobileTranslationProvider _defaultTranslator(AppConfig config) {
    return createDefaultAuxiliaryMobileTranslationProvider(config);
  }
}

class _DirectionLine extends StatelessWidget {
  const _DirectionLine({required this.controller});

  final TypeToSpeakController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final source = controller.sourceLanguage == 'auto'
        ? l10n.unknown
        : translationLanguageName(
            controller.sourceLanguage,
            chinese: l10n.isChinese,
          );
    final target = translationLanguageName(
      controller.targetLanguage,
      chinese: l10n.isChinese,
    );
    return Text('${l10n.translationDirection}: $source -> $target');
  }
}
