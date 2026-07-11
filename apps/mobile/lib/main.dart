import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';

import 'src/app/app_config.dart';
import 'src/app/app.dart';
import 'src/platform/diagnostics/app_error_reporter.dart';

void main() {
  runZonedGuarded(() {
    WidgetsFlutterBinding.ensureInitialized();
    final reporter = AppErrorReporter.fromConfig(AppConfig.fromEnvironment());
    FlutterError.onError = (details) {
      FlutterError.presentError(details);
      unawaited(reporter.reportFlutterError(details));
    };
    PlatformDispatcher.instance.onError = (error, stackTrace) {
      unawaited(
        reporter.reportError(
          error,
          stackTrace,
          eventType: 'platform_error',
          fatal: true,
        ),
      );
      return true;
    };
    runApp(const TranslationApp());
  }, (error, stackTrace) {
    final reporter = AppErrorReporter.fromConfig(AppConfig.fromEnvironment());
    unawaited(
      reporter.reportError(
        error,
        stackTrace,
        eventType: 'zone_error',
        fatal: true,
      ),
    );
  });
}
