import 'package:flutter/material.dart';

import '../features/shell/presentation/pages/main_shell_page.dart';

class AppRouter {
  static Route<dynamic> onGenerateRoute(RouteSettings settings,
      {MainShellPage? shellPage}) {
    return MaterialPageRoute<void>(
      builder: (_) => shellPage ?? const MainShellPage(),
      settings: settings,
    );
  }
}
