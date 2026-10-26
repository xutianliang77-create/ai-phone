part of 'compliance_document.dart';

const onDevicePrivacyVersion = 'wujie-v10-device-privacy-r1';
const onDeviceTermsVersion = 'wujie-v10-device-terms-r1';
const onDeviceComplianceDocuments = <ComplianceDocument>[
  ComplianceDocument(
    kind: ComplianceDocumentKind.privacy,
    zhTitle: '隐私政策',
    enTitle: 'Privacy Policy',
    zhSubtitle: '无界 AI 1.0：业务内容只在手机处理。',
    enSubtitle: 'Wujie AI 1.0 processes content on your phone.',
    zhSections: [
      ComplianceSection(
        title: '服务提供者',
        body: '北京乾坤祥云科技有限公司提供本服务。客服邮箱：1397343951@qq.com。',
        actionValue: '1397343951@qq.com',
      ),
      ComplianceSection(
        title: '手机处理',
        body:
            '语音识别、翻译、系统朗读和图片文字识别在手机上运行。音频、图片、原文、译文与历史内容不会发送到模型供应商、自有模型服务器或Cloudflare。历史和导出保存在本机；主动分享的副本由你选择去向。',
      ),
      ComplianceSection(
        title: '账号和订阅',
        body:
            'Apple验证身份并处理订阅付款。Cloudflare仅处理账号标识、设备证明、协议记录、已签名订阅证据、权益期限、本机短许可及必要的非内容统计与账务证据。我们不收集Apple密码，不把业务内容写入授权日志。',
      ),
      ComplianceSection(
        title: '资源与网络',
        body: '首次准备系统语言资源、登录、购买或核对授权需要联网。系统资源由iOS管理。业务运行不回退到线上模型；资源缺失时提示准备。',
      ),
      ComplianceSection(
        title: '数据权利',
        body:
            '在账号页导出控制面个人信息和本机记录，或申请注销；历史可单独导出和删除。账号注销与Apple自动续订取消是两个操作，注销不自动取消Apple订阅。必要账务证据按适用要求保留。本机原有未归属账号的旧记录保留在独立入口，不自动绑定到新账号。',
      ),
    ],
    enSections: [
      ComplianceSection(
        title: 'Operator',
        body:
            'Beijing Qiankun Xiangyun Technology Co., Ltd. Contact: 1397343951@qq.com.',
        actionValue: '1397343951@qq.com',
      ),
      ComplianceSection(
        title: 'On-device content',
        body:
            'Recognition, translation, readout and OCR run on your phone. Audio, images, source text, translations and history are not uploaded to model vendors, our model servers or Cloudflare. You control exported copies and sharing.',
      ),
      ComplianceSection(
        title: 'Account and billing',
        body:
            'Apple verifies identity and handles subscription payments. Cloudflare processes identity, device proofs, agreements, signed subscription evidence, entitlement periods, short licenses and necessary non-content statistics and accounting evidence. We do not collect Apple passwords.',
      ),
      ComplianceSection(
        title: 'Resources and rights',
        body:
            'Initial OS language setup, account and subscription checks require network access. Missing resources never trigger cloud inference. Export or delete records locally; request account deletion in Account. Account deletion does not cancel Apple subscriptions. Unowned legacy records remain separate.',
      ),
    ],
  ),
  ComplianceDocument(
    kind: ComplianceDocumentKind.terms,
    zhTitle: '用户协议',
    enTitle: 'Terms of Service',
    zhSubtitle: '7天试用，之后人民币10元/月自动续订。',
    enSubtitle: '7-day trial, then CNY10 per month, automatically renewed.',
    zhSections: [
      ComplianceSection(
        title: '服务范围',
        body:
            '本版在受支持的iPhone和iOS上提供中英本机识别、翻译、朗读、扫描和记录。请尊重相关参与方的隐私与同意。噪声、口音、领域和设备性能会影响结果，重要内容应复核。',
      ),
      ComplianceSection(
        title: '订阅与试用',
        body:
            '先经Apple确认自动续期月订阅，符合Apple优惠资格者享连续7天免费试用，之后按人民币10元/月自动续费，除非提前取消。不具备试用资格者只有明确确认正常月费后才购买。实际价格、起止、扣款和续订以Apple确认及验证交易为准；不重复发放试用。',
      ),
      ComplianceSection(
        title: '取消、退款与恢复',
        body:
            '可在iOS设置的Apple订阅管理中取消续订；取消通常保留当前有效期。退款由Apple处理，已验证撤销或到期会停止新的业务使用。提供恢复购买和未完成交易同步，未知购买状态不要求重复付款。注销本App账号不会替代取消Apple订阅。',
      ),
      ComplianceSection(
        title: '离线授权',
        body:
            '每次联网取得最长30分钟本机短许可，并截短到订阅或登录等更早到期时间。改时钟、暂停或重试不延长原许可。短许可到期需联网更新；套餐到期可购买或恢复订阅。断网期间临时撤销最迟在短许可截止或重新联网核对时生效。到期不删除或扣住已保存记录。',
      ),
    ],
    enSections: [
      ComplianceSection(
        title: 'Scope',
        body:
            'Chinese/English recognition, translation, speech, OCR and records run on supported iPhones and iOS. Respect participants and review important output.',
      ),
      ComplianceSection(
        title: 'Subscription',
        body:
            'Confirm an Apple auto-renewable monthly subscription first. Eligible customers receive 7 continuous free days, then CNY10/month unless cancelled. Ineligible customers must explicitly agree to the normal monthly price. Verified Apple transactions determine prices and periods; no duplicate trials are issued.',
      ),
      ComplianceSection(
        title: 'Manage and restore',
        body:
            'Manage cancellation in Apple subscription settings and refunds through Apple. Cancellation retains the existing valid period unless revoked. Restore or synchronize purchases without paying twice. Deleting your app account does not cancel your Apple subscription.',
      ),
      ComplianceSection(
        title: 'Offline license',
        body:
            'An online check issues at most 30 minutes, clipped to earlier entitlement or authentication expiry. Pausing, retrying and changing the clock do not extend it. Temporary revocations reach an offline device upon reconnection or license expiry. Saved content remains available for export.',
      ),
    ],
  ),
  ComplianceDocument(
    kind: ComplianceDocumentKind.account,
    zhTitle: '客服与账户',
    enTitle: 'Support and Account',
    zhSubtitle: '登录、导出、注销与订阅管理。',
    enSubtitle: 'Account, export, deletion and subscription controls.',
    zhSections: [
      ComplianceSection(
        title: '客服',
        body: '1397343951@qq.com',
        actionValue: '1397343951@qq.com',
      ),
      ComplianceSection(
        title: '操作入口',
        body:
            '账号页提供Apple登录、退出、个人信息副本及注销。订阅页提供实际状态、恢复和同步购买。Apple订阅管理：https://apps.apple.com/account/subscriptions',
      ),
    ],
    enSections: [
      ComplianceSection(
        title: 'Support',
        body: '1397343951@qq.com',
        actionValue: '1397343951@qq.com',
      ),
      ComplianceSection(
        title: 'Controls',
        body:
            'Use Account for identity and personal data, and Subscription for status and purchase recovery. Manage Apple subscriptions at https://apps.apple.com/account/subscriptions',
      ),
    ],
  ),
  ComplianceDocument(
    kind: ComplianceDocumentKind.providers,
    zhTitle: '处理方式',
    enTitle: 'Processing',
    zhSubtitle: '业务在手机，Cloudflare仅控制面。',
    enSubtitle: 'Content stays on-device; Cloudflare is control-only.',
    zhSections: [
      ComplianceSection(
        title: '本机组件',
        body:
            'Apple SpeechTranscriber识别、iOS系统翻译、系统TTS和Vision OCR。所需系统语言资源须真实就绪；本版不使用云端模型或自有模型服务器。自动语种切换尚未合格，请手动选中文或英文。',
      ),
      ComplianceSection(
        title: '控制服务',
        body: 'Cloudflare处理账号、设备、订阅与短许可，不接收业务内容。Apple处理身份、系统能力和经你确认的订阅。',
      ),
    ],
    enSections: [
      ComplianceSection(
        title: 'On-device components',
        body:
            'Apple SpeechTranscriber, iOS Translation, system TTS and Vision OCR. OS resources must be installed. No cloud or self-hosted model server is used. Select Chinese or English explicitly; automatic speech-language switching is not qualified.',
      ),
      ComplianceSection(
        title: 'Control plane',
        body:
            'Cloudflare handles accounts, devices, subscriptions and short licenses without business content. Apple handles identity, OS capabilities and confirmed subscriptions.',
      ),
    ],
  ),
  ComplianceDocument(
    kind: ComplianceDocumentKind.permissions,
    zhTitle: '权限说明',
    enTitle: 'Permissions',
    zhSubtitle: '按功能请求，拒绝后不回退到云端。',
    enSubtitle: 'Requested per feature, with no cloud fallback.',
    zhSections: [
      ComplianceSection(
        title: '麦克风与识别',
        body: '同传请求麦克风和系统语音识别权限。停止或许可失效时停止采集、翻译和播放。',
      ),
      ComplianceSection(
        title: '图片与导出',
        body: '扫描使用你选择的相机或图片；导出写到本机并由你主动分享。语言资源准备需你明确操作，不在开始业务时暗中下载。',
      ),
    ],
    enSections: [
      ComplianceSection(
        title: 'Speech',
        body:
            'Live translation requests microphone and speech permissions. Stopping or authorization expiry stops capture, translation and playback.',
      ),
      ComplianceSection(
        title: 'Images and exports',
        body:
            'Scanning uses selected camera or photo inputs. Exports stay local until you share them. Language-resource preparation requires an explicit action.',
      ),
    ],
  ),
];
