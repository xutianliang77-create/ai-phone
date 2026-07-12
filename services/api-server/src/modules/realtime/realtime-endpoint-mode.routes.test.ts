import { expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { verifyRealtimeToken } from "./realtime-token.js";

it("maps meeting sessions to the listening ASR endpoint policy", async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/realtime/sessions",
    payload: {
      mode: "meeting",
      sourceLanguage: "auto",
      targetLanguage: "zh",
      voiceOutput: false,
    },
  });
  await app.close();

  expect(verifyRealtimeToken(
    response.json().realtimeToken,
    "dev-secret",
  )).toMatchObject({ mode: "meeting", asrEndpointMode: "listening" });
});
