import test from 'node:test';
import assert from 'node:assert/strict';
import {currentChangeStatus} from '../site/assets/change-status.js';

test('processing status replaces approval on every refreshed change', () => {
  const change={state:'accepted',decided_at:'2026-10-28T16:09:40Z'};
  for(const [state,label] of Object.entries({queued:'Pending',running:'Executing',stop_requested:'Stopping',completed:'Completed',failed:'Failed',cancelled:'Cancelled'})) {
    assert.deepEqual(currentChangeStatus({...change,processing:{state,updatedAt:'2026-10-28T16:11:57Z'}}),{state,label,updatedAt:'2026-10-28T16:11:57Z'});
  }
  assert.equal(currentChangeStatus(change).label,'Approved');
});
test('unapproved and rejected requests retain their decision status', () => {
  assert.equal(currentChangeStatus({state:'open',processing:null}).label,'Awaiting approval');
  assert.equal(currentChangeStatus({state:'rejected',processing:{state:'running'}}).label,'Rejected');
});
