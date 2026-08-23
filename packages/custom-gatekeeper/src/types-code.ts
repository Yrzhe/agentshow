// Generated from types.d.ts by scripts/gatekeeper-types.ts. Do not edit by hand: run
//   node scripts/gatekeeper-types.ts --write
//
// `getTypeScriptTypes()` returns this at runtime, where the declaration file no longer
// exists. gatekeeper-types.test.ts fails when the two disagree.

const TYPES_CODE = `/** Information supplied by the organization operating this CloudflareOS deployment. */
export interface CustomDeploymentInfo {
  name: string;
  message: string;
}

/** Example read-only capability provided to the CloudflareOS agent. */
export interface CustomSession {
  /** Returns the deployment's example information after recording an observation. */
  getDeploymentInfo(): Promise<CustomDeploymentInfo>;
}
`;

export default TYPES_CODE;
