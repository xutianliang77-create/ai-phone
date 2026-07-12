import 'package:flutter/material.dart';

ThemeData buildAppTheme({Brightness brightness = Brightness.light}) {
  final isDark = brightness == Brightness.dark;
  final colors = ColorScheme(
    brightness: brightness,
    primary: isDark ? const Color(0xFF63D5C9) : const Color(0xFF087F73),
    onPrimary: isDark ? const Color(0xFF003731) : Colors.white,
    secondary: isDark ? const Color(0xFFFFB4A9) : const Color(0xFFA83F35),
    onSecondary: isDark ? const Color(0xFF641B14) : Colors.white,
    tertiary: isDark ? const Color(0xFFFFC66A) : const Color(0xFF805600),
    onTertiary: isDark ? const Color(0xFF442B00) : Colors.white,
    error: isDark ? const Color(0xFFFFB4AB) : const Color(0xFFBA1A1A),
    onError: isDark ? const Color(0xFF690005) : Colors.white,
    surface: isDark ? const Color(0xFF111412) : const Color(0xFFF8FAF8),
    onSurface: isDark ? const Color(0xFFE1E4E1) : const Color(0xFF191C1B),
  );
  return ThemeData(
    colorScheme: colors,
    scaffoldBackgroundColor: colors.surface,
    cardTheme: CardThemeData(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: colors.outlineVariant),
      ),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
      ),
    ),
    tooltipTheme:
        const TooltipThemeData(waitDuration: Duration(milliseconds: 400)),
    useMaterial3: true,
  );
}
