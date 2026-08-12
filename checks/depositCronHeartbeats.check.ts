import { HeartbeatCheck } from 'checkly/constructs';

import { emailChannel } from '../checkly.config';

const heartbeatDefaults = {
  activated: true,
  alertChannels: [emailChannel],
  grace: 5,
  graceUnit: 'minutes' as const,
  period: 5,
  periodUnit: 'minutes' as const,
  tags: ['deposits', 'cron-liveness'],
};

export const depositReconcileHeartbeat = new HeartbeatCheck(
  'deposit-reconcile-cron-heartbeat',
  {
    name: 'Deposit reconcile cron heartbeat',
    ...heartbeatDefaults,
  },
);

export const integrationOutboxHeartbeat = new HeartbeatCheck(
  'integration-outbox-cron-heartbeat',
  {
    name: 'Integration outbox cron heartbeat',
    ...heartbeatDefaults,
  },
);
