import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/history/data/session_history_api_client.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/history/presentation/pages/session_history_page.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('validates history search over a delayed real HTTP connection',
      (tester) async {
    binding.testTextInput.register();
    addTearDown(binding.testTextInput.unregister);

    const baseUrlValue = String.fromEnvironment('WEAK_NETWORK_BASE_URL');
    expect(
      baseUrlValue,
      isNotEmpty,
      reason: 'Pass --dart-define=WEAK_NETWORK_BASE_URL=http://host:port',
    );

    final client = _CountingClient();
    final apiClient = SessionHistoryApiClient(
      baseUrl: Uri.parse(baseUrlValue),
      client: client,
      accountSessionStore: MemoryAccountSessionStore(
        const AccountSession(
          token: 'weak-network-device-test',
          expiresAtIso: '2099-01-01T00:00:00.000Z',
        ),
      ),
    );
    final repository = SessionHistoryRepository(
      apiClient: apiClient,
      shareService: _NoopFileShareService(),
    );
    addTearDown(repository.dispose);

    await tester.pumpWidget(_TestApp(
      child: SessionHistoryPage(repository: repository),
    ));
    await _waitForText(tester, '初始记录');
    expect(client.queries, <String>['']);

    await tester.tap(find.byTooltip('搜索'));
    await tester.pumpAndSettle();
    final searchField = find.byType(TextField);

    await tester.enterText(searchField, '纪');
    await tester.pump(const Duration(milliseconds: 100));
    await tester.enterText(searchField, '纪要');
    await tester.pump(const Duration(milliseconds: 100));
    await tester.enterText(searchField, '纪要确认');
    await _waitForRequestCount(tester, client, 2);
    expect(client.queries, <String>['', '纪要确认']);
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await _waitForText(tester, '纪要确认记录');

    await tester.enterText(searchField, '立即搜索');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await _waitForRequestCount(tester, client, 3);
    expect(client.queries, <String>['', '纪要确认', '立即搜索']);
    await _waitForText(tester, '立即搜索记录');
    await tester.pump(const Duration(milliseconds: 350));
    expect(client.queries, <String>['', '纪要确认', '立即搜索']);

    await tester.enterText(searchField, '旧响应');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await _waitForRequestCount(tester, client, 4);

    await tester.enterText(searchField, '新响应');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await _waitForRequestCount(tester, client, 5);
    await _waitForText(tester, '新响应记录');
    expect(find.text('旧响应记录'), findsNothing);

    await _waitForElapsed(
      tester,
      const Duration(milliseconds: 1500),
    );
    expect(find.text('新响应记录'), findsOneWidget);
    expect(find.text('旧响应记录'), findsNothing);

    await tester.enterText(searchField, '待取消');
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.byTooltip('清除'));
    await _waitForRequestCount(tester, client, 6);
    await _waitForText(tester, '初始记录');
    await tester.pump(const Duration(milliseconds: 350));
    expect(
      client.queries,
      <String>['', '纪要确认', '立即搜索', '旧响应', '新响应', ''],
    );
    expect(find.byType(TextField), findsNothing);

    final result = <String, Object?>{
      'requestCount': client.queries.length,
      'queries': client.queries,
      'debounceMs': 300,
      'loadingObserved': true,
      'keyboardSubmitObserved': true,
      'staleResponseIgnored': true,
      'pendingSearchCancelled': true,
    };
    final evidenceResponse = await http.post(
      Uri.parse(baseUrlValue).resolve('/result'),
      headers: const <String, String>{'content-type': 'application/json'},
      body: jsonEncode(result),
    );
    expect(evidenceResponse.statusCode, 200);
    debugPrint('WEAK_NETWORK_DEVICE_RESULT ${jsonEncode(result)}');
  });
}

class _CountingClient extends http.BaseClient {
  final http.Client _inner = http.Client();
  final List<String> queries = <String>[];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    final query = request.url.queryParameters['q'] ?? '';
    queries.add(query);
    debugPrint('WEAK_NETWORK_CLIENT_REQUEST ${jsonEncode({
          'index': queries.length,
          'method': request.method,
          'path': request.url.path,
          'query': query,
          'at': DateTime.now().toUtc().toIso8601String(),
        })}');
    return _inner.send(request);
  }

  @override
  void close() => _inner.close();
}

class _TestApp extends StatelessWidget {
  const _TestApp({required this.child});

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

class _NoopFileShareService implements FileShareService {
  @override
  Future<String> saveExportFile(List<int> bytes, String filename) async {
    return filename;
  }

  @override
  Future<void> shareFile(String path, {String? mimeType}) async {}
}

Future<void> _waitForRequestCount(
  WidgetTester tester,
  _CountingClient client,
  int expected,
) {
  return _waitUntil(
    tester,
    () => client.queries.length >= expected,
    'request count $expected',
  );
}

Future<void> _waitForText(WidgetTester tester, String text) {
  return _waitUntil(
    tester,
    () => find.text(text).evaluate().isNotEmpty,
    'text "$text"',
  );
}

Future<void> _waitUntil(
  WidgetTester tester,
  bool Function() condition,
  String description, {
  Duration timeout = const Duration(seconds: 8),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('Timed out waiting for $description');
    }
    await tester.pump(const Duration(milliseconds: 50));
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}

Future<void> _waitForElapsed(WidgetTester tester, Duration duration) async {
  final deadline = DateTime.now().add(duration);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 50));
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}
