// @ts-check

/**
 * Metadata announced by this DoriosLib installation to other addons in the
 * world through `dorios:dependency_checker`.
 *
 * Add dependency requirements to `dependencies` when Better Smelters starts
 * depending on another Dorios addon.
 *
 * @type {import("./dependencies/index.js").AddonMetadata}
 */
export const ADDON_METADATA = {
  name: "Better Smelters",
  author: "Dorios Studios",
  identifier: "better_smelters",
  version: "1.5.0",
  dependencies: {},
};

/** @type {import("./dependencies/index.js").InitializeOptions} */
export const DEPENDENCY_OPTIONS = {
  validationDelayTicks: 300,
  announceSuccess: false,
};
