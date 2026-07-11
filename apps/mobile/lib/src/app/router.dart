import 'package:flutter/material.dart';

import '../features/shell/presentation/pages/main_shell_page.dart';

class AppRouter {
  static Route<dynamic> onGenerateRoute(RouteSettings settings) {
    return MaterialPageRoute<void>(
      builder: (_) => const MainShellPage(),
      settings: settings,
    );
  }
}
