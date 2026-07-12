import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'app_language.dart';
import 'localization/app_localizations.dart';
import 'router.dart';
import 'theme.dart';
import '../features/compliance/data/compliance_consent_store.dart';
import '../features/compliance/data/consent_audit_uploader.dart';
import '../features/compliance/presentation/pages/compliance_consent_gate.dart';

class TranslationApp extends StatefulWidget {
  const TranslationApp({
    this.locale = const Locale('zh'),
    this.complianceConsentStore,
    this.consentAuditUploader,
    super.key,
  });

  final Locale? locale;
  final ComplianceConsentStore? complianceConsentStore;
  final ConsentAuditUploader? consentAuditUploader;

  @override
  State<TranslationApp> createState() => _TranslationAppState();
}

class _TranslationAppState extends State<TranslationApp> {
  late Locale? _locale = widget.locale;

  @override
  void didUpdateWidget(TranslationApp oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.locale != oldWidget.locale) {
      _locale = widget.locale;
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ai phone',
      onGenerateTitle: (context) => context.l10n.appTitle,
      locale: _locale,
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      localeListResolutionCallback: _resolveLocaleList,
      localeResolutionCallback: _resolveLocale,
      theme: buildAppTheme(),
      darkTheme: buildAppTheme(brightness: Brightness.dark),
      themeMode: ThemeMode.system,
      onGenerateRoute: AppRouter.onGenerateRoute,
      builder: (context, child) => AppLanguageScope(
        locale: _locale ?? Localizations.localeOf(context),
        onChanged: _changeLocale,
        child: ComplianceConsentGate(
          store: widget.complianceConsentStore ??
              const FileComplianceConsentStore(),
          consentAuditUploader: widget.consentAuditUploader,
          child: child ?? const SizedBox.shrink(),
        ),
      ),
    );
  }

  void _changeLocale(Locale locale) {
    setState(() => _locale = locale);
  }

  Locale _resolveLocale(Locale? locale, Iterable<Locale> supportedLocales) {
    if (locale == null) return const Locale('zh');
    for (final supportedLocale in supportedLocales) {
      if (supportedLocale.languageCode == locale.languageCode) {
        return supportedLocale;
      }
    }
    return const Locale('zh');
  }

  Locale _resolveLocaleList(
    List<Locale>? locales,
    Iterable<Locale> supportedLocales,
  ) {
    for (final locale in locales ?? const <Locale>[]) {
      final resolved = _resolveLocale(locale, supportedLocales);
      if (resolved.languageCode == locale.languageCode) return resolved;
    }
    return const Locale('zh');
  }
}
