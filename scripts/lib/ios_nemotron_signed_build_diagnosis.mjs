export function signedBuildDiagnosis(content) {
  const issues = [];
  const actions = [];
  if (
    content.includes(
      "Your team has no devices from which to generate a provisioning profile",
    )
  ) {
    issues.push(
      "Apple Team has no registered devices for provisioning profile generation.",
    );
    actions.push(
      "Connect, unlock, and trust the iPhone so Xcode can register it with the Apple Team.",
    );
  }
  const profileMatch = content.match(/No profiles for '([^']+)' were found/);
  if (profileMatch) {
    issues.push(
      `No iOS App Development provisioning profile matches ${profileMatch[1]}.`,
    );
    actions.push(
      `Open apps/mobile/ios/Runner.xcworkspace in Xcode and let Automatic Signing create a profile for ${profileMatch[1]}.`,
    );
  }
  if (content.includes("Communication with Apple failed")) {
    issues.push("Xcode could not complete Apple Developer portal provisioning.");
    actions.push(
      "Confirm the Apple ID/team is signed in in Xcode and has permission to create development profiles.",
    );
  }
  return { issues, actions };
}
