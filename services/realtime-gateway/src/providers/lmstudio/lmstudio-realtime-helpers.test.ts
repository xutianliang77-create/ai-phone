import { describe, expect, it } from "vitest";
import { PublicTranslationError } from "./lmstudio-public-protocol.js";
import { translationFailureDiagnostic } from "./lmstudio-realtime-helpers.js";

describe("translation failure diagnostics", () => {
  it("keeps public failure classification and request metadata without text", () => {
    const diagnostic = translationFailureDiagnostic(new PublicTranslationError(
      "public_translation_http_error",
      "uncertain",
      503,
      { requestId: "request-42", reportedModel: "service:tencent_tmt" },
    ));

    expect(diagnostic).toEqual({
      class: "public_translation",
      code: "public_translation_http_error",
      outcome: "uncertain",
      httpStatus: 503,
      requestId: "request-42",
      reportedModel: "service:tencent_tmt",
    });
  });

  it("does not carry arbitrary error text into diagnostic fields", () => {
    const diagnostic = translationFailureDiagnostic(
      new Error("provider response includes user source text and a secret"),
    );

    expect(diagnostic).toEqual({
      class: "translation_client",
      code: "translation_client_error",
      errorName: "Error",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("source text");
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
  });
});
