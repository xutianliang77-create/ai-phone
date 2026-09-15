import {afterEach,describe,expect,it,vi} from "vitest";
import {PUBLIC_SPEECH_INACTIVITY_TIMEOUT_MS,PublicSpeechInactivityWatchdog} from "./public-speech-inactivity-watchdog.js";

describe("public speech inactivity watchdog",()=>{
  afterEach(()=>vi.useRealTimers());

  it("ends only after five minutes without a confirmed speech result",async()=>{
    vi.useFakeTimers();
    const end=vi.fn(async()=>{});
    const watchdog=new PublicSpeechInactivityWatchdog(end);
    watchdog.start();
    await vi.advanceTimersByTimeAsync(PUBLIC_SPEECH_INACTIVITY_TIMEOUT_MS-1);
    expect(end).not.toHaveBeenCalled();
    watchdog.observeSpeech();
    await vi.advanceTimersByTimeAsync(PUBLIC_SPEECH_INACTIVITY_TIMEOUT_MS-1);
    expect(end).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("does not end a paused or closed public session",async()=>{
    vi.useFakeTimers();
    const end=vi.fn(async()=>{});
    const watchdog=new PublicSpeechInactivityWatchdog(end);
    watchdog.start();
    watchdog.pause();
    await vi.advanceTimersByTimeAsync(PUBLIC_SPEECH_INACTIVITY_TIMEOUT_MS);
    expect(end).not.toHaveBeenCalled();
    watchdog.resume();
    watchdog.close();
    await vi.advanceTimersByTimeAsync(PUBLIC_SPEECH_INACTIVITY_TIMEOUT_MS);
    expect(end).not.toHaveBeenCalled();
  });

  it("rejects an invalid inactivity duration",()=>{
    expect(()=>new PublicSpeechInactivityWatchdog(async()=>{},0)).toThrow("public_speech_inactivity_timeout_invalid");
  });
});
