import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

class ConsentVisuals {
  const ConsentVisuals({
    required this.background,
    required this.groupedSurface,
    required this.primaryText,
    required this.secondaryText,
    required this.tertiaryText,
    required this.separator,
    required this.accent,
    required this.onAccent,
    required this.disabledFill,
    required this.largeTitle,
    required this.body,
    required this.notice,
    required this.rowTitle,
    required this.caption,
    required this.sectionTitle,
    required this.sectionBody,
    required this.action,
  });

  final Color background;
  final Color groupedSurface;
  final Color primaryText;
  final Color secondaryText;
  final Color tertiaryText;
  final Color separator;
  final Color accent;
  final Color onAccent;
  final Color disabledFill;
  final TextStyle largeTitle;
  final TextStyle body;
  final TextStyle notice;
  final TextStyle rowTitle;
  final TextStyle caption;
  final TextStyle sectionTitle;
  final TextStyle sectionBody;
  final TextStyle action;

  factory ConsentVisuals.resolve(BuildContext context) {
    final material = Theme.of(context);
    final isApple = material.platform == TargetPlatform.iOS ||
        material.platform == TargetPlatform.macOS;
    if (!isApple) return _materialVisuals(material);

    Color resolve(CupertinoDynamicColor color) =>
        CupertinoDynamicColor.resolve(color, context);

    final text = CupertinoTheme.of(context).textTheme;
    final primaryText = resolve(CupertinoColors.label);
    final secondaryText = resolve(CupertinoColors.secondaryLabel);
    final tertiaryText = resolve(CupertinoColors.tertiaryLabel);
    return ConsentVisuals(
      background: resolve(CupertinoColors.systemGroupedBackground),
      groupedSurface: resolve(CupertinoColors.secondarySystemGroupedBackground),
      primaryText: primaryText,
      secondaryText: secondaryText,
      tertiaryText: tertiaryText,
      separator: resolve(CupertinoColors.separator),
      accent: resolve(CupertinoColors.systemBlue),
      onAccent: CupertinoColors.white,
      disabledFill: resolve(CupertinoColors.systemFill),
      largeTitle: text.navLargeTitleTextStyle.copyWith(
        color: primaryText,
        height: 1.14,
      ),
      body: text.textStyle.copyWith(color: secondaryText, height: 1.35),
      notice: text.textStyle.copyWith(
        color: primaryText,
        fontSize: 15,
        height: 1.45,
      ),
      rowTitle: text.textStyle.copyWith(
        color: primaryText,
        fontWeight: FontWeight.w600,
      ),
      caption: text.textStyle.copyWith(
        color: secondaryText,
        fontSize: 13,
        height: 1.35,
      ),
      sectionTitle: text.textStyle.copyWith(
        color: primaryText,
        fontSize: 15,
        fontWeight: FontWeight.w600,
      ),
      sectionBody: text.textStyle.copyWith(
        color: secondaryText,
        fontSize: 15,
        height: 1.45,
      ),
      action: text.actionTextStyle.copyWith(
        color: CupertinoColors.white,
        fontWeight: FontWeight.w600,
      ),
    );
  }

  static ConsentVisuals _materialVisuals(ThemeData material) {
    final colors = material.colorScheme;
    return ConsentVisuals(
      background: colors.surface,
      groupedSurface: colors.surfaceContainer,
      primaryText: colors.onSurface,
      secondaryText: colors.onSurfaceVariant,
      tertiaryText: colors.onSurfaceVariant.withValues(alpha: 0.72),
      separator: colors.outlineVariant,
      accent: colors.primary,
      onAccent: colors.onPrimary,
      disabledFill: colors.surfaceContainerHighest,
      largeTitle: material.textTheme.headlineMedium!.copyWith(
        color: colors.onSurface,
      ),
      body: material.textTheme.bodyLarge!.copyWith(
        color: colors.onSurfaceVariant,
      ),
      notice: material.textTheme.bodyMedium!.copyWith(color: colors.onSurface),
      rowTitle:
          material.textTheme.titleMedium!.copyWith(color: colors.onSurface),
      caption: material.textTheme.bodyMedium!.copyWith(
        color: colors.onSurfaceVariant,
      ),
      sectionTitle:
          material.textTheme.titleMedium!.copyWith(color: colors.onSurface),
      sectionBody: material.textTheme.bodyMedium!.copyWith(
        color: colors.onSurfaceVariant,
      ),
      action: material.textTheme.labelLarge!.copyWith(color: colors.onPrimary),
    );
  }
}
