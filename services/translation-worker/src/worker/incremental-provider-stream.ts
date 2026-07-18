import type {
  CallTranslationProvider,
} from "./types.js";

export async function translateIncrementally(
  provider: CallTranslationProvider,
  input: Parameters<CallTranslationProvider["translate"]>[0],
  callbacks: { onFirstToken: () => void; onRestart: () => void },
) {
  if (!provider.translateStream) throw new Error("Translation stream is unavailable");
  let finalText = "";
  for await (const event of provider.translateStream(input)) {
    if (input.signal.aborted) {
      throw input.signal.reason ?? new Error("Translation aborted");
    }
    if (event.type === "restart") {
      finalText = "";
      callbacks.onRestart();
      continue;
    }
    if (event.text.trim()) callbacks.onFirstToken();
    if (event.type === "final") finalText = event.text;
  }
  if (!finalText.trim()) throw new Error("Translation stream returned no final text");
  return finalText;
}
