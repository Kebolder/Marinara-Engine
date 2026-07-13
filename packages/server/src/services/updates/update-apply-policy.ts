/**
 * Ordinary in-app updates remain opt-in. A deliberate release-channel switch
 * from a loopback browser is allowed because the channel selector is itself the
 * local user's explicit request to change the checkout.
 */
export function isGitUpdateApplyAllowed(options: {
  updatesApplyEnabled: boolean;
  localChannelSwitchRequested: boolean;
}): boolean {
  return options.updatesApplyEnabled || options.localChannelSwitchRequested;
}
