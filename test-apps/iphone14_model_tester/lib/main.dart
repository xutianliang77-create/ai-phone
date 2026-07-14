import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'model_provider.dart';
import 'test_sample.dart';
import 'tester_widgets.dart';

const _native = MethodChannel('iphone14_model_tester/native');
const _events = EventChannel('iphone14_model_tester/events');
const _evalControlUrl = String.fromEnvironment('EVAL_CONTROL_URL');
const _remoteAsrEndpoint = String.fromEnvironment(
  'REMOTE_ASR_ENDPOINT',
  defaultValue: 'http://100.110.127.117:8021/asr/transcribe',
);
const _remoteAsrFlushEndpoint = String.fromEnvironment(
  'REMOTE_ASR_FLUSH_ENDPOINT',
  defaultValue: 'http://100.110.127.117:8021/asr/sessions/:sessionId/flush',
);
const _remoteAsrApiKey = String.fromEnvironment('REMOTE_ASR_API_KEY');
const _remoteAsrChunkMs = int.fromEnvironment(
  'REMOTE_ASR_CHUNK_MS',
  defaultValue: 320,
);
const _remoteAsrUploadMode = String.fromEnvironment(
  'REMOTE_ASR_UPLOAD_MODE',
  defaultValue: 'whole_clip',
);
const _coreMlNemotronModelChunkMs = int.fromEnvironment(
  'COREML_NEMOTRON_MODEL_CHUNK_MS',
  defaultValue: 2240,
);

void main() {
  runApp(const ModelTesterApp());
}

class ModelTesterApp extends StatelessWidget {
  const ModelTesterApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'iPhone14 Model Test',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff006b5f)),
        useMaterial3: true,
      ),
      home: const TestHomePage(),
    );
  }
}

class TestHomePage extends StatefulWidget {
  const TestHomePage({super.key});

  @override
  State<TestHomePage> createState() => _TestHomePageState();
}

class _TestHomePageState extends State<TestHomePage> {
  final _eventsLog = <Map<String, Object?>>[];
  final _transcripts = <String>[];
  final _finalSegments = <String, String>{};
  final _partialSegments = <String, String>{};
  final _scrollController = ScrollController();
  StreamSubscription<dynamic>? _subscription;
  final List<ModelProviderSpec> _providers = ModelProviderCatalog.all;
  List<TestSample> _samples = const [];
  TestSample? _selected;
  ModelProviderSpec _selectedProvider = ModelProviderCatalog.appleSpeech;
  String _status = '未开始';
  String _localeId = 'zh-CN';
  String _permission = '未请求';
  String _runId = 'manual-${DateTime.now().millisecondsSinceEpoch}';
  String _lastSavedPath = '未保存';
  String _mode = 'apple_speech_baseline';
  Map<String, Object?> _nativeStatus = const {};
  bool _recording = false;

