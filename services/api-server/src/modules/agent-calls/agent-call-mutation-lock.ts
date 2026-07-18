const activeDraftMutations = new Set<string>();

export function tryAcquireAgentCallMutation(draftId: string) {
  if (activeDraftMutations.has(draftId)) return null;
  activeDraftMutations.add(draftId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeDraftMutations.delete(draftId);
  };
}
