export interface Plan {
  code: "free" | "pro" | "premium";
  displayName: string;
  monthlySeconds: number;
  exportEnabled: boolean;
  termbaseEnabled: boolean;
  summaryEnabled: boolean;
}
