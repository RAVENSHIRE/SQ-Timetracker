import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  getDocs,
} from 'firebase/firestore';

const PROJECT_ID = 'sq-timetracker-rules-test';
const rules = readFileSync('firestore.rules', 'utf8');

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules },
});

const employeeAuth = {
  email: 'j.doe@shiftplanner.local',
  email_verified: true,
};

const receiverAuth = {
  email: 'm.rossi@shiftplanner.local',
  email_verified: true,
};

const managerAuth = {
  email: 'manager@shiftplanner.local',
  email_verified: true,
};

const bootstrapAuth = {
  email: 'j.krayenbuehl@gmail.com',
  email_verified: true,
};

const nowIso = '2026-04-21T08:00:00.000Z';

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  await setDoc(doc(db, 'users/mgr-1'), {
    uid: 'mgr-1',
    email: 'manager@shiftplanner.local',
    role: 'manager',
    displayName: 'Manager',
  });

  await setDoc(doc(db, 'users/emp-1'), {
    uid: 'emp-1',
    email: 'j.doe@shiftplanner.local',
    role: 'employee',
    displayName: 'Employee One',
  });

  await setDoc(doc(db, 'users/emp-2'), {
    uid: 'emp-2',
    email: 'm.rossi@shiftplanner.local',
    role: 'employee',
    displayName: 'Employee Two',
  });

  await setDoc(doc(db, 'swaps/swap-1'), {
    requesterId: 'emp-1',
    requesterName: 'Employee One',
    receiverId: 'm.rossi@shiftplanner.local',
    receiverUid: 'emp-2',
    receiverName: 'Employee Two',
    shiftId: 'shift-1',
    shiftDate: '2026-04-22',
    shiftTime: '08:00-17:00',
    shiftType: 'normal',
    targetShiftDate: null,
    targetShiftTime: null,
    targetShiftType: null,
    type: 'shift',
    status: 'pending',
    createdAt: nowIso,
  });

  await setDoc(doc(db, 'notifications/n1'), {
    userId: 'emp-1',
    title: 'Hello',
    message: 'Test',
    type: 'info',
    read: false,
    createdAt: nowIso,
  });
});

const employeeDb = testEnv.authenticatedContext('emp-1', employeeAuth).firestore();
const receiverDb = testEnv.authenticatedContext('emp-2', receiverAuth).firestore();
const managerDb = testEnv.authenticatedContext('mgr-1', managerAuth).firestore();
const bootstrapDb = testEnv.authenticatedContext('bootstrap-1', bootstrapAuth).firestore();

// Employee can read shifts but cannot create shifts.
await assertFails(
  setDoc(doc(employeeDb, 'shifts/shift-x'), {
    employeeId: 'j.doe@shiftplanner.local',
    employeeUid: 'emp-1',
    employeeName: 'Employee One',
    date: '2026-04-25',
    type: 'normal',
    startTime: '08:00',
    endTime: '17:00',
    customerCareRole: 'Support',
    status: 'scheduled',
  })
);

// Manager can create shifts.
await assertSucceeds(
  setDoc(doc(managerDb, 'shifts/shift-allowed'), {
    employeeId: 'j.doe@shiftplanner.local',
    employeeUid: 'emp-1',
    employeeName: 'Employee One',
    date: '2026-04-25',
    type: 'normal',
    startTime: '08:00',
    endTime: '17:00',
    customerCareRole: 'Support',
    status: 'scheduled',
  })
);

// Employee can create own swap request.
await assertSucceeds(
  setDoc(doc(employeeDb, 'swaps/swap-emp-create'), {
    requesterId: 'emp-1',
    requesterName: 'Employee One',
    receiverId: 'm.rossi@shiftplanner.local',
    receiverUid: 'emp-2',
    receiverName: 'Employee Two',
    shiftId: 'shift-allowed',
    shiftDate: '2026-04-25',
    shiftTime: '08:00-17:00',
    shiftType: 'normal',
    targetShiftDate: null,
    targetShiftTime: null,
    targetShiftType: null,
    type: 'shift',
    status: 'pending',
    createdAt: nowIso,
  })
);

// Employee cannot spoof requesterId in create.
await assertFails(
  setDoc(doc(employeeDb, 'swaps/swap-spoof'), {
    requesterId: 'emp-2',
    requesterName: 'Employee Two',
    receiverId: 'm.rossi@shiftplanner.local',
    receiverUid: 'emp-2',
    receiverName: 'Employee Two',
    shiftId: 'shift-allowed',
    shiftDate: '2026-04-25',
    shiftTime: '08:00-17:00',
    shiftType: 'normal',
    targetShiftDate: null,
    targetShiftTime: null,
    targetShiftType: null,
    type: 'shift',
    status: 'pending',
    createdAt: nowIso,
  })
);

// Receiver can accept pending swap by status-only update.
await assertSucceeds(updateDoc(doc(receiverDb, 'swaps/swap-1'), { status: 'accepted' }));

// Requester cannot modify swap status directly.
await assertFails(updateDoc(doc(employeeDb, 'swaps/swap-1'), { status: 'rejected' }));

// Manager can move accepted swap to completed.
await assertSucceeds(updateDoc(doc(managerDb, 'swaps/swap-1'), { status: 'completed' }));

// Employee can only mark own notification read.
await assertSucceeds(updateDoc(doc(employeeDb, 'notifications/n1'), { read: true }));
await assertFails(updateDoc(doc(employeeDb, 'notifications/n1'), { title: 'Tamper' }));

// Manager can create notifications.
await assertSucceeds(
  setDoc(doc(managerDb, 'notifications/n2'), {
    userId: 'emp-2',
    title: 'Swap Approved',
    message: 'Your swap was approved.',
    type: 'success',
    read: false,
    createdAt: nowIso,
  })
);

// Bootstrap admin email path should also have manager-like permissions.
await assertSucceeds(
  setDoc(doc(bootstrapDb, 'shifts/shift-bootstrap'), {
    employeeId: 'j.doe@shiftplanner.local',
    employeeUid: 'emp-1',
    employeeName: 'Employee One',
    date: '2026-04-26',
    type: 'second',
    startTime: '08:45',
    endTime: '17:45',
    customerCareRole: 'Support',
    status: 'scheduled',
  })
);

// Quick read assertion to ensure valid query path for participants.
const participantQuery = query(collection(employeeDb, 'swaps'), where('requesterId', '==', 'emp-1'));
const participantSnap = await assertSucceeds(getDocs(participantQuery));
assert.ok(participantSnap.size >= 1, 'Expected employee participant query to return records.');

await assertSucceeds(getDoc(doc(employeeDb, 'notifications/n1')));

await testEnv.cleanup();
console.log('Firestore rules tests passed for employee/manager scenarios.');