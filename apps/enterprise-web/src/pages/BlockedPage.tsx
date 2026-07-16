import { useAuth } from "../auth/AuthContext.js";
import { StatusPanel } from "../components/StatusPanel.js";

export function BlockedPage({ message }: { message: string }) {
  const { logout } = useAuth();
  return (
    <main className="gate-layout">
      <StatusPanel
        state="forbidden"
        title="无法进入企业工作区"
        description={message}
        action={
          <button className="button button--secondary" onClick={() => void logout()}>
            退出登录
          </button>
        }
      />
    </main>
  );
}
