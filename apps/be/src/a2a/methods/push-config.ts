import { A2A_ERRORS } from '@bw/dto';
import { JsonRpcError } from '../types';
import type { MethodHandler } from '../dispatch';

/**
 * `tasks/pushNotificationConfig/set` (spec §7.5). First cut does not support push
 * notifications (Agent Card advertises pushNotifications:false), so always reject.
 */
export const pushConfigSet: MethodHandler = () => {
  throw new JsonRpcError(A2A_ERRORS.PUSH_NOTIFICATION_NOT_SUPPORTED, 'Push notifications are not supported');
};
