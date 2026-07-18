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
  return (
    <main className="page-frame">
      <header className="page-heading">
        <div><h1>{title}</h1><p>{description}</p></div>
        {action ? <div className="page-heading__action">{action}</div> : null}
      </header>
      <div className="page-content">{children}</div>
    </main>
  );
}
