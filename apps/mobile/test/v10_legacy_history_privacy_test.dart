import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/presentation/pages/legacy_local_history_page.dart';

class _Store extends LocalSessionStore {
  _Store({this.withRecord = false});
  final bool withRecord;
  int reads = 0;
  @override
  Future<List<SessionListItem>> listSessions({String query = ''}) async {
    reads++;
    return withRecord ? [SessionListItem(sessionId:'legacy',mode:'conversation',status:'ended',
      consumedSeconds:0,createdAt:DateTime.utc(2026),segmentCount:0,title:'示例旧记录')] : [];
  }
  @override
  Future<SessionDetail> getSession(String sessionId) async => SessionDetail(
    sessionId: sessionId, mode:'conversation',status:'ended',consumedSeconds:0,
    createdAt:DateTime.utc(2026),segmentCount:0,segments:const []);
}

void main() {
  testWidgets('old records are not read before device authentication', (
    tester,
  ) async {
    final store = _Store();
    var allowed = false;
    await tester.pumpWidget(
      MaterialApp(
        home: LegacyLocalHistoryPage(
          store: store,
          authenticate: () async => allowed,
        ),
      ),
    );
    expect(store.reads, 0);
    await tester.tap(find.text('验证身份并查看旧记录'));
    await tester.pumpAndSettle();
    expect(store.reads, 0);
    expect(find.text('未完成设备身份验证。旧记录未打开。'), findsOneWidget);
    allowed = true;
    await tester.tap(find.text('验证身份并查看旧记录'));
    await tester.pumpAndSettle();
    expect(store.reads, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(find.text('验证身份并查看旧记录'), findsOneWidget);
  });

  testWidgets(
    'an authentication result arriving after backgrounding is rejected',
    (tester) async {
      final store = _Store(), gate = Completer<bool>();
      await tester.pumpWidget(
        MaterialApp(
          home: LegacyLocalHistoryPage(
            store: store,
            authenticate: () => gate.future,
          ),
        ),
      );
      await tester.tap(find.text('验证身份并查看旧记录'));
      await tester.pump();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      gate.complete(true);
      await tester.pumpAndSettle();
      expect(store.reads, 0);
      expect(find.text('验证身份并查看旧记录'), findsOneWidget);
    },
  );
  testWidgets('backgrounding closes the record dialog without popping its page', (tester) async {
    final store=_Store(withRecord:true);
    await tester.pumpWidget(MaterialApp(home:LegacyLocalHistoryPage(store:store,authenticate:() async => true)));
    await tester.tap(find.text('验证身份并查看旧记录'));await tester.pumpAndSettle();
    await tester.tap(find.text('示例旧记录'));await tester.pumpAndSettle();
    expect(find.byType(AlertDialog),findsOneWidget);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);await tester.pumpAndSettle();
    expect(find.byType(AlertDialog),findsNothing);
    expect(find.text('验证身份并查看旧记录'),findsOneWidget);
  });
}
