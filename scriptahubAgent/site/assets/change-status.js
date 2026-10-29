const processingLabels = {
  queued: 'Pending', running: 'Executing', stop_requested: 'Stopping',
  completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
};
const decisionLabels = {open: 'Awaiting approval', accepted: 'Approved', rejected: 'Rejected'};

export function currentChangeStatus(change) {
  if (change.state === 'accepted' && Object.hasOwn(processingLabels, change.processing?.state)) {
    return {state: change.processing.state, label: processingLabels[change.processing.state], updatedAt: change.processing.updatedAt};
  }
  return {state: change.state, label: decisionLabels[change.state], updatedAt: change.decided_at || change.created_at};
}
