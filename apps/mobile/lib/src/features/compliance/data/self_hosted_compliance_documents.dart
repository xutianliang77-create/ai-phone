part of 'compliance_document.dart';

const selfHostedPrivacyVersion = 'wujie-v10-privacy-r1';
const selfHostedTermsVersion = 'wujie-v10-terms-r1';
const selfHostedComplianceDocuments = <ComplianceDocument>[
  ComplianceDocument(
    kind: ComplianceDocumentKind.privacy,
    zhTitle: '隐私政策',
    enTitle: 'Privacy Policy',
    zhSubtitle: '无界 AI 1.0：账号、在线翻译与记录的数据处理。',
    enSubtitle: 'Wujie AI 1.0 account, online processing and records.',
    zhSections: [
      ComplianceSection(
        title: '服务提供者',
        body: '本服务由北京乾坤祥云科技有限公司提供。客服邮箱：1397343951@qq.com。',
        actionValue: '1397343951@qq.com',
      ),
      ComplianceSection(
        title: '账号验证',
        body:
            'Apple 验证你的身份。账号、设备证明、协议同意记录和用量由无界 AI 在 Cloudflare 的独立控制服务处理，用于登录安全、授权与结算；不会收集你的 Apple 密码。手机不包含模型供应商密钥。',
      ),
      ComplianceSection(
        title: '语音与文字处理',
        body:
            '在线同传会将必要的麦克风音频、原文、译文及相关上下文发送到无界 AI 原有处理服务，完成识别、翻译和开启的朗读。Cloudflare 负责授权控制；如使用其网络入口，传输流量也会经过该入口。手机负责采音和播放。默认不保存原始音频，文本历史保存在处理服务并按功能设置保留。',
      ),
      ComplianceSection(
        title: '扫描与记录',
        body: '扫描使用你选择的图片完成文字识别；翻译文字按所用功能处理。历史、导出和删除由你主动操作；账号导出与注销入口在账号页。',
      ),
      ComplianceSection(
        title: '保存、删除与安全',
        body:
            '必要的用量和账务证据与一般记录分别处理。注销先停止账号使用并撤销登录；未结会话和需要保留的证据按实际处理状态保留。账号、音频和文字的处理范围与正式发行说明保持一致。',
      ),
    ],
    enSections: [
      ComplianceSection(
        title: 'Operator',
        body:
            'Beijing Qiankun Xiangyun Technology Co., Ltd. provides this service. Contact: 1397343951@qq.com.',
        actionValue: '1397343951@qq.com',
      ),
      ComplianceSection(
        title: 'Account verification',
        body:
            'Apple verifies your identity. Our independent Cloudflare control service processes account identity, device proofs, agreements and usage for authentication, authorization and settlement. We do not collect your Apple password. The app contains no model supplier key.',
      ),
      ComplianceSection(
        title: 'Voice and text',
        body:
            'Online translation sends necessary audio, text and context to our retained processing service for recognition, translation and readout. Cloudflare controls authorization and, if used as a network ingress, also carries the encrypted transport. The phone captures and plays audio. Raw audio is not retained by default. Text history remains in the processing service.',
      ),
      ComplianceSection(
        title: 'Records and deletion',
        body:
            'You control scan selection, history export and deletion. Account export and deletion are available in Account. Necessary accounting evidence and unsettled sessions follow their applicable retention and completion rules.',
      ),
    ],
  ),
  ComplianceDocument(
    kind: ComplianceDocumentKind.terms,
    zhTitle: '用户协议',
    enTitle: 'Terms of Service',
    zhSubtitle: '中英在线翻译、使用时长与服务边界。',
    enSubtitle: 'Chinese/English online translation, usage and service limits.',
    zhSections: [
      ComplianceSection(
        title: '服务范围',
        body: '本版提供中英识别、翻译、朗读及已开放的扫描、历史功能。使用在线语音前，请确保相关参与方知晓并同意。',
      ),
      ComplianceSection(
        title: '时长与结束',
        body: '可用时长以服务端记录为准。会话结束、网络中断和重复提交按同一会话核对用量，未确认的停止状态可能需要进一步核对。',
      ),
      ComplianceSection(
        title: '购买与输出',
        body: '本次首发范围不开放购买。AI 识别和译文会受噪声、口音、网络和领域内容影响，重要信息需复核。',
      ),
    ],
    enSections: [
      ComplianceSection(
        title: 'Scope',
        body:
            'This edition provides Chinese/English recognition, translation and readout, plus enabled scanning and history. Ensure participants understand and consent before voice processing.',
      ),
      ComplianceSection(
        title: 'Usage and stopping',
        body:
            'Server records determine available time. Completion, disconnections and repeated submissions are reconciled per session. Unconfirmed stops remain subject to reconciliation.',
      ),
      ComplianceSection(
        title: 'Purchases and output',
        body:
            'Purchases are not enabled for this initial release. Noise, accent, connectivity and domain content can affect AI output. Review important information.',
      ),
    ],
  ),
  ComplianceDocument(
    kind: ComplianceDocumentKind.account,
    zhTitle: '客服与账户',
    enTitle: 'Support and Account',
    zhSubtitle: '账号与个人数据操作。',
    enSubtitle: 'Account and personal data controls.',
    zhSections: [
      ComplianceSection(
        title: '客服',
        body: '客服邮箱：1397343951@qq.com。',
        actionValue: '1397343951@qq.com',
      ),
      ComplianceSection(
        title: '账号操作',
        body: '在账号页通过 Apple 登录、退出、导出个人数据或申请注销。注销状态与必要的上游撤销确认分别显示，不把退出登录当作完成注销。',
      ),
    ],
    enSections: [
      ComplianceSection(
        title: 'Support',
        body: 'Contact 1397343951@qq.com.',
        actionValue: '1397343951@qq.com',
      ),
      ComplianceSection(
        title: 'Account controls',
        body:
            'Sign in with Apple, sign out, export personal data or request deletion in Account. Deletion and upstream revocation have distinct completion states.',
      ),
    ],
  ),
  ComplianceDocument(
    kind: ComplianceDocumentKind.providers,
    zhTitle: '处理服务',
    enTitle: 'Processing Services',
    zhSubtitle: '识别、翻译与朗读的处理方式。',
    enSubtitle: 'How recognition, translation and readout are processed.',
    zhSections: [
      ComplianceSection(
        title: '在线处理',
        body: '1.0沿用原有服务端识别、Hy-MT2翻译和VoxCPM2朗读链路。账号与用量由无界 AI 服务端管理。',
      ),
      ComplianceSection(
        title: 'Apple',
        body: 'Apple 负责身份确认及你授权的系统能力。这里不提供离线翻译或不经服务端的在线语音承诺。',
      ),
    ],
    enSections: [
      ComplianceSection(
        title: 'Online processing',
        body:
            'Version 1.0 retains its server-side recognition, Hy-MT2 translation and VoxCPM2 readout. Our server manages accounts and usage.',
      ),
      ComplianceSection(
        title: 'Apple',
        body:
            'Apple provides identity verification and authorized system capabilities. This edition makes no offline translation promise.',
      ),
    ],
  ),
  ComplianceDocument(
    kind: ComplianceDocumentKind.permissions,
    zhTitle: '权限说明',
    enTitle: 'Permissions',
    zhSubtitle: '仅在所需功能中请求权限。',
    enSubtitle: 'Permissions are requested for relevant features.',
    zhSections: [
      ComplianceSection(title: '麦克风', body: '同传采音使用麦克风。停止、退出或授权失效时停止本机会话。'),
      ComplianceSection(
        title: '图片与导出',
        body: '扫描使用你选择的相机或图片；导出仅写出你选择的记录，不自动发送给他人。',
      ),
    ],
    enSections: [
      ComplianceSection(
        title: 'Microphone',
        body:
            'Live translation uses the microphone. Local capture stops when the session stops or its account authorization becomes invalid.',
      ),
      ComplianceSection(
        title: 'Images and export',
        body:
            'Scanning uses selected camera or photo inputs. Export writes selected records without automatically sending them to others.',
      ),
    ],
  ),
];
