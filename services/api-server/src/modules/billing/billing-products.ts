import type { PlanCode } from "../plans/plans.service.js";
import type { PaymentProvider } from "./billing-records.js";

export interface BillingProduct {
  productId: string;
  kind: "plan" | "credits";
  displayName: string;
  description: string;
  priceCny: number;
  creditsSeconds: number;
  planCode?: PlanCode;
  providers: PaymentProvider[];
}

const products: BillingProduct[] = [
  {
    productId: "domestic_pro_monthly",
    kind: "plan",
    displayName: "Pro 月卡",
    description: "同传 100 小时、历史不限、导出、AI 摘要",
    priceCny: 38,
    creditsSeconds: 6000,
    planCode: "pro",
    providers: ["apple_iap", "wechat_pay", "alipay"],
  },
  {
    productId: "domestic_plus_monthly",
    kind: "plan",
    displayName: "Plus 月卡",
    description: "同传 500 小时、术语库、高质量模型和通话房间",
    priceCny: 98,
    creditsSeconds: 30000,
    planCode: "premium",
    providers: ["apple_iap", "wechat_pay", "alipay"],
  },
  {
    productId: "domestic_credits_60m",
    kind: "credits",
    displayName: "60 分钟包",
    description: "适合通话房间、云端高质量模型、AI Agent 灰度",
    priceCny: 18,
    creditsSeconds: 3600,
    providers: ["apple_iap", "wechat_pay", "alipay"],
  },
  {
    productId: "domestic_credits_300m",
    kind: "credits",
    displayName: "300 分钟包",
    description: "适合外贸会议、课堂和长时间 Listening Mode",
    priceCny: 68,
    creditsSeconds: 18000,
    providers: ["apple_iap", "wechat_pay", "alipay"],
  },
];

export function listBillingProducts() {
  return products;
}

export function findBillingProduct(productId: string) {
  return products.find((product) => product.productId === productId) ?? null;
}
