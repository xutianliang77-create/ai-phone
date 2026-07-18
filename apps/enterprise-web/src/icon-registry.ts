const iconPair = (name: string) => ({ outlined: name, filled: name } as const);

export const enterpriseIcons = {
  navigation: {
    dashboard: iconPair("dashboard"),
    campaigns: iconPair("campaign"),
    support: iconPair("support_agent"),
    meetings: iconPair("groups"),
    contacts: iconPair("contacts"),
    knowledge: iconPair("menu_book"),
    analytics: iconPair("query_stats"),
    audit: iconPair("policy"),
    settings: iconPair("settings"),
  },
  action: {
    create: "add",
    search: "search",
    filter: "filter_alt",
    refresh: "refresh",
    import: "upload_file",
    export: "download",
    more: "more_horiz",
    approve: "verified_user",
    takeover: "pan_tool_alt",
    shareScreen: "screen_share",
    stopShare: "stop_screen_share",
    publish: "publish",
    review: "fact_check",
    version: "history",
    edit: "edit",
  },
  member: {
    person: "person",
    role: "admin_panel_settings",
  },
  content: {
    source: "description",
    terms: "translate",
    script: "record_voice_over",
  },
  status: {
    loading: "autorenew",
    empty: "inbox",
    not_ready: "construction",
    degraded: "warning",
    forbidden: "lock",
    conflict: "sync_problem",
    processing: "pending",
    failed: "error_outline",
  },
} as const;

export type EnterpriseNavigationIcon = keyof typeof enterpriseIcons.navigation;
