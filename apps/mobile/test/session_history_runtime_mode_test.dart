import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/history/data/session_history_api_client.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/history/presentation/pages/session_history_page.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_settings_store.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';

final base = AppConfig(
  apiBaseUrl: Uri.parse('https://public-history.test'),
  useLocalSessions: true,
  useMockAudio: true,
  useDeviceAsr: true,
  deviceAsrProvider: 'apple_speech_transcriber',
  deviceAsrLanguage: 'zh-CN',
  deviceAsrAutoDownloadModel: false,
  deviceAsrModelChunkMs: 320,
  serverOwnedHistory: false,
);
RealtimeRuntimeSettings settings(bool online) =>
    RealtimeRuntimeSettings.fromConfig(base).copyWith(
        processingMode: online
            ? RealtimeProcessingMode.online
            : RealtimeProcessingMode.onDevice);

void main() {
  testWidgets(
      'online selection reads authenticated server history even with no local end receipt',
      (tester) async {
    final dir = Directory.systemTemp.createTempSync('history-runtime-');
    addTearDown(() => dir.deleteSync(recursive: true));
    final local = LocalSessionStore(file: File('${dir.path}/local.json'));
    final requests = <String>[];
    final accounts = MemoryAccountSessionStore(const AccountSession(
        token: 'synthetic-owner', expiresAtIso: '2099-01-01T00:00:00Z'));
    SessionHistoryRepository factory(AppConfig config) =>
        SessionHistoryRepository(
            localStore: config.useLocalSessions ? local : null,
            apiClient: config.useLocalSessions
                ? null
                : SessionHistoryApiClient(
                    baseUrl: config.apiBaseUrl,
                    accountSessionStore: accounts,
                    client: MockClient((r) async {
                      requests.add('${r.method} ${r.url.path}');
                      expect(
                          r.headers['authorization'], 'Bearer synthetic-owner');
                      expect(r.url.origin, 'https://public-history.test');
                      final detail = {
                        'sessionId': 'public-ended',
                        'mode': 'conversation',
                        'status': 'ended',
                        'consumedSeconds': 58,
                        'createdAt': '2026-09-22T12:32:44Z',
                        'endedAt': '2026-09-22T12:33:42Z',
                        'segmentCount': 1,
                        'title': '在线已保存记录',
                        'segments': [
                          {
                            'id': 's1',
                            'sourceText': '会议下午三点开始',
                            'translatedText': 'Meeting at three.'
                          }
                        ],
                      };
                      return http.Response(
                          jsonEncode(r.url.path == '/sessions'
                              ? {
                                  'sessions': [detail]
                                }
                              : detail),
                          200,
                          headers: {
                            'content-type': 'application/json; charset=utf-8'
                          });
                    })),
            shareService: Share());
    // This is the old build-default routing: nothing local can represent the online record.
    final old = factory(base);
    await tester.runAsync(() async {
      expect(await old.listSessions(), isEmpty);
    });
    old.dispose();
    await tester.pumpWidget(app(SessionHistoryPage(
        config: base,
        settingsStore: MemoryRealtimeSettingsStore(settings(true)),
        repositoryFactory: factory)));
    await tester.pumpAndSettle();
    expect(find.text('在线已保存记录'), findsOneWidget);
    await tester.tap(find.text('在线已保存记录'));
    await tester.pumpAndSettle();
    expect(find.text('会议下午三点开始'), findsOneWidget);
    expect(requests, ['GET /sessions', 'GET /sessions/public-ended']);
    await tester.runAsync(() async {
      expect(
          await local.loadCheckpoints(
              deploymentId: 'public-test', ownerId: 'owner'),
          isEmpty);
    });
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'on-device selection never constructs cloud history even with online build default',
      (tester) async {
    final seen = <bool>[];
    await tester.pumpWidget(app(SessionHistoryPage(
        config: base.copyWith(useLocalSessions: false),
        settingsStore: MemoryRealtimeSettingsStore(settings(false)),
        repositoryFactory: (config) {
          seen.add(config.useLocalSessions);
          return Repo('本地历史');
        })));
    await tester.pumpAndSettle();
    expect(seen, [true]);
    expect(find.text('本地历史'), findsOneWidget);
  });

  testWidgets(
      'tab return rereads mode and releases owned old history without merging scopes',
      (tester) async {
    final store = MemoryRealtimeSettingsStore(settings(true));
    final made = <Repo>[];
    SessionHistoryRepository factory(AppConfig c) {
      final r = Repo(c.useLocalSessions ? '本地记录' : '公有记录');
      made.add(r);
      return r;
    }

    Widget page(bool active) => app(SessionHistoryPage(
        config: base,
        settingsStore: store,
        repositoryFactory: factory,
        active: active));
    await tester.pumpWidget(page(true));
    await tester.pumpAndSettle();
    expect(find.text('公有记录'), findsOneWidget);
    await tester.pumpWidget(page(false));
    await tester.pumpAndSettle();
    await store.save(settings(false));
    await tester.pumpWidget(page(true));
    await tester.pumpAndSettle();
    expect(find.text('本地记录'), findsOneWidget);
    expect(find.text('公有记录'), findsNothing);
    expect(made, hasLength(2));
    expect(made.first.disposed, isTrue);
  });

  testWidgets('tab return refreshes newly ended records with unchanged mode',
      (tester) async {
    final store = MemoryRealtimeSettingsStore(settings(true));
    var number = 0;
    SessionHistoryRepository factory(AppConfig _) => Repo('记录${++number}');
    Widget page(bool active) => app(SessionHistoryPage(
        config: base,
        settingsStore: store,
        repositoryFactory: factory,
        active: active));
    await tester.pumpWidget(page(true));
    await tester.pumpAndSettle();
    await tester.pumpWidget(page(false));
    await tester.pumpAndSettle();
    await tester.pumpWidget(page(true));
    await tester.pumpAndSettle();
    expect(find.text('记录2'), findsOneWidget);
    expect(find.text('记录1'), findsNothing);
  });

  testWidgets(
      'delayed settings cannot dispatch cloud history after leaving the tab',
      (tester) async {
    final store = DelayedSettings();
    var creates = 0;
    SessionHistoryRepository factory(AppConfig _) {
      creates++;
      return Repo('错误');
    }

    Widget page(bool active) => app(SessionHistoryPage(
        config: base,
        settingsStore: store,
        repositoryFactory: factory,
        active: active));
    await tester.pumpWidget(page(true));
    await tester.pump();
    await tester.pumpWidget(page(false));
    store.pending.complete(settings(true));
    await tester.pumpAndSettle();
    expect(creates, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'settings finishing after dispose causes no repository or request',
      (tester) async {
    final store = DelayedSettings();
    var creates = 0;
    await tester.pumpWidget(app(SessionHistoryPage(
        config: base,
        settingsStore: store,
        repositoryFactory: (_) {
          creates++;
          return Repo('错误');
        })));
    await tester.pumpWidget(app(const SizedBox()));
    store.pending.complete(settings(true));
    await tester.pumpAndSettle();
    expect(creates, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'online failure stays an error and never falls back to local history',
      (tester) async {
    final seen = <bool>[];
    await tester.pumpWidget(app(SessionHistoryPage(
        config: base,
        settingsStore: MemoryRealtimeSettingsStore(settings(true)),
        repositoryFactory: (c) {
          seen.add(c.useLocalSessions);
          return Repo('private-data', fail: true);
        })));
    await tester.pumpAndSettle();
    expect(seen, [false]);
    expect(find.text('private-data'), findsNothing);
    expect(find.text('重试'), findsOneWidget);
  });

  testWidgets(
      'injected legacy repository bypasses settings and remains caller-owned',
      (tester) async {
    final store = DelayedSettings(), repo = Repo('旧路径');
    await tester.pumpWidget(
        app(SessionHistoryPage(repository: repo, settingsStore: store)));
    await tester.pumpAndSettle();
    expect(find.text('旧路径'), findsOneWidget);
    expect(store.loads, 0);
    await tester.pumpWidget(app(const SizedBox()));
    expect(repo.disposed, isFalse);
  });
}

Widget app(Widget child) => MaterialApp(
    locale: const Locale('zh'),
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate
    ],
    supportedLocales: AppLocalizations.supportedLocales,
    home: child);

class DelayedSettings extends RealtimeSettingsStore {
  final pending = Completer<RealtimeRuntimeSettings?>();
  int loads = 0;
  @override
  Future<RealtimeRuntimeSettings?> load() {
    loads++;
    return pending.future;
  }

  @override
  Future<void> save(RealtimeRuntimeSettings s) async {}
}

class Repo extends SessionHistoryRepository {
  Repo(this.title, {this.fail = false}) : super(shareService: Share());
  final String title;
  final bool fail;
  bool disposed = false;
  @override
  Future<List<SessionListItem>> listSessions({String query = ''}) async {
    if (fail) throw Exception('synthetic-network-failure');
    return [
      SessionListItem(
          sessionId: 's1',
          mode: 'conversation',
          status: 'ended',
          consumedSeconds: 1,
          createdAt: DateTime.utc(2026, 9, 22),
          segmentCount: 1,
          title: title)
    ];
  }

  @override
  void dispose() {
    disposed = true;
    super.dispose();
  }
}

class Share implements FileShareService {
  @override
  Future<String> saveExportFile(List<int> bytes, String filename) async =>
      filename;
  @override
  Future<void> shareFile(String path, {String? mimeType}) async {}
}