  @override
  void initState() {
    super.initState();
    _loadSamples();
    _refreshNativeStatus();
    _subscription = _events.receiveBroadcastStream().listen(_onNativeEvent);
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadSamples() async {
    final text = await rootBundle.loadString(
      'assets/iphone14-test-set-v1.jsonl',
    );
    final samples = text
        .split('\n')
        .where((line) => line.trim().isNotEmpty)
        .map(
          (line) =>
              TestSample.fromJson(jsonDecode(line) as Map<String, dynamic>),
        )
        .toList();
    setState(() {
      _samples = samples;
      _selected = samples.firstWhere((sample) => sample.priority == 'P0');
      _localeId = _localeForSample(_selected);
    });
  }

  Future<void> _refreshNativeStatus() async {
    final status = await _native.invokeMapMethod<String, Object?>('status');
    if (!mounted) return;
    setState(() {
      _nativeStatus = status ?? const {};
    });
  }

  Future<void> _requestPermissions() async {
    final response = await _native.invokeMapMethod<String, Object?>(
      'requestPermissions',
    );
    setState(() {
      _permission = jsonEncode(response);
      _status = '权限结果已返回';
    });
  }

  Future<void> _start() async {
    if (!_selectedProvider.available) {
      setState(() {
        _status = '${_selectedProvider.name} 待接入';
      });
      return;
    }
    await _syncNextSampleFromControl();
    _runId = _buildRunId();
    _mode = _selectedProvider.resultMode;
    _eventsLog.clear();
    _transcripts.clear();
    _finalSegments.clear();
    _partialSegments.clear();
    final sourceLanguage = _sourceLanguageForCurrentSelection();
    final targetLanguage = _targetLanguageForCurrentSelection();
    _eventsLog.add({
      'type': 'button.start',
      'localeId': _localeId,
      'language': _localeId,
      'sourceLanguage': sourceLanguage,
      'targetLanguage': targetLanguage,
      'providerId': _selectedProvider.id,
      'modelId': _selectedProvider.modelId,
      'uploadMode': _selectedProvider.id == 'remote_asr'
          ? _remoteAsrUploadMode
          : null,
      'timestampMs': DateTime.now().millisecondsSinceEpoch,
    });
    try {
      final response = await _native
          .invokeMapMethod<String, Object?>('startSpeech', <String, Object?>{
            'sessionId': _runId,
            'localeId': _localeId,
            'language': _localeId,
            'sourceLanguage': sourceLanguage,
            'targetLanguage': targetLanguage,
            'providerId': _selectedProvider.id,
            'modelId': _selectedProvider.modelId,
            'remoteAsrEndpoint': _remoteAsrEndpoint,
            'remoteAsrFlushEndpoint': _remoteAsrFlushEndpoint,
            'remoteAsrApiKey': _remoteAsrApiKey,
            'remoteAsrUploadMode': _remoteAsrUploadMode,
            'chunkDurationMs': _remoteAsrChunkMs,
            'modelChunkMs': _selectedProvider.id == 'coreml_nemotron'
                ? _coreMlNemotronModelChunkMs
                : null,
          });
      final started = response?['started'] == true;
      setState(() {
        _recording = started;
        _status = started
            ? '识别中 $_localeId'
            : '未启动：${response?['reason'] ?? 'provider_not_ready'}';
      });
    } on PlatformException catch (error) {
      _eventsLog.add({
        'type': 'start.error',
        'code': error.code,
        'message': error.message,
        'providerId': _selectedProvider.id,
        'modelId': _selectedProvider.modelId,
        'timestampMs': DateTime.now().millisecondsSinceEpoch,
      });
      setState(() {
        _recording = false;
        _status = '启动失败：${error.message ?? error.code}';
      });
    }
    await _refreshNativeStatus();
    await _persistJsonl();
    unawaited(_notifyControl('start'));
  }

  Future<void> _stop() async {
    await _native.invokeMapMethod<String, Object?>('stopSpeech');
    _eventsLog.add({
      'type': 'button.stop',
      'localeId': _localeId,
      'providerId': _selectedProvider.id,
      'modelId': _selectedProvider.modelId,
      'timestampMs': DateTime.now().millisecondsSinceEpoch,
    });
    await _persistJsonl();
    setState(() {
      _recording = false;
      _status = '已停止';
    });
    await _refreshNativeStatus();
    unawaited(_notifyControl('stop'));
  }

  Future<void> _speakExpected() async {
    await _syncNextSampleFromControl();
    final sample = _selected;
    if (sample == null) return;
    final language = sample.targetLanguage == 'zh' ? 'zh-CN' : 'en-US';
    _runId = 'tts-${_buildRunId()}';
    _mode = 'apple_tts_baseline';
    _eventsLog.clear();
    _transcripts.clear();
    _finalSegments.clear();
    _partialSegments.clear();
    _eventsLog.add({
      'type': 'button.tts',
      'language': language,
      'timestampMs': DateTime.now().millisecondsSinceEpoch,
    });
    setState(() => _status = 'TTS 请求中 $language');
    await _persistJsonl();
    await _native.invokeMapMethod<String, Object?>('speak', <String, Object?>{
      'text': sample.expectedTranslation,
      'language': language,
    });
    if (!mounted) return;
    setState(() => _status = 'TTS 播放中 $language');
  }

  Future<void> _copyJsonl() async {
    final rows = _buildJsonlRows();
    await _persistJsonl(rows: rows);
    await Clipboard.setData(ClipboardData(text: rows));
    setState(() => _status = 'JSONL 已复制');
  }

  String _buildJsonlRows() {
    return _eventsLog
        .map((event) {
          return jsonEncode({
            'runId': _runId,
            'createdAt': DateTime.now().toUtc().toIso8601String(),
            'sampleId': _selected?.id,
            'sampleGroup': _selected?.group,
            'sampleLanguage': _selected?.language,
            'targetLanguage': _selected?.targetLanguage,
            'device': 'iPhone',
            'mode': _mode,
            'providerId': _selectedProvider.id,
            'providerName': _selectedProvider.name,
            'providerKind': _selectedProvider.kind,
            'modelId': _selectedProvider.modelId,
            'localeId': _localeId,
            'expectedText': _selected?.text,
            'expectedTranslation': _selected?.expectedTranslation,
            'event': event,
          });
        })
        .join('\n');
  }

  Future<void> _persistJsonl({String? rows}) async {
    final response = await _native.invokeMapMethod<String, Object?>(
      'saveResultJsonl',
      <String, Object?>{'runId': _runId, 'jsonl': rows ?? _buildJsonlRows()},
    );
    if (!mounted) return;
    setState(() {
      _lastSavedPath = response?['latestPath']?.toString() ?? _lastSavedPath;
    });
  }

  Future<void> _notifyControl(String action) async {
    if (_evalControlUrl.isEmpty) return;
    final sample = _selected;
    final uri = Uri.parse('$_evalControlUrl/$action');
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    try {
      final request = await client.postUrl(uri);
      request.headers.contentType = ContentType.json;
      request.write(
        jsonEncode({
          'action': action,
          'runId': _runId,
          'sampleId': sample?.id,
          'sampleGroup': sample?.group,
          'sampleLanguage': sample?.language,
          'targetLanguage': sample?.targetLanguage,
          'localeId': _localeId,
          'providerId': _selectedProvider.id,
          'modelId': _selectedProvider.modelId,
          'expectedText': sample?.text,
          'eventCount': _eventsLog.length,
        }),
      );
      final response = await request.close();
      await response.drain<void>();
      if (!mounted) return;
      if (response.statusCode >= 400) {
        setState(() => _status = '控制服务错误 ${response.statusCode}');
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _status = '控制服务未连接');
    } finally {
      client.close(force: true);
    }
  }

  Future<void> _syncNextSampleFromControl() async {
    if (_samples.isEmpty) return;
    if (_evalControlUrl.isNotEmpty && await _syncNextSampleFromHttp()) return;
    if (await _syncNextSampleFromDeviceFile()) return;
    if (!mounted) return;
    setState(() => _status = '控制服务未连接');
  }

  Future<bool> _syncNextSampleFromHttp() async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    try {
      final request = await client.getUrl(Uri.parse('$_evalControlUrl/next'));
      final response = await request.close();
      final body = await utf8.decodeStream(response);
      if (response.statusCode >= 400) return false;
      final payload = jsonDecode(body) as Map<String, dynamic>;
      return _applyControlPayload(payload, 'HTTP');
    } catch (_) {
      return false;
    } finally {
      client.close(force: true);
    }
  }

