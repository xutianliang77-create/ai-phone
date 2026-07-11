export interface ReleaseMaterialsManifest {
  accountDeletionUrl?: string;
  androidPackageId?: string;
  androidScreenshots?: string[];
  appIcpFiling?: string;
  appName?: string;
  appStoreChinaReady?: boolean;
  bundleId?: string;
  customerSupportEmail?: string;
  grayReleasePlan?: string;
  initialGrayPercent?: number;
  keywords?: string[];
  legalEntity?: string;
  modelProviderList?: string[];
  privacyLabelsCompleted?: boolean;
  privacyPolicyUrl?: string;
  releaseOwner?: string;
  refundPolicyUrl?: string;
  rollbackPlan?: string;
  sdkList?: string[];
  shortDescription?: string;
  userAgreementUrl?: string;
  versionName?: string;
  iphoneScreenshots?: string[];
  iosChinaScreenshots?: string[];
  iosScreenshots?: string[];
}

export const DOMESTIC_BASELINES: Array<
  [keyof ReleaseMaterialsManifest, string, string]
> = [
  ["bundleId", "iOS bundle id", "cn.qkxy.realtimeinterpreter"],
  ["androidPackageId", "Android package id", "cn.qkxy.realtimeinterpreter"],
  ["legalEntity", "legal entity", "北京乾坤祥云科技有限公司"],
  ["customerSupportEmail", "customer support", "support@qkxy.cn"],
  ["privacyPolicyUrl", "privacy policy url", "https://app.qkxy.cn/privacy"],
  ["userAgreementUrl", "user agreement url", "https://app.qkxy.cn/terms"],
  ["refundPolicyUrl", "refund policy url", "https://app.qkxy.cn/refund"],
  [
    "accountDeletionUrl",
    "account deletion url",
    "https://app.qkxy.cn/account/delete",
  ],
];

export const MIN_SCREENSHOT_COUNT = 3;

export const RELEASE_MATERIALS_CHECKED_ITEMS = [
  "app_identity",
  "legal_entity",
  "app_icp_filing",
  "privacy_policy",
  "user_agreement",
  "sdk_list",
  "model_provider_list",
  "privacy_labels",
  "ios_screenshots",
  "android_screenshots",
  "customer_support",
  "refund_policy",
  "account_deletion",
  "rollback_plan",
  "gray_release_plan",
  "domestic_baseline_alignment",
];
