import { MaterialIcon } from "./MaterialIcon.js";
import {
  pageStateRegistry,
  type PageState,
} from "../page-state-registry.js";

export type { PageState } from "../page-state-registry.js";

export function StatusPanel({
  state,
  title = pageStateRegistry[state].title,
  description,
  traceId,
  action,
}: {
  state: PageState;
  title?: string;
  description: string;
  traceId?: string;
  action?: React.ReactNode;
}) {
  const presentation = pageStateRegistry[state];
  return (
    <section
      className={`status-panel status-panel--${state}`}
      data-page-state={state}
      role={presentation.role}
      aria-live={presentation.live}
    >
      <MaterialIcon name={presentation.icon} label={title} />
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
        {traceId ? (
          <p className="status-panel__trace">
            追踪编号 <code>{traceId}</code>
          </p>
        ) : null}
        {action ? <div className="status-panel__action">{action}</div> : null}
      </div>
    </section>
  );
}
