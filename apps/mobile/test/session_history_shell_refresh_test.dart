import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/presentation/pages/session_history_page.dart';
import 'package:translation_mobile/src/features/realtime/presentation/pages/realtime_page.dart';
import 'package:translation_mobile/src/features/shell/presentation/pages/main_shell_page.dart';
import 'session_history_runtime_mode_test.dart' as fixture;

void main() {
  testWidgets(
      'original five-tab shell refreshes history on each activation, not while hidden',
      (tester) async {
    final repository = CountingHistory();
    await tester.pumpWidget(fixture.app(MainShellPage(
        config: fixture.base,
        realtimePage: const EmptyRealtime(),
        historyRepository: repository)));
    await tester.pumpAndSettle();
    expect(repository.calls, 0);
    await tester.tap(find.text('记录'));
    await tester.pumpAndSettle();
    expect(repository.calls, 1);
    expect(
        tester
            .widget<SessionHistoryPage>(find.byType(SessionHistoryPage))
            .config,
        same(fixture.base));
    await tester.tap(find.descendant(
        of: find.byType(NavigationBar), matching: find.text('同传')));
    await tester.pumpAndSettle();
    expect(repository.calls, 1);
    await tester.tap(find.text('记录'));
    await tester.pumpAndSettle();
    expect(repository.calls, 2);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(fixture.app(const SizedBox()));
    expect(repository.disposed, isFalse);
  });
}

class CountingHistory extends fixture.Repo {
  CountingHistory() : super('原历史');
  int calls = 0;
  @override
  Future<List<SessionListItem>> listSessions({String query = ''}) {
    calls++;
    return super.listSessions(query: query);
  }
}

class EmptyRealtime extends RealtimePage {
  const EmptyRealtime({super.key});
  @override
  State<RealtimePage> createState() => EmptyRealtimeState();
}

class EmptyRealtimeState extends State<RealtimePage> {
  @override
  Widget build(BuildContext context) => const SizedBox();
}
