import '../ocr/mobile_ocr_provider.dart';
import '../translation/mobile_translation_provider.dart';
import 'on_device_license.dart';
import '../speech/speech_output_provider.dart';

/// Acquire a control-only license before sending content to a local method
/// channel. Native entry and completion checks remain the actual hard gate.
class LicensedLocalOcr implements MobileOcrProvider {
  LicensedLocalOcr(this.delegate, {OnDeviceLicense? license})
    : license = license ?? OnDeviceLicenseClient.shared;
  final MobileOcrProvider delegate;
  final OnDeviceLicense license;
  @override
  Future<MobileOcrResult?> recognizeImage(
    String path, {
    List<String>? preferredScripts,
  }) async {
    await license.ensureValid();
    await license.activity('ocr', true);
    try {
      return await delegate.recognizeImage(
        path,
        preferredScripts: preferredScripts,
      );
    } finally {
      await license.activity('ocr', false);
    }
  }

  @override
  Future<void> dispose() => delegate.dispose();
}

class LicensedLocalTranslation
    implements MobileTranslationProvider, MobileTranslationDiagnostics {
  LicensedLocalTranslation(this.delegate, {OnDeviceLicense? license})
    : license = license ?? OnDeviceLicenseClient.shared;
  final MobileTranslationProvider delegate;
  final OnDeviceLicense license;
  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    await license.ensureValid();
    await license.activity('translation', true);
    try {
      return await delegate.translate(text, config);
    } finally {
      await license.activity('translation', false);
    }
  }

  @override
  Future<MobileTranslationAvailability> availability(
    MobileTranslationConfig config,
  ) => (delegate as MobileTranslationDiagnostics).availability(config);
  @override
  Future<void> dispose() => delegate.dispose();
}

class LicensedLocalSpeech implements SpeechOutputProvider {
  LicensedLocalSpeech(this.delegate, {OnDeviceLicense? license})
    : license = license ?? OnDeviceLicenseClient.shared;
  final SpeechOutputProvider delegate;
  final OnDeviceLicense license;
  @override
  Future<SpeechOutputResult> speak({
    required String text,
    required String language,
  }) async {
    await license.ensureValid();
    await license.activity('typed-speech', true);
    try {
      return await delegate.speak(text: text, language: language);
    } finally {
      await license.activity('typed-speech', false);
    }
  }

  @override
  Future<void> stop() => delegate.stop();
}
