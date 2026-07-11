import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/compliance/presentation/pages/compliance_center_page.dart';

void main() {
  testWidgets('opens domestic compliance documents', (tester) async {
    await tester.pumpWidget(const _TestApp(child: ComplianceCenterPage()));

    expect(find.text('隐私与合规'), findsOneWidget);
    expect(find.text('隐私政策'), findsOneWidget);
    expect(find.text('用户协议'), findsOneWidget);
    expect(find.text('客服与账户'), findsOneWidget);
    expect(find.text('第三方 SDK 与模型服务商清单'), findsOneWidget);
    expect(find.text('权限用途说明'), findsOneWidget);

    await tester.tap(find.text('隐私政策'));
    await tester.pumpAndSettle();

    expect(find.text('我们处理的数据'), findsOneWidget);
    expect(find.textContaining('默认不保存原始音频'), findsOneWidget);
    expect(find.textContaining('国内版数据区域：cn'), findsOneWidget);
  });

  testWidgets('shows support, refund, account deletion, and privacy feedback',
      (tester) async {
    await tester.pumpWidget(const _TestApp(child: ComplianceCenterPage()));

    await tester.tap(find.text('客服与账户'));
    await tester.pumpAndSettle();

    expect(find.text('客服入口'), findsOneWidget);
    expect(find.textContaining('support@qkxy.cn'), findsOneWidget);
    expect(find.text('退款处理'), findsOneWidget);
    expect(find.textContaining('Apple 退款流程'), findsOneWidget);
    expect(find.text('删除账号'), findsOneWidget);
    expect(find.textContaining('https://app.qkxy.cn/account/delete'),
        findsOneWidget);
    expect(find.text('隐私反馈'), findsOneWidget);
    expect(find.text('复制邮箱'), findsWidgets);

    await tester.tap(find.widgetWithText(OutlinedButton, '复制邮箱').first);
    await tester.pumpAndSettle();
    expect(find.text('已复制'), findsOneWidget);

    await tester.drag(find.byType(ListView), const Offset(0, -300));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('复制链接'));
    await tester.tap(find.widgetWithText(OutlinedButton, '复制链接'));
    await tester.pumpAndSettle();
    expect(find.text('已复制'), findsWidgets);
  });

  testWidgets('shows provider and permission details', (tester) async {
    await tester.pumpWidget(const _TestApp(child: ComplianceCenterPage()));

    await tester.tap(find.text('第三方 SDK 与模型服务商清单'));
    await tester.pumpAndSettle();
    expect(find.text('国内模型链路'), findsOneWidget);
    expect(find.textContaining('Qwen LiveTranslate'), findsOneWidget);
    expect(find.textContaining('未完成真实商户联调前不公开入口'), findsOneWidget);

    tester.state<NavigatorState>(find.byType(Navigator)).pop();
    await tester.pumpAndSettle();
    await tester.tap(find.text('权限用途说明'));
    await tester.pumpAndSettle();
    expect(find.text('麦克风'), findsOneWidget);
    expect(find.textContaining('仅在用户点击同传'), findsOneWidget);
    expect(find.textContaining('用户可以在记录页删除已保存会话'), findsOneWidget);
  });
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
