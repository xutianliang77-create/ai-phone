import 'package:flutter_test/flutter_test.dart';
import 'package:iphone14_model_tester/main.dart';

void main() {
  testWidgets('shows model tester title', (tester) async {
    await tester.pumpWidget(const ModelTesterApp());
    expect(find.text('iPhone14 端侧模型测试'), findsOneWidget);
  });
}
