part of 'app_localizations.dart';

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) {
    return AppLocalizations.supportedLocales.any(
      (supportedLocale) => supportedLocale.languageCode == locale.languageCode,
    );
  }

  @override
  Future<AppLocalizations> load(Locale locale) {
    final languageCode =
        locale.languageCode.toLowerCase() == 'en' ? 'en' : 'zh';
    return SynchronousFuture<AppLocalizations>(
      AppLocalizations(Locale(languageCode)),
    );
  }

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}
