import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { androidCandidateInputs, androidCandidateDefines, androidLocalProfile,
  assertAndroidApkIdentity } from "./android_public_candidate_contract.mjs";

const source = {commit:"a".repeat(40),tree:"b".repeat(40)};
const profileHash = "c".repeat(64);
const settings = {
  PUBLIC_ANDROID_APPLICATION_ID:"cn.synthetic.wujie.publicapp",
  PRIVATE_ANDROID_APPLICATION_ID:"cn.synthetic.wujie.privateapp",
  PUBLIC_DEPLOYMENT_ID:"synthetic-public",SERVER_BASE_URL:"https://qa.synthetic.invalid:13522",
  BUILD_NUMBER:"2026092603",PUBLIC_ANDROID_CERT_SHA256:"d".repeat(64),
  AUTOMATIC_LANGUAGE_PAIR:"zh,en",
};
const input = overrides => androidCandidateInputs({...settings,...overrides},source,{...androidLocalProfile},profileHash);

describe("Android public candidate contracts (no device or provider claims)", () => {
  it("pins the complete Android profile without changing iOS or enabling model downloads", () => {
    const profile = JSON.parse(readFileSync(new URL("../../release/public/1.1.0/android-device-development.json", import.meta.url)));
    expect(profile).toEqual(androidLocalProfile);
    const config = androidCandidateInputs(settings,source,profile,profileHash);
    const defines = androidCandidateDefines(config);
    expect(defines).toMatchObject({PUBLIC_DEPLOYMENT_ID:"synthetic-public",
      WUJIE_PRODUCT_PROFILE:"full",SOURCE_STATE:"clean",ANDROID_LOCAL_PROFILE_SHA256:profileHash});
    expect(config).toMatchObject({buildMode:"release",abi:"arm64-v8a",version:"1.1.0"});
    expect(Object.keys(defines).some(key => /PASSWORD|SECRET|TOKEN/.test(key))).toBe(false);
  });
  it.each(Object.keys(androidLocalProfile))("refuses an omitted or incorrect local define: %s", key => {
    const profile = {...androidLocalProfile};
    delete profile[key];
    expect(() => androidCandidateInputs(settings,source,profile,profileHash)).toThrow("profile mismatch");
    profile[key] = "wrong";
    expect(() => androidCandidateInputs(settings,source,profile,profileHash)).toThrow("profile mismatch");
  });
  it.each([undefined,"com.example.translation_mobile","com.yourcompany.app","com.wujieai.androidtest",
    settings.PRIVATE_ANDROID_APPLICATION_ID])("refuses missing/private/test applicationId: %s", applicationId => {
    expect(() => input({PUBLIC_ANDROID_APPLICATION_ID:applicationId})).toThrow();
  });
  it.each(["http://qa.synthetic.invalid","https://127.0.0.1:3100","https://localhost",
    "https://user:password@qa.synthetic.invalid","https://qa.synthetic.invalid?token=secret"])(
    "refuses insecure/non-device/credential-bearing server URL: %s", url => {
      expect(() => input({SERVER_BASE_URL:url})).toThrow();
    });
  it("rejects incomplete language, version, build, source and signer identity", () => {
    for (const override of [{APP_VERSION:"1.0.0"},{BUILD_NUMBER:"0"},{BUILD_NUMBER:"2100000001"},
      {PUBLIC_ANDROID_CERT_SHA256:""},{PUBLIC_DEPLOYMENT_ID:""},{AUTOMATIC_LANGUAGE_PAIR:"zh,zh"},
      {AUTOMATIC_LANGUAGE_PAIR:"en,ja"},{PRODUCT_PROFILE:"core_translation"}]) {
      expect(() => input(override)).toThrow();
    }
    expect(() => androidCandidateInputs(settings,{...source,commit:"untraceable"},androidLocalProfile,profileHash)).toThrow();
  });
  it("binds inspected APK identity, native source metadata and one approved signer", () => {
    const config = input({});
    expect(() => assertAndroidApkIdentity(config, actualApk(config))).not.toThrow();
    for (const override of [{applicationId:settings.PRIVATE_ANDROID_APPLICATION_ID},
      {versionName:"1.0.0"},{versionCode:"1"},{debuggable:"true"},
      {signerOutput:"Signer #1 certificate SHA-256 digest: " + "e".repeat(64)},
      {signerOutput:actualApk(config).signerOutput + "\nSigner #1 certificate DN: CN=Android Debug"}]) {
      expect(() => assertAndroidApkIdentity(config,{...actualApk(config),...override})).toThrow();
    }
    const actual = actualApk(config);
    expect(() => assertAndroidApkIdentity(config,{...actual,
      manifestXml:actual.manifestXml.replace(config.sourceCommit,"e".repeat(40))})).toThrow("metadata mismatch");
  });
  it("keeps private signing separate, embeds actual defines, and writes no new key", () => {
    const gradle = readFileSync(new URL("../../apps/mobile/android/app/build.gradle.kts", import.meta.url), "utf8");
    const script = readFileSync(new URL("../build_traceable_android_candidate.mjs", import.meta.url), "utf8");
    expect(gradle).toContain('System.getenv("PUBLIC_ANDROID_KEY_PROPERTIES") ?: "public-key.properties"');
    expect(gradle).toContain('candidateFile.canonicalFile != rootProject.file("key.properties").canonicalFile');
    expect(gradle).toContain('project.findProperty("dart-defines")');
    expect(gradle).toContain('candidateDefines["BUILD_NUMBER"] == versionCode.toString()');
    expect(gradle).toContain('else releaseString("applicationId", "com.example.translation_mobile")');
    expect(script).toContain('"--config-only"');
    expect(script).toContain('"--no-pub"');
    expect(script).toContain('"--porcelain=v1", "--untracked-files=all"');
    expect(script).toContain('constants.COPYFILE_EXCL');
    expect(script).toContain('"verify", "--verbose", "--print-certs"');
    expect(script).not.toMatch(/\badb\b|\bkeytool\b|\bcurl\b|--storepass|--keypass/);
    expect(script.indexOf('"--config-only"')).toBeLessThan(script.indexOf('execute(flutter, buildArgs'));
  });
});

function actualApk(config) {
  const metadata = {WujieCandidateId:config.candidateId,WujieSourceCommit:config.sourceCommit,
    WujieSourceTree:config.sourceTree,WujieSourceState:"clean",WujieProductProfile:"full",
    WujieDeploymentId:config.deploymentId,WujieLocalProfileSha256:config.profileSha256};
  return {
    applicationId:config.applicationId,versionName:config.version,versionCode:config.buildNumber,debuggable:"false",
    manifestXml:'<manifest><application><activity android:name="com.example.translation_mobile.MainActivity" />' +
      Object.entries(metadata).map(([name,value]) => `<meta-data android:value="${value}" android:name="${name}" />`).join("") +
      '</application></manifest>',
    signerOutput:`Signer #1 certificate SHA-256 digest: ${config.signerSha256}`,
  };
}
