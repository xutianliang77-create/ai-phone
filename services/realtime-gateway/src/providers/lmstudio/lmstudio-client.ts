import type { TermbaseTermDto,PublicModelAttemptEvent } from "@translation/contracts";
import {randomUUID} from "node:crypto";
import {googleTranslationRequest,parseGoogleTranslation} from "./google-translation-protocol.js";
import {PublicTranslationError,validatePublicTranslation,abortable,readPublicJson,parsePublicTranslation,publicRequestMetadata,
  type PublicTranslationMetadata} from "./lmstudio-public-protocol.js";

export interface LmStudioClientOptions {
  /** Protocol hardening only, not authorization or qualification. Default preserves 1.0. */
  transportProfile?: "public_compatible"|"public_google";
  google?:{protocol:"gemini"|"vertex";projectId?:string;location?:string;accessToken?:string;quotaProjectId?:string};
  attemptRecorder?:{sessionId:string;leaseId:string;providerId:string;record:(event:PublicModelAttemptEvent)=>Promise<void>};
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  maxTokens?: number;
  reasoningEffort?: string | null;
  extraBody?: Record<string, unknown>;
  fetchFn?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
}

interface LmStudioErrorResponse {
  error?: {
    message?: string;
  };
}

export class LmStudioClient {
  readonly supportsAbort=true as const;
  readonly supportsAttemptContext=true as const;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: LmStudioClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async translate(input: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    terminology?: TermbaseTermDto[];
    signal?:AbortSignal;
    attemptContext?:{segmentId:string;revision:number};
  }) {
    return (await this.translateWithMetadata(input)).text;
  }

  async translateWithMetadata(input:{text:string;sourceLanguage:string;targetLanguage:string;
    terminology?:TermbaseTermDto[];signal?:AbortSignal;attemptContext?:{segmentId:string;revision:number}}):Promise<{text:string;metadata?:PublicTranslationMetadata}> {
    const isPublic=this.options.transportProfile!==undefined,isGoogle=this.options.transportProfile==="public_google";
    if(isPublic)validatePublicTranslation(this.options,input);
    const journal=this.options.attemptRecorder;
    if(journal&&(!isPublic||![journal.sessionId,journal.leaseId,journal.providerId,input.attemptContext?.segmentId].every(v=>typeof v==="string"&&v.trim()===v&&v.length>0&&v.length<=240)||
      !Number.isSafeInteger(input.attemptContext?.revision)||Number(input.attemptContext?.revision)<0))throw new PublicTranslationError("public_attempt_configuration","not_sent");
    if(input.signal?.aborted)throw isPublic?new PublicTranslationError("public_translation_cancelled","not_sent"):new DOMException("Aborted","AbortError");
    const controller = new AbortController();
    const cancel=()=>controller.abort();input.signal?.addEventListener("abort",cancel,{once:true});
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let sent=false;
    let prepared=false,terminalAttempted=false;
    const attempt:PublicModelAttemptEvent|undefined=journal?{sessionId:journal.sessionId,leaseId:journal.leaseId,providerId:journal.providerId,
      modelId:this.options.model,attemptId:randomUUID(),segmentId:input.attemptContext!.segmentId,revision:input.attemptContext!.revision,component:"translation",state:"dispatching"}:undefined;
    const record=async(event:PublicModelAttemptEvent)=>{
      const deadline=new AbortController(),timeout=setTimeout(()=>deadline.abort(),5000);
      try{await abortable(journal!.record(structuredClone(event)),deadline.signal);}finally{clearTimeout(timeout);}
    };
    try {
      const glossary=isPublic?input.terminology?.filter(t=>t.sourceLanguage===input.sourceLanguage&&t.targetLanguage===input.targetLanguage&&t.status==="active"):input.terminology;
      const prompt=(isPublic?`Source language: ${languageName(input.sourceLanguage)}.\n`:"")+buildSystemPrompt(input.targetLanguage,glossary);
      const google=isGoogle?googleTranslationRequest(this.options,prompt,input.text):undefined;
      const body=JSON.stringify(google?.body??{
          model: this.options.model,temperature: 0,max_tokens: this.options.maxTokens ?? 512,
          ...(this.reasoningEffortBody()),...(this.options.extraBody ?? {}),
          ...(isPublic?{stream:false}:{}),
          messages:[{role:"system",content:prompt},
            {role:"user",content:input.text}],
      });
      if(isPublic&&Buffer.byteLength(body)>262144)throw new PublicTranslationError("public_translation_invalid_input","not_sent");
      if(attempt){
        try{await abortable(record(attempt),controller.signal);prepared=true;}catch{throw new PublicTranslationError("public_attempt_record_failed","not_sent");}
      }
      if(controller.signal.aborted)throw new DOMException("Aborted","AbortError");
      sent=true;
      const response = await abortable(this.fetchFn(google?.url??this.chatCompletionsUrl(), {
        method: "POST",
        headers: google?.headers??this.headers(),
        body,
        signal: controller.signal,
        ...(isPublic?{redirect:"error" as const}:{}),
      }),controller.signal);
      if (!response.ok) {
        if(isPublic){void response.body?.cancel().catch(()=>{});
          throw new PublicTranslationError(response.status===429?"public_translation_rate_limited":"public_translation_http_error",
            response.status>=500||response.status===408?"uncertain":"rejected",response.status,publicRequestMetadata(response.headers.get("x-request-id")));}
        throw new Error(`LM Studio returned HTTP ${response.status}: ${await readError(response)}`);
      }
      if(isPublic){
        const result=(isGoogle?parseGoogleTranslation:parsePublicTranslation)(await readPublicJson(response,controller.signal),response.headers.get("x-request-id"));
        if(attempt){terminalAttempted=true;try{await record({...attempt,state:"confirmed",metadata:result.metadata});}catch{throw new PublicTranslationError("public_attempt_record_failed","uncertain");}}
        if(controller.signal.aborted)throw new DOMException("Aborted","AbortError");
        return result;
      }
      const parsed = await abortable(response.json(),controller.signal) as ChatCompletionResponse;
      const message = parsed.choices?.[0]?.message;
      const translation =
        stripThinking(message?.content ?? "") ||
        extractTranslationFromReasoning(message?.reasoning_content ?? "");
      if (!translation) {
        throw new Error("LM Studio returned empty translation after cleaning reasoning output");
      }
      return {text:translation};
    } catch(error){
      if(!isPublic)throw error;
      const failure=error instanceof PublicTranslationError?error:new PublicTranslationError(controller.signal.aborted?(input.signal?.aborted?"public_translation_cancelled":"public_translation_timeout"):
        "public_translation_transport_or_payload_error",sent?"uncertain":"not_sent");
      if(attempt&&prepared&&!terminalAttempted){
        terminalAttempted=true;
        try{await record({...attempt,state:failure.outcome,failureCode:failure.code,...(failure.metadata?{metadata:failure.metadata}:{})});}
        catch{throw new PublicTranslationError("public_attempt_record_failed",sent?"uncertain":"not_sent");}
      }
      throw failure;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort",cancel);
    }
  }

  async healthCheck() {
    // A catalog 200 is not public component qualification. A supplier-specific
    // readiness probe must be wired before the public entry gate can open.
    if(this.options.transportProfile!==undefined)return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(this.modelsUrl(), {
        method: "GET",
        headers: this.headers(),
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private chatCompletionsUrl() {
    if(this.options.transportProfile==="public_compatible"){
      const base=this.options.baseUrl.replace(/\/$/,"");
      if(base.endsWith("/chat/completions"))return base;
      // A configured path is the API prefix, not necessarily /v1. Preserve it.
      return `${base}${new URL(base).pathname==="/"?"/v1":""}/chat/completions`;
    }
    return `${this.normalizedBaseUrl()}/v1/chat/completions`;
  }

  private modelsUrl() {
    return `${this.normalizedBaseUrl()}/v1/models`;
  }

  private normalizedBaseUrl() {
    return this.options.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
    };
  }

  private reasoningEffortBody() {
    if (this.options.reasoningEffort === null) return {};
    return { reasoning_effort: this.options.reasoningEffort ?? "none" };
  }
}

function buildSystemPrompt(
  targetLanguage: string,
  terminology: TermbaseTermDto[] = [],
) {
  const target = languageName(targetLanguage);
  const prompt = [
    `Translate the user's text into ${target}.`,
    "Return only the translation.",
    "Do not explain, annotate, or include markdown.",
  ];
  const terms = terminology
    .filter((term) => term.targetLanguage === targetLanguage)
    .slice(0, 40);
  if (terms.length > 0) {
    prompt.push(
      "Use these glossary translations exactly when the source term appears:",
      ...terms.map((term) => `${term.sourceText} => ${term.translatedText}`),
    );
  }
  return prompt.join("\n");
}

function languageName(code: string) {
  return languageNames[code] ?? code;
}

const languageNames: Record<string, string> = {
  zh: "Simplified Chinese",
  en: "English",
  fr: "French",
  pt: "Portuguese",
  es: "Spanish",
  ja: "Japanese",
  tr: "Turkish",
  ru: "Russian",
  ar: "Arabic",
  ko: "Korean",
  th: "Thai",
  it: "Italian",
  de: "German",
  vi: "Vietnamese",
  ms: "Malay",
  id: "Indonesian",
  tl: "Filipino",
  hi: "Hindi",
  "zh-Hant": "Traditional Chinese",
  pl: "Polish",
  cs: "Czech",
  nl: "Dutch",
  km: "Khmer",
  my: "Burmese",
  fa: "Persian",
  gu: "Gujarati",
  ur: "Urdu",
  te: "Telugu",
  mr: "Marathi",
  he: "Hebrew",
  bn: "Bengali",
  ta: "Tamil",
  uk: "Ukrainian",
  bo: "Tibetan",
  kk: "Kazakh",
  mn: "Mongolian",
  ug: "Uyghur",
  yue: "Cantonese",
};

function stripThinking(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractTranslationFromReasoning(content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

  for (const line of lines.reverse()) {
    if (isReasoningLabel(line)) continue;
    const cleaned = line.replace(/\bcw$/i, "").trim();
    if (cleaned.length > 0 && cleaned.length <= 300) return cleaned;
  }
  return "";
}

function isReasoningLabel(line: string) {
  return /^(analy[sz]e|request|task|constraints?|translate|combine|format|check|review|final|decision|output|simplified chinese|english|yes|no\b|input text)/i.test(line) ||
    line.includes(":");
}

async function readError(response: Response) {
  try {
    const body = await response.json() as LmStudioErrorResponse;
    return body.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
