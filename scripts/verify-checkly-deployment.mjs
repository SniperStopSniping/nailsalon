import { execFileSync } from 'node:child_process';

import {
  isTrustedProductionDeployment,
  isValidDeploymentSha,
} from '../src/libs/checklyTrust.mjs';

const { CHECKLY_DEPLOYMENT_STATE, CHECKLY_DEPLOYMENT_ENVIRONMENT, CHECKLY_DEPLOYMENT_SHA } = process.env;

if (!isValidDeploymentSha(CHECKLY_DEPLOYMENT_SHA)) {
  throw new Error('Refusing Checkly credentials: deployment SHA is not a full commit SHA.');
}

let commitExists = false;
let isMainAncestor = false;
try {
  execFileSync('git', ['cat-file', '-e', `${CHECKLY_DEPLOYMENT_SHA}^{commit}`], {
    stdio: 'ignore',
  });
  commitExists = true;
  execFileSync('git', ['merge-base', '--is-ancestor', CHECKLY_DEPLOYMENT_SHA, 'origin/main'], {
    stdio: 'ignore',
  });
  isMainAncestor = true;
} catch {
  // The fixed, non-secret message deliberately omits event-provided content.
}

if (!commitExists || !isTrustedProductionDeployment({
  state: CHECKLY_DEPLOYMENT_STATE,
  environment: CHECKLY_DEPLOYMENT_ENVIRONMENT,
  sha: CHECKLY_DEPLOYMENT_SHA,
  isMainAncestor,
})) {
  throw new Error('Refusing Checkly credentials: deployment is not a successful Production commit from main.');
}
