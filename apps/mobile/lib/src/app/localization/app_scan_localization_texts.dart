const appScanLocalizationTexts = <String, Map<String, String>>{
  'scanCamera': {'zh': '拍照', 'en': 'Camera'},
  'scanGallery': {'zh': '相册', 'en': 'Gallery'},
  'scanPickImage': {'zh': '选择图片后开始识别', 'en': 'Choose an image to scan'},
  'scanRecognizing': {'zh': '正在识别文字', 'en': 'Recognizing text'},
  'scanImageSelected': {'zh': '已选图片', 'en': 'Selected image'},
  'scanImageComparison': {'zh': '图片对照', 'en': 'Image comparison'},
  'scanOriginalLayer': {'zh': '原图', 'en': 'Original'},
  'scanTranslationLayer': {'zh': '译文', 'en': 'Translation'},
  'scanTextComparison': {'zh': '文字对照', 'en': 'Text comparison'},
  'scan_pick_image_first': {
    'zh': '请先拍照或从相册选择图片',
    'en': 'Choose an image before recognition',
  },
  'scan_image_pick_failed': {
    'zh': '无法读取图片，请检查相机或照片权限',
    'en': 'Unable to read the image. Check camera or photo access.',
  },
  'recognizedText': {'zh': '识别文字', 'en': 'Recognized text'},
  'scan_no_text': {'zh': '未识别到文字，请换一张更清晰的图片', 'en': 'No text recognized'},
  'scan_ocr_failed': {'zh': '识别失败，图片已保留，可重试或更换图片。', 'en': 'Recognition failed. The image is kept; retry or choose another.'},
  'scan_translation_unavailable': {
    'zh': '翻译暂不可用，已保留识别文字',
    'en': 'Translation unavailable; recognized text is kept',
  },
  'scan_language_uncertain': {
    'zh': '无法确定原文语言，请手动选择中文或英文；已保留识别文字。',
    'en':
        'Could not determine the source language. Select Chinese or English; the text is kept.',
  },
  'scan_entities_unverified': {
    'zh': '译文中的编号、数字或否定内容无法核对，请检查原文后重试。',
    'en':
        'Numbers, identifiers or negation could not be verified. Check the source and retry.',
  },
  'scan_saved': {'zh': '已保存到记录', 'en': 'Saved to history.'},
  'scan_save_failed': {
    'zh': '保存失败，请稍后重试',
    'en': 'Could not save. Try again later.',
  },
};