  Future<bool> _syncNextSampleFromDeviceFile() async {
    try {
      final response = await _native.invokeMapMethod<String, Object?>(
        'loadControlJson',
      );
      if (response?['exists'] != true) return false;
      final json = response?['json']?.toString();
      if (json == null || json.trim().isEmpty) return false;
      final payload = jsonDecode(json) as Map<String, dynamic>;
      return _applyControlPayload(payload, 'USB');
    } catch (_) {
      return false;
    }
  }

  bool _applyControlPayload(Map<String, dynamic> payload, String source) {
    final sampleId = payload['sampleId']?.toString();
    final sample = _sampleById(sampleId);
    if (sample == null || !mounted) return false;
    setState(() {
      _selected = sample;
      _localeId = sample.language == 'mixed'
          ? _localeForSample(sample)
          : payload['localeId']?.toString() ?? _localeForSample(sample);
      _selectedProvider = ModelProviderCatalog.byId(
        payload['providerId']?.toString(),
      );
      _status = '已同步 $source ${sample.id}';
    });
    return true;
  }

  TestSample? _sampleById(String? sampleId) {
    for (final sample in _samples) {
      if (sample.id == sampleId) return sample;
    }
    return null;
  }

  void _selectSample(TestSample sample) {
    setState(() {
      _selected = sample;
      _localeId = _localeForSample(sample);
      _status = '已选择 ${sample.id}';
    });
  }

  void _selectProvider(ModelProviderSpec provider) {
    setState(() {
      _selectedProvider = provider;
      _status = provider.available
          ? '已选择 ${provider.name}'
          : '${provider.name} 待接入';
    });
    unawaited(_refreshNativeStatus());
  }

