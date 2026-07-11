enum ComplianceDocumentKind {
  privacy,
  terms,
  account,
  providers,
  permissions,
}

class ComplianceDocument {
  const ComplianceDocument({
    required this.kind,
    required this.zhTitle,
    required this.enTitle,
    required this.zhSubtitle,
    required this.enSubtitle,
    required this.zhSections,
    required this.enSections,
  });

  final ComplianceDocumentKind kind;
  final String zhTitle;
  final String enTitle;
  final String zhSubtitle;
  final String enSubtitle;
  final List<ComplianceSection> zhSections;
  final List<ComplianceSection> enSections;

  String title({required bool isChinese}) => isChinese ? zhTitle : enTitle;

  String subtitle({required bool isChinese}) {
    return isChinese ? zhSubtitle : enSubtitle;
  }

  List<ComplianceSection> sections({required bool isChinese}) {
    return isChinese ? zhSections : enSections;
  }
}

class ComplianceSection {
  const ComplianceSection({
    required this.title,
    required this.body,
    this.actionValue,
  });

  final String title;
  final String body;
  final String? actionValue;
}

const complianceDocuments = <ComplianceDocument>[
  ComplianceDocument(
    kind: ComplianceDocumentKind.privacy,
    zhTitle: '隐私政策',
    enTitle: 'Privacy Policy',
    zhSubtitle: '说明音频、字幕、记录、支付和日志如何处理。',
    enSubtitle: 'How audio, subtitles, records, billing, and logs are handled.',
    zhSections: <ComplianceSection>[
      ComplianceSection(
        title: '我们处理的数据',
        body: '同传时会处理麦克风音频、ASR 字幕、译文、摘要、重点和术语建议。'
            '默认不保存原始音频，历史记录保存文本结果和会话时间。',
      ),
      ComplianceSection(
        title: '数据用途',
        body: '数据仅用于中英同传、通话房间、扫描翻译、历史复盘、用量扣减、'
            '支付核验、故障排查和安全风控。',
      ),
      ComplianceSection(
        title: '存储与删除',
        body: '国内版数据区域：cn。用户可以在记录页删除历史记录。'
            '服务端日志已做脱敏处理，不记录完整手机号、邮箱、原始音频和译文正文。',
      ),
      ComplianceSection(
        title: '第三方处理',
        body: '端侧能力优先在手机本地运行。需要云端模型、支付或通话房间时，'
            '仅调用本页列出的服务商，并按国内版配置路由。',
      ),
    ],
    enSections: <ComplianceSection>[
      ComplianceSection(
        title: 'Data we process',
        body: 'Live translation may process microphone audio, ASR captions, '
            'translations, summaries, highlights, and term suggestions. Raw '
            'audio is not saved by default.',
      ),
      ComplianceSection(
        title: 'Purpose',
        body: 'Data is used for translation, call rooms, scan translation, '
            'history review, usage deduction, payment verification, debugging, '
            'and security controls.',
      ),
      ComplianceSection(
        title: 'Storage and deletion',
        body:
            'Domestic edition data region: cn. Users can delete saved history '
            'from Records. Server logs redact phones, emails, raw audio, and '
            'translation text.',
      ),
      ComplianceSection(
        title: 'Third-party processing',
        body: 'On-device capabilities are preferred. Cloud models, payments, '
            'and call rooms use only the listed providers for the domestic '
            'configuration.',
      ),
    ],
  ),
  ComplianceDocument(
    kind: ComplianceDocumentKind.terms,
    zhTitle: '用户协议',
    enTitle: 'Terms of Service',
    zhSubtitle: '说明服务边界、AI 限制、付费和通话责任。',
    enSubtitle: 'Service scope, AI limits, billing, and call responsibilities.',
    zhSections: <ComplianceSection>[
      ComplianceSection(
        title: '服务范围',
        body: '本产品提供 AI 辅助翻译、转写、摘要、重点和通话房间能力，'
            '不替代人工专业翻译、法律意见、医疗意见或财务建议。',
      ),
      ComplianceSection(
        title: '通话与录音提示',
        body: '用户发起通话、会议或转写前，应确认参与方知晓并同意语音处理、'
            '字幕显示、AI 翻译和记录保存。',
      ),
      ComplianceSection(
        title: '付费与 credits',
        body: '订阅、分钟包和 credits 以服务端 ledger 为准。退款、取消订阅或'
            '支付失败会回滚或冻结对应权益。',
      ),
      ComplianceSection(
        title: 'AI 输出限制',
        body: 'ASR、翻译和摘要可能受口音、噪声、网络、模型能力和领域词影响。'
            '重要场景需要用户自行复核。',
      ),
    ],
    enSections: <ComplianceSection>[
      ComplianceSection(
        title: 'Service scope',
        body: 'The app provides AI-assisted translation, transcription, '
            'summaries, highlights, and call rooms. It does not replace '
            'professional translation or legal, medical, or financial advice.',
      ),
      ComplianceSection(
        title: 'Call and recording notice',
        body: 'Before calls, meetings, or transcription, users should confirm '
            'participants understand and agree to voice processing, captions, '
            'AI translation, and saved records.',
      ),
      ComplianceSection(
        title: 'Billing and credits',
        body: 'Subscriptions, minute packs, and credits are controlled by the '
            'server ledger. Refunds, cancellations, or failed payments revoke '
            'or freeze related benefits.',
      ),
      ComplianceSection(
        title: 'AI output limits',
        body: 'ASR, translation, and summaries can be affected by accent, '
            'noise, network, model quality, and domain terms. Important '
            'content should be reviewed by the user.',
      ),
    ],
  ),
  ComplianceDocument(
    kind: ComplianceDocumentKind.account,
    zhTitle: '客服与账户',
    enTitle: 'Support and Account',
    zhSubtitle: '提供客服、退款、删除账号和隐私反馈入口。',
    enSubtitle: 'Support, refund, account deletion, and privacy feedback.',
    zhSections: <ComplianceSection>[
      ComplianceSection(
        title: '客服入口',
        body: '客服邮箱：support@qkxy.cn。可咨询订阅、credits、同传问题、'
            '通话记录、扫描翻译和故障反馈。发布前该邮箱必须与发布材料清单一致。',
        actionValue: 'support@qkxy.cn',
      ),
      ComplianceSection(
        title: '退款处理',
        body: 'iOS 订阅和 credits 通过 Apple IAP 购买，用户可按 Apple 退款流程申请。'
            '微信支付、支付宝和安卓渠道支付开放后，退款会进入服务端 ledger 回滚权益。',
        actionValue: 'support@qkxy.cn',
      ),
      ComplianceSection(
        title: '删除账号',
        body: '删除账号入口：https://app.qkxy.cn/account/delete。用户也可以先在记录页'
            '删除单次会话；账号删除申请会按法定保留要求处理身份、权益和历史数据。',
        actionValue: 'https://app.qkxy.cn/account/delete',
      ),
      ComplianceSection(
        title: '隐私反馈',
        body: '隐私、权限、模型服务商、SDK 清单或数据处理问题，可通过客服邮箱提交。'
            '涉及安全或隐私的反馈会优先处理并进入发布复核记录。',
        actionValue: 'support@qkxy.cn',
      ),
    ],
    enSections: <ComplianceSection>[
      ComplianceSection(
        title: 'Customer support',
        body: 'Support email: support@qkxy.cn. Users can ask about '
            'subscriptions, credits, live translation, call records, scan '
            'translation, and issue reports. The release build must match the '
            'release materials manifest.',
        actionValue: 'support@qkxy.cn',
      ),
      ComplianceSection(
        title: 'Refunds',
        body: 'iOS subscriptions and credits are purchased through Apple IAP '
            'and follow Apple refund flow. WeChat Pay, Alipay, and Android '
            'channel payments will roll back benefits through the server '
            'ledger after they are opened.',
        actionValue: 'support@qkxy.cn',
      ),
      ComplianceSection(
        title: 'Account deletion',
        body: 'Account deletion URL: https://app.qkxy.cn/account/delete. '
            'Users can also delete individual sessions from Records before '
            'requesting account deletion.',
        actionValue: 'https://app.qkxy.cn/account/delete',
      ),
      ComplianceSection(
        title: 'Privacy feedback',
        body: 'Privacy, permission, model provider, SDK list, or data '
            'processing feedback can be sent to the support email and is '
            'prioritized for release review.',
        actionValue: 'support@qkxy.cn',
      ),
    ],
  ),
  ComplianceDocument(
    kind: ComplianceDocumentKind.providers,
    zhTitle: '第三方 SDK 与模型服务商清单',
    enTitle: 'SDK and Model Providers',
    zhSubtitle: '列出端侧能力、国内模型、支付和通话服务。',
    enSubtitle: 'On-device, domestic model, payment, and call providers.',
    zhSections: <ComplianceSection>[
      ComplianceSection(
        title: '端侧能力',
        body: 'iOS：CoreML/Nemotron ASR、系统翻译、Vision OCR、系统语音朗读。'
            'Android：系统 ASR、ML Kit OCR、系统语音朗读。',
      ),
      ComplianceSection(
        title: '国内模型链路',
        body: 'Qwen LiveTranslate、腾讯 TRTC AI、自部署 SenseVoice + Qwen/LM Studio。'
            'Provider Router 会按国内版配置选择可用链路。',
      ),
      ComplianceSection(
        title: '支付与订阅',
        body: 'iOS 使用 Apple IAP。国内 Android 预留微信支付、支付宝和安卓渠道支付，'
            '未完成真实商户联调前不公开入口。',
      ),
      ComplianceSection(
        title: '通话与分享',
        body: '首发国内版使用 Call Link 通话房间和系统分享。PSTN 拨打手机号默认隐藏或灰度。',
      ),
    ],
    enSections: <ComplianceSection>[
      ComplianceSection(
        title: 'On-device capabilities',
        body: 'iOS: CoreML/Nemotron ASR, system translation, Vision OCR, and '
            'system speech. Android: system ASR, ML Kit OCR, and system speech.',
      ),
      ComplianceSection(
        title: 'Domestic model routes',
        body: 'Qwen LiveTranslate, Tencent TRTC AI, and self-hosted '
            'SenseVoice + Qwen/LM Studio. Provider Router selects routes by '
            'domestic configuration.',
      ),
      ComplianceSection(
        title: 'Payments',
        body: 'iOS uses Apple IAP. Domestic Android reserves WeChat Pay, '
            'Alipay, and channel payments and keeps them hidden until real '
            'merchant testing passes.',
      ),
      ComplianceSection(
        title: 'Calls and sharing',
        body: 'The first domestic release uses Call Link rooms and system '
            'sharing. PSTN dialing is hidden or gated.',
      ),
    ],
  ),
  ComplianceDocument(
    kind: ComplianceDocumentKind.permissions,
    zhTitle: '权限用途说明',
    enTitle: 'Permission Usage',
    zhSubtitle: '说明麦克风、相机、相册和网络权限的触发场景。',
    enSubtitle: 'Why microphone, camera, photos, and network access are used.',
    zhSections: <ComplianceSection>[
      ComplianceSection(
        title: '麦克风',
        body: '仅在用户点击同传、聆听、通话房间或自测时请求，用于实时 ASR 和语音翻译。',
      ),
      ComplianceSection(
        title: '相机与相册',
        body: '仅在用户使用拍照翻译、相册导入或截图识别时请求，用于 OCR 翻译。',
      ),
      ComplianceSection(
        title: '网络',
        body: '用于 API 会话、模型 Provider、Call Link、支付核验、用量同步和历史同步。',
      ),
      ComplianceSection(
        title: '记录删除',
        body: '用户可以在记录页删除已保存会话。删除后，本地历史不再展示该会话。',
      ),
    ],
    enSections: <ComplianceSection>[
      ComplianceSection(
        title: 'Microphone',
        body:
            'Requested only when the user starts live translation, listening, '
            'call rooms, or diagnostics. It is used for realtime ASR and '
            'speech translation.',
      ),
      ComplianceSection(
        title: 'Camera and photos',
        body:
            'Requested only for scan translation, photo import, or screenshot '
            'OCR.',
      ),
      ComplianceSection(
        title: 'Network',
        body: 'Used for API sessions, model providers, Call Link, payment '
            'verification, usage sync, and history sync.',
      ),
      ComplianceSection(
        title: 'Record deletion',
        body: 'Users can delete saved sessions from Records. Deleted local '
            'history no longer appears in the app.',
      ),
    ],
  ),
];

ComplianceDocument complianceDocument(ComplianceDocumentKind kind) {
  return complianceDocuments.firstWhere((document) => document.kind == kind);
}
