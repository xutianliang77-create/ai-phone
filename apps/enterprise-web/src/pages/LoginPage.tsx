import { type FormEvent, useState } from "react";
import { EnterpriseApiError } from "../api/enterprise-api.js";
import { useAuth } from "../auth/AuthContext.js";

export function LoginPage() {
  const { login, requestCode } = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [requestingCode, setRequestingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function handleRequestCode() {
    setRequestingCode(true);
    setError("");
    setNotice("");
    try {
      const result = await requestCode(phone);
      const localCode = import.meta.env.DEV && result.debugCode
        ? ` 开发环境验证码：${result.debugCode}` : "";
      setNotice(`验证码已发送至 ${result.phoneMasked}。${localCode}`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRequestingCode(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login(phone, code);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-brand" aria-label="无界AI企业版">
        <div className="auth-brand__mark">∞</div>
        <p className="eyebrow">WUJIE AI · ENTERPRISE</p>
        <h1>让多语言业务<br />在同一套企业边界内运行</h1>
        <p>租户隔离、权限控制和服务端真值，是进入每个业务工作区的前提。</p>
      </section>
      <section className="auth-card">
        <p className="eyebrow">企业账号</p>
        <h2>登录无界AI企业版</h2>
        <p className="auth-card__intro">使用已加入企业的手机号登录。</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="phone">手机号</label>
          <div className="code-field">
            <input
              id="phone"
              name="phone"
              autoComplete="tel"
              inputMode="tel"
              pattern="(?:\+86)?1[3-9]\d{9}"
              placeholder="请输入手机号"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
            />
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void handleRequestCode()}
              disabled={requestingCode || !phone.trim()}
            >
              {requestingCode ? "发送中" : "获取验证码"}
            </button>
          </div>
          <label htmlFor="code">验证码</label>
          <input
            id="code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="6 位验证码"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
          {notice ? <p className="form-notice" role="status">{notice}</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button--primary button--full" disabled={submitting}>
            {submitting ? "正在验证企业身份" : "登录企业工作台"}
          </button>
        </form>
        <p className="auth-card__footnote">登录后仍需通过企业成员关系与 scope 校验。</p>
      </section>
    </main>
  );
}

function errorMessage(error: unknown) {
  if (!(error instanceof EnterpriseApiError)) return "服务暂时不可用，请稍后重试。";
  const messages: Record<string, string> = {
    invalid_phone: "请输入有效的中国大陆手机号。",
    invalid_code: "验证码无效或已过期，请重新获取。",
    too_many_login_attempts: "验证码错误次数过多，请稍后重试。",
    account_unavailable: "当前账号不可用，请联系管理员。",
    sms_code_resend_too_soon: "请求过于频繁，请稍后再获取验证码。",
  };
  return messages[error.code] ?? "企业登录失败，请稍后重试。";
}
