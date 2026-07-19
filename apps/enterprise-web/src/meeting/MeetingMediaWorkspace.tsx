import { useState, type ReactNode } from "react";
import { MaterialIcon } from "../components/MaterialIcon.js";

type MeetingMediaLayout = "screen" | "balanced" | "captions";

export function MeetingMediaWorkspace(props: {
  screen: ReactNode;
  captions: ReactNode;
}) {
  const [layout, setLayout] = useState<MeetingMediaLayout>("balanced");
  return <section className={`meeting-media-workspace layout--${layout}`}
    aria-label="会议画面与字幕布局">
    <header className="meeting-media-workspace__toolbar">
      <div><MaterialIcon name="dashboard_customize" outlined />
        <span><strong>会议视图</strong><small>共享画面和实时字幕始终保留。</small></span></div>
      <div className="meeting-media-workspace__choices" role="group" aria-label="布局模式">
        <LayoutButton active={layout === "screen"} icon="slideshow" label="画面优先"
          select={() => setLayout("screen")} />
        <LayoutButton active={layout === "balanced"} icon="view_sidebar" label="并排"
          select={() => setLayout("balanced")} />
        <LayoutButton active={layout === "captions"} icon="subtitles" label="字幕优先"
          select={() => setLayout("captions")} />
      </div>
    </header>
    <div className="meeting-media-workspace__content">
      <div className="meeting-media-workspace__screen">{props.screen}</div>
      <div className="meeting-media-workspace__captions">{props.captions}</div>
    </div>
  </section>;
}

function LayoutButton(props: {
  active: boolean;
  icon: string;
  label: string;
  select(): void;
}) {
  return <button className={props.active ? "is-selected" : ""} type="button"
    aria-pressed={props.active} onClick={props.select}>
    <MaterialIcon name={props.icon} outlined={!props.active} />{props.label}
  </button>;
}
