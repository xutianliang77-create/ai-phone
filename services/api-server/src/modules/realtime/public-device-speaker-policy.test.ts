import {afterEach,describe,it,expect,vi} from "vitest";
import {deviceSpeakerProfile} from "@translation/contracts";
import {publicDeviceSpeakerCapability,publicSpeakerSelectionAllowed} from "./public-device-speaker-policy.js";
import {validateCreateRealtimeSessionRequest} from "./create-session-request.js";
const selection={mode:"diarization" as const,deviceProfile:deviceSpeakerProfile.id,maxSpeakers:4 as const,allowVoiceIdentity:false};
afterEach(()=>vi.unstubAllEnvs());
describe("anonymous phone speaker public admission",()=>{
  it("honors an explicit off override and never changes original off admission",()=>{
    vi.stubEnv("PUBLIC_DEVICE_SPEAKER_ENABLED","");expect(publicSpeakerSelectionAllowed(selection)).toBe(false);
    expect(publicDeviceSpeakerCapability().available).toBe(false);expect(publicSpeakerSelectionAllowed({mode:"off"})).toBe(true);
  });
  it("offers the anonymous local profile by default while still requiring the exact selection",()=>{
    vi.stubEnv("PUBLIC_DEVICE_SPEAKER_ENABLED",undefined);
    expect(publicDeviceSpeakerCapability().available).toBe(true);
    expect(publicSpeakerSelectionAllowed(selection)).toBe(true);
    expect(publicSpeakerSelectionAllowed({mode:"auto"})).toBe(false);
  });
  it("accepts only the exact ready-device profile, not server models or identity",()=>{
    vi.stubEnv("PUBLIC_DEVICE_SPEAKER_ENABLED","true");expect(publicSpeakerSelectionAllowed(selection)).toBe(true);
    for(const bad of [{...selection,allowVoiceIdentity:true},{...selection,maxSpeakers:2 as const},
      {...selection,deviceProfile:"arbitrary"},{mode:"auto" as const}]) expect(publicSpeakerSelectionAllowed(bad)).toBe(false);
  });
  it("preserves the selected profile through the existing request parser",()=>{
    const parsed=validateCreateRealtimeSessionRequest({mode:"meeting",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,speakerAttribution:selection});
    expect(parsed).toMatchObject({ok:true,value:{speakerAttribution:selection}});
    expect(validateCreateRealtimeSessionRequest({mode:"meeting",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,
      speakerAttribution:{...selection,allowVoiceIdentity:true}}).ok).toBe(false);
  });
});
