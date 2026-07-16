import { type FormEvent, useState } from "react";
import type { EnterpriseMembershipDto } from "@translation/contracts";
import { useAuth } from "../auth/AuthContext.js";

export function TenantPickerPage({ tenants }: { tenants: EnterpriseMembershipDto[] }) {
  const { selectTenant, logout } = useAuth();
  const [selected, setSelected] = useState(tenants[0]?.tenant.id ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (selected) void selectTenant(selected);
  }

  return (
    <main className="gate-layout">
      <section className="gate-card">
        <p className="eyebrow">选择企业</p>
        <h1>进入一个企业工作区</h1>
        <p>这里只列出当前账号有效的企业成员关系。</p>
        <form onSubmit={submit} className="tenant-list">
          {tenants.map(({ tenant, member }) => (
            <label className="tenant-option" key={tenant.id}>
              <input
                type="radio"
                name="tenant"
                value={tenant.id}
                checked={selected === tenant.id}
                onChange={() => setSelected(tenant.id)}
              />
              <span>
                <strong>{tenant.name}</strong>
                <small>{member.role} · {tenant.homeRegion} · {tenant.planCode}</small>
              </span>
            </label>
          ))}
          <button className="button button--primary button--full" disabled={!selected}>
            进入所选企业
          </button>
        </form>
        <button className="text-button" onClick={() => void logout()}>退出登录</button>
      </section>
    </main>
  );
}
