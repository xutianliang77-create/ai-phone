import { describe, expect, it } from "vitest";
import { redactLogObject, redactLogString } from "./log-redaction.js";

describe("log redaction", () => {
  it("redacts transcript text, audio data, and credentials by field name", () => {
    const result = redactLogObject({
      sourceText: "你好，我的手机号是 13800138000",
      translatedText: "hello",
      data: "AA==",
      token: "secret-token",
      nested: {
        signedTransactionInfo: "apple-jws",
        apiKey: "provider-key",
      },
    });

    expect(result).toEqual({
      sourceText: "[REDACTED]",
      translatedText: "[REDACTED]",
      data: "[REDACTED]",
      token: "[REDACTED]",
      nested: {
        signedTransactionInfo: "[REDACTED]",
        apiKey: "[REDACTED]",
      },
    });
  });

  it("redacts phone numbers and email addresses inside ordinary log strings", () => {
    const result = redactLogObject({
      message: "call +1 415-555-2671, 13800138000, or user@example.com",
      signed_payload: "apple-server-notification",
      translated_text: "private translation",
      targetPhone: "+1 415-555-2671",
    });

    expect(result).toEqual({
      message: "call [REDACTED], [REDACTED], or [REDACTED]",
      signed_payload: "[REDACTED]",
      translated_text: "[REDACTED]",
      targetPhone: "[REDACTED]",
    });
  });

  it("redacts standalone strings and leaves non-plain objects serializable", () => {
    class RequestLike {
      method = "GET";
      url = "/call?phone=13800138000";
    }

    expect(redactLogString("email user@example.com")).toBe("email [REDACTED]");
    expect(redactLogString("token=abc signedTransactionInfo:apple-jws")).toBe(
      "token=[REDACTED] signedTransactionInfo=[REDACTED]",
    );
    expect(redactLogObject({ req: new RequestLike() }).req).toBeInstanceOf(RequestLike);
  });
});
