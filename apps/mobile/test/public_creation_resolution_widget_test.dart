import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_api_client.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/public_creation_resolution_actions.dart';
import 'public_creation_client_test.dart' as fixture;
import 'public_creation_resolution_test.dart' as data;

Widget app(RealtimeController controller) => MaterialApp(locale: const Locale('zh'),
  supportedLocales: AppLocalizations.supportedLocales,
  localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
  home: Scaffold(body: PublicCreationResolutionActions(controller: controller)));
RealtimeController controller(fixture.Harness h, RealtimeApiClient api, {bool local=false}) => RealtimeController(
  repository: RealtimeRepository(apiClient: api, gatewayClient: fixture.Gateway()),
  config: AppConfig.fromEnvironment().copyWith(useLocalSessions: local));

void main() {
  testWidgets('original inline actions query first, confirm cancellation, and never start a session', (tester) async {
    late fixture.Harness h;late RealtimeApiClient api;
    await tester.runAsync(() async {final pair=await data.pending();h=pair.$1;api=pair.$2;});
    final c=controller(h,api);addTearDown(() async {await c.disposeAsync();c.dispose();h.close();});
    h.post=(r)async=>http.Response(jsonEncode(data.receipt(r,r.url.path.endsWith('/query')?'issued':'cancelled')),200);
    await tester.pumpWidget(app(c));expect(find.text('撤销未开始请求'),findsNothing);
    await tester.runAsync(() async {await tester.tap(find.text('查看未决创建'));await Future<void>.delayed(const Duration(milliseconds:60));});
    await tester.pumpAndSettle();expect(find.text('撤销未开始请求'),findsOneWidget);
    await tester.tap(find.text('撤销未开始请求'));await tester.pumpAndSettle();
    expect(find.text('确认处置未开始请求？'),findsOneWidget);
    await tester.tap(find.text('返回'));await tester.pumpAndSettle();
    expect(h.requests.where((r)=>r.url.path.endsWith('/cancel')),isEmpty);
    await tester.tap(find.text('撤销未开始请求'));await tester.pumpAndSettle();
    await tester.tap(find.text('确认'));await tester.pumpAndSettle();
    // File I/O completes in the real loop; dialog continuations also need the
    // widget fake-async queue pumped. Wait for the actual operation, not sleep.
    for(var i=0;i<50&&c.publicCreationResolutionBusy;i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds:10)));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(data.disk(h)['state'],'retired',reason: jsonEncode({
      'paths':h.requests.map((r)=>r.url.path).toList(),
      'text':tester.widgetList<Text>(find.byType(Text)).map((w)=>w.data).toList()}));
    expect(find.text('作废回执已保存；可修改设置后手动开始。'),findsOneWidget);
    expect(data.disk(h)['state'],'retired');expect(c.status,RealtimeStatus.idle);
    expect(h.requests.where((r)=>r.url.path=='/realtime/sessions'),hasLength(1));
  });
  testWidgets('local mode has no public resolution controls', (tester) async {
    final h=fixture.Harness();final api=h.create();
    final c=controller(h,api,local:true);addTearDown(() async {await c.disposeAsync();c.dispose();h.close();api.close();});
    await tester.pumpWidget(app(c));expect(find.text('查看未决创建'),findsNothing);expect(h.requests,isEmpty);
  });
  test('controller blocks start during resolution and stop cancels the late reply', () async {
    final (h,api)=await data.pending();final c=controller(h,api);
    addTearDown(() async {await c.disposeAsync();c.dispose();h.close();});
    final delayed=Completer<http.Response>();http.Request? sent;
    h.post=(r){sent=r;return delayed.future;};final query=c.resolvePendingPublicCreation();final failed=expectLater(query,throwsA(anything));
    while(sent==null){await Future<void>.delayed(Duration.zero);}
    expect(c.publicCreationResolutionBusy,true);await c.start();expect(c.status,RealtimeStatus.idle);
    await c.stop();await failed;delayed.complete(http.Response(jsonEncode(data.receipt(sent!,'cancelled')),200));
    await Future<void>.delayed(Duration.zero);expect(data.disk(h)['state'],'pending');expect(c.publicCreationResolutionBusy,false);
  });
}
