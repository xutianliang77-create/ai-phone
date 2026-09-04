export async function startWithReplyAuthorizationPaused<TOptions>(
  session: {
    start(options: TOptions): Promise<unknown>;
    pauseReplyAuthorization(): void;
  },
  options: TOptions,
) {
  await session.start(options);
  session.pauseReplyAuthorization();
}
