import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/call_link/data/agent_delivery_room_event.dart';
import 'package:translation_mobile/src/features/call_link/data/call_link_api_client.dart';
import 'package:translation_mobile/src/features/call_link/data/call_room_client.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';

class ScreenshotApp extends StatelessWidget {
  const ScreenshotApp({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: child,
    );
  }
}

class MainScreenshotPage extends StatelessWidget {
  const MainScreenshotPage({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('实时同传'),
        actions: const <Widget>[
          Icon(Icons.language),
          SizedBox(width: 16),
          Icon(Icons.health_and_safety_outlined),
          SizedBox(width: 16),
          Icon(Icons.history),
          SizedBox(width: 12),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              color: const Color(0xFFE5F1EF),
              child: const Text('状态：待开始'),
            ),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              showSelectedIcon: false,
              segments: const <ButtonSegment<String>>[
                ButtonSegment<String>(value: 'talk', label: Text('对话')),
                ButtonSegment<String>(value: 'listen', label: Text('聆听')),
              ],
              selected: const <String>{'talk'},
            ),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              showSelectedIcon: false,
              segments: const <ButtonSegment<String>>[
                ButtonSegment<String>(value: 'zh', label: Text('英译中')),
                ButtonSegment<String>(value: 'en', label: Text('中译英')),
              ],
              selected: const <String>{'zh'},
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(24),
                children: <Widget>[
                  Text(
                    '今天我们测试中英实时同声传译',
                    style: theme.textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Today we are testing Chinese-English realtime interpretation.',
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 28),
                  Text('自动识别语言，实时生成双语字幕', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 8),
                  const Text('历史记录、导出、术语和摘要可在会后继续处理。'),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: FilledButton(
                      onPressed: () {},
                      child: const Text('开始'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {},
                      child: const Text('暂停'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {},
                      child: const Text('结束'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FakeCallLinkApiClient extends CallLinkApiClient {
  FakeCallLinkApiClient() : super(baseUrl: Uri.parse('http://localhost'));

  @override
  Future<CallLink> createCallLink() async {
    return CallLink(
      callId: 'call_release',
      sessionId: 'call_release',
      roomName: 'call_release',
      roomProvider: 'livekit',
      joinUrl:
          'https://call.example.cn/join/call_release?ticket=release-ticket',
      hostUrl: 'https://call.example.cn/host/call_release',
      status: 'created',
      expiresAt: DateTime.utc(2026, 7, 4, 12),
    );
  }

  @override
  Future<CallRoomToken> createRoomToken({
    required String callId,
    String participantRole = 'host',
    String? participantName,
    String? guestTicket,
  }) async {
    return CallRoomToken(
      callId: callId,
      provider: 'livekit',
      roomName: 'call_release',
      wsUrl: 'wss://livekit.example.cn',
      participantIdentity: '$callId:$participantRole:screenshot',
      participantRole: participantRole,
      token: 'release-room-token',
      expiresAt: DateTime.utc(2026, 7, 4, 13),
    );
  }

  @override
  Future<String> rotateGuestTicket({required String callId}) async {
    return 'https://call.example.cn/join/$callId?ticket=release-rotated-ticket';
  }

  @override
  void close() {}
}

class FakeCallRoomClient implements CallRoomClient {
  FakeCallRoomClient({required this.captions});

  final List<CallRoomCaption> captions;
  final StreamController<CallRoomSnapshot> _snapshots =
      StreamController<CallRoomSnapshot>.broadcast();

  @override
  Stream<CallRoomSnapshot> get snapshots => _snapshots.stream;

  @override
  Stream<AgentDeliveryRoomEvent> get deliveryEvents =>
      const Stream<AgentDeliveryRoomEvent>.empty();

  @override
  Future<void> connect(
    CallRoomToken token, {
    bool enableMicrophone = true,
    bool translationMediaOnly = false,
    bool airTakeoverUplink = false,
  }) async {
    _snapshots.add(CallRoomSnapshot(
      status: CallRoomConnectionStatus.connected,
      microphoneEnabled: true,
      remoteParticipantCount: 1,
      message: '房间翻译 Worker 已连接',
      captions: captions,
    ));
  }

  @override
  Future<void> setMicrophoneEnabled(bool enabled) async {}

  @override
  Future<bool> waitForRemoteAudioPlayoutEvidence(
    String participantIdentity, {
    required Duration timeout,
  }) async => false;

  @override
  Future<void> disconnect() async {
    _snapshots.add(const CallRoomSnapshot.disconnected());
  }

  @override
  Future<void> dispose() async {
    await _snapshots.close();
  }
}

class FakeSessionHistoryRepository extends SessionHistoryRepository {
  FakeSessionHistoryRepository()
      : super(shareService: const _FakeFileShareService());

  @override
  Future<SessionDetail> getSession(String sessionId) async {
    return SessionDetail(
      sessionId: sessionId,
      mode: 'conversation',
      status: 'ended',
      consumedSeconds: 126,
      createdAt: DateTime.utc(2026, 7, 4, 10),
      segmentCount: 3,
      reviewJson: const <String, Object?>{
        'summary': '双方确认下午三点讨论产品计划，会后整理会议纪要。',
        'highlights': <Map<String, Object?>>[
          {'label': '时间', 'text': '今天下午三点'},
          {'label': '事项', 'text': '整理会议记录并发送'},
        ],
        'terms': <Map<String, Object?>>[
          {'sourceText': '字幕', 'translatedText': 'subtitles'},
        ],
      },
      segments: const <SessionSegment>[
        SessionSegment(
          id: '1',
          sourceText: '今天下午三点我们讨论产品计划',
          translatedText: 'We will discuss the product plan at 3 PM today.',
        ),
        SessionSegment(
          id: '2',
          sourceText: '我会整理会议记录发给大家',
          translatedText:
              'I will organize the minutes and send them to everyone.',
        ),
      ],
    );
  }
}

class _FakeFileShareService implements FileShareService {
  const _FakeFileShareService();

  @override
  Future<String> saveExportFile(List<int> bytes, String filename) async {
    return filename;
  }

  @override
  Future<void> shareFile(String path, {String? mimeType}) async {}
}
