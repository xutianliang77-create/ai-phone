import 'package:flutter/material.dart';

const _lightPrimary = Color(0xFF087A70);
const _darkPrimary = Color(0xFF62D7CA);

ThemeData buildAppTheme({Brightness brightness = Brightness.light}) {
  final isDark = brightness == Brightness.dark;
  final colors = ColorScheme.fromSeed(
    seedColor: isDark ? _darkPrimary : _lightPrimary,
    brightness: brightness,
  ).copyWith(
    primary: isDark ? _darkPrimary : _lightPrimary,
    onPrimary: isDark ? const Color(0xFF003731) : Colors.white,
    secondary: isDark ? const Color(0xFFFFB0A6) : const Color(0xFFC4574E),
    onSecondary: isDark ? const Color(0xFF641B14) : Colors.white,
    tertiary: isDark ? const Color(0xFFB9C5FF) : const Color(0xFF4F6498),
    onTertiary: isDark ? const Color(0xFF1C2E60) : Colors.white,
    error: isDark ? const Color(0xFFFFB4AB) : const Color(0xFFC34C43),
    onError: isDark ? const Color(0xFF690005) : Colors.white,
    surface: isDark ? const Color(0xFF0C1110) : const Color(0xFFF7F9F8),
    onSurface: isDark ? const Color(0xFFE3E8E6) : const Color(0xFF17201E),
    surfaceContainer: isDark ? const Color(0xFF151C1A) : Colors.white,
    surfaceContainerHigh:
        isDark ? const Color(0xFF1C2522) : const Color(0xFFEAF0EE),
    surfaceContainerHighest:
        isDark ? const Color(0xFF25302D) : const Color(0xFFE0E9E6),
    outline: isDark ? const Color(0xFF87918E) : const Color(0xFF697572),
    outlineVariant: isDark ? const Color(0xFF394542) : const Color(0xFFD2DCDA),
  );
  final textTheme = _textTheme(colors);
  final rounded8 = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(8),
  );

  return ThemeData(
    brightness: brightness,
    colorScheme: colors,
    scaffoldBackgroundColor: colors.surface,
    textTheme: textTheme,
    appBarTheme: AppBarTheme(
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: true,
      backgroundColor: colors.surface,
      foregroundColor: colors.onSurface,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: textTheme.titleLarge,
      toolbarHeight: 60,
    ),
    cardTheme: CardThemeData(
      color: colors.surfaceContainer,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: rounded8.copyWith(
        side: BorderSide(color: colors.outlineVariant),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.surfaceContainer,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: colors.outlineVariant),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: colors.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: colors.primary, width: 2),
      ),
      labelStyle: textTheme.bodyMedium,
      floatingLabelStyle: textTheme.bodyMedium?.copyWith(
        color: colors.primary,
        fontWeight: FontWeight.w600,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 52),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        shape: rounded8,
        textStyle: textTheme.labelLarge,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 52),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        shape: rounded8,
        side: BorderSide(color: colors.outline),
        textStyle: textTheme.labelLarge,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(48, 44),
        shape: rounded8,
        textStyle: textTheme.labelLarge,
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        minimumSize: const Size.square(44),
        shape: rounded8,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 64,
      elevation: 0,
      backgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: colors.primary.withValues(alpha: 0.10),
      indicatorShape: rounded8,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        return textTheme.labelMedium?.copyWith(
          color: states.contains(WidgetState.selected)
              ? colors.primary
              : colors.onSurfaceVariant,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w700
              : FontWeight.w500,
        );
      }),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        return IconThemeData(
          color: states.contains(WidgetState.selected)
              ? colors.primary
              : colors.onSurfaceVariant,
        );
      }),
    ),
    listTileTheme: ListTileThemeData(
      minTileHeight: 64,
      iconColor: colors.primary,
      titleTextStyle: textTheme.titleMedium,
      subtitleTextStyle: textTheme.bodyMedium?.copyWith(
        color: colors.onSurfaceVariant,
      ),
      shape: rounded8,
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(shape: WidgetStatePropertyAll(rounded8)),
    ),
    dividerTheme: DividerThemeData(
      color: colors.outlineVariant,
      thickness: 1,
      space: 1,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: colors.inverseSurface,
      contentTextStyle: textTheme.bodyMedium?.copyWith(
        color: colors.onInverseSurface,
      ),
      shape: rounded8,
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: colors.primary,
      linearTrackColor: colors.surfaceContainerHighest,
    ),
    tooltipTheme:
        const TooltipThemeData(waitDuration: Duration(milliseconds: 400)),
    useMaterial3: true,
  );
}

TextTheme _textTheme(ColorScheme colors) {
  const base = TextTheme(
    displaySmall:
        TextStyle(fontSize: 36, height: 1.15, fontWeight: FontWeight.w700),
    headlineSmall:
        TextStyle(fontSize: 24, height: 1.25, fontWeight: FontWeight.w700),
    titleLarge:
        TextStyle(fontSize: 20, height: 1.3, fontWeight: FontWeight.w700),
    titleMedium:
        TextStyle(fontSize: 16, height: 1.4, fontWeight: FontWeight.w600),
    bodyLarge:
        TextStyle(fontSize: 16, height: 1.55, fontWeight: FontWeight.w400),
    bodyMedium:
        TextStyle(fontSize: 14, height: 1.5, fontWeight: FontWeight.w400),
    labelLarge:
        TextStyle(fontSize: 16, height: 1.25, fontWeight: FontWeight.w700),
    labelMedium:
        TextStyle(fontSize: 12, height: 1.3, fontWeight: FontWeight.w600),
  );
  return base.apply(
      bodyColor: colors.onSurface, displayColor: colors.onSurface);
}
