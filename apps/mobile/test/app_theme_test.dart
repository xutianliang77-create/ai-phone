import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/theme.dart';

void main() {
  test('provides distinct accessible light and dark operational themes', () {
    final light = buildAppTheme();
    final dark = buildAppTheme(brightness: Brightness.dark);

    expect(light.brightness, Brightness.light);
    expect(dark.brightness, Brightness.dark);
    expect(light.colorScheme.primary, isNot(light.colorScheme.error));
    expect(dark.colorScheme.primary, isNot(dark.colorScheme.tertiary));
    expect(light.cardTheme.elevation, 0);
    expect(dark.bottomSheetTheme.backgroundColor, dark.colorScheme.surface);
  });
}