  String _buildRunId() {
    final sampleId = _selected?.id ?? 'unknown';
    final locale = _localeId.replaceAll('-', '_');
    return '$sampleId-${_selectedProvider.id}-$locale-${DateTime.now().millisecondsSinceEpoch}';
  }

  String _localeForSample(TestSample? sample) {
    if (sample?.language == 'mixed') return 'auto';
    if (sample?.language == 'en') return 'en-US';
    return 'zh-CN';
  }

  String _sourceLanguageForCurrentSelection() {
    if (_selected?.language == 'mixed') return 'auto';
    return _sourceLanguageForLocale(_localeId);
  }

  String _targetLanguageForCurrentSelection() {
    if (_selected?.language == 'mixed') return 'auto';
    return _targetLanguageForLocale(_localeId);
  }

  String _sourceLanguageForLocale(String localeId) {
    if (localeId.toLowerCase().startsWith('en')) return 'en';
    if (localeId.toLowerCase().startsWith('zh')) return 'zh';
    return 'auto';
  }

  String _targetLanguageForLocale(String localeId) {
    if (localeId.toLowerCase().startsWith('en')) return 'zh';
    if (localeId.toLowerCase().startsWith('zh')) return 'en';
    return 'auto';
  }

  void _onNativeEvent(dynamic event) {
    final map = Map<String, Object?>.from(event as Map);
    _eventsLog.add(map);
    final text = map['text']?.toString().trim();
    if (text != null && text.isNotEmpty) {
      final segmentId = map['segmentId']?.toString();
      final isFinal = map['isFinal'] == true;
      if (segmentId != null && segmentId.isNotEmpty) {
        if (isFinal) {
          _finalSegments[segmentId] = text;
          _partialSegments.remove(segmentId);
        } else {
          _partialSegments[segmentId] = text;
        }
      } else if (_transcripts.isEmpty || _transcripts.last != text) {
        _transcripts.add(text);
      } else {
        _transcripts[_transcripts.length - 1] = text;
      }
    }
    setState(() {
      _recording =
          map['type'] == 'started' || (_recording && map['type'] != 'stopped');
      _status = map['type']?.toString() ?? _status;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
      }
    });
    unawaited(_persistJsonl());
  }

  @override
  Widget build(BuildContext context) {
    final latestText = _combinedTranscript;
    return Scaffold(
      appBar: AppBar(title: const Text('iPhone14 端侧模型测试')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            StatusPanel(
              status: _status,
              permission: _permission,
              localeId: _localeId,
              recording: _recording,
              eventCount: _eventsLog.length,
              lastSavedPath: _lastSavedPath,
              runId: _runId,
              provider: _selectedProvider,
              nativeStatus: _nativeStatus,
            ),
            const SizedBox(height: 12),
            ProviderPicker(
              providers: _providers,
              selected: _selectedProvider,
              onSelected: _selectProvider,
            ),
            const SizedBox(height: 12),
            LocalePicker(
              value: _localeId,
              onChanged: (value) => setState(() => _localeId = value),
            ),
            const SizedBox(height: 12),
            SamplePicker(
              samples: _samples
                  .where((sample) => sample.priority == 'P0')
                  .toList(),
              selected: _selected,
              onSelected: _selectSample,
            ),
            const SizedBox(height: 12),
            ActionBar(
              recording: _recording,
              onPermission: _requestPermissions,
              onStart: _start,
              onStop: _stop,
              onSpeak: _speakExpected,
              onCopy: _copyJsonl,
            ),
            const SizedBox(height: 16),
            Text('当前样本', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(_selected?.text ?? '加载中'),
            const SizedBox(height: 8),
            Text(
              _selected?.expectedTranslation ?? '',
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: Colors.black54),
            ),
            const SizedBox(height: 16),
            Text('实时字幕', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xffedf7f4),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xffa9cbc3)),
              ),
              child: Text(
                latestText,
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            const SizedBox(height: 16),
            Text('事件日志', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            SizedBox(
              height: 260,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.black12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(8),
                  itemCount: _eventsLog.length,
                  itemBuilder: (context, index) {
                    return Text(
                      jsonEncode(_eventsLog[index]),
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12,
                      ),
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String get _combinedTranscript {
    final parts = [
      ..._finalSegments.values,
      ..._partialSegments.values,
    ].where((text) => text.trim().isNotEmpty).toList();
    if (parts.isNotEmpty) return parts.join('\n');
    if (_transcripts.isEmpty) return '暂无字幕';
    return _transcripts.last;
  }
}
