/** Keep API persistence available until Gateway/Workers have finished their
 * original stop protocol. A timeout still forces exit and is never a PASS. */
export async function stopApplicationChildren(children, {
  dependentGraceMs = 12_000, apiGraceMs = 2_000,
} = {}) {
  const snapshot = [...children.entries()];
  const dependent = snapshot.filter(([name]) => name !== "api").map(([, child]) => child);
  const api = snapshot.filter(([name]) => name === "api").map(([, child]) => child);
  const forcedDependent = await stopGroup(dependent, dependentGraceMs);
  const forcedApi = await stopGroup(api, apiGraceMs);
  return { forced: forcedDependent || forcedApi,
    failed: snapshot.some(([, child]) => child.exitCode !== null && child.exitCode !== 0) };
}

async function stopGroup(children, timeoutMs) {
  const alive = () => children.filter(child => child.exitCode === null && child.signalCode === null);
  const pending = alive();
  if (!pending.length) return false;
  const exits = pending.map(child => new Promise(resolve => child.once("exit", resolve)));
  for (const child of pending) child.kill("SIGTERM");
  let timer;
  try {
    await Promise.race([Promise.all(exits),new Promise(resolve => { timer=setTimeout(resolve,timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
  const remaining = alive();
  for (const child of remaining) child.kill("SIGKILL");
  return remaining.length > 0;
}
