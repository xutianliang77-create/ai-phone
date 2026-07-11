import 'package:flutter/widgets.dart';

class AppLanguageScope extends InheritedWidget {
  const AppLanguageScope({
    required this.locale,
    required this.onChanged,
    required super.child,
    super.key,
  });

  final Locale locale;
  final ValueChanged<Locale> onChanged;

  static AppLanguageScope of(BuildContext context) {
    final scope =
        context.dependOnInheritedWidgetOfExactType<AppLanguageScope>();
    assert(scope != null, 'AppLanguageScope missing from context');
    return scope!;
  }

  @override
  bool updateShouldNotify(AppLanguageScope oldWidget) {
    return locale != oldWidget.locale || onChanged != oldWidget.onChanged;
  }
}
