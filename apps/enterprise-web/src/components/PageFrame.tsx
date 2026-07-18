import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

export function PageFrame({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const frame = useRef<HTMLElement>(null);
  useEffect(() => { frame.current?.focus(); }, [location.pathname]);
  return (
    <main className="page-frame" id="enterprise-main" ref={frame} tabIndex={-1}>
      <header className="page-heading">
        <div><h1>{title}</h1><p>{description}</p></div>
        {action ? <div className="page-heading__action">{action}</div> : null}
      </header>
      <div className="page-content">{children}</div>
    </main>
  );
}
