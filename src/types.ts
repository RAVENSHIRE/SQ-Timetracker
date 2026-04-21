export type UserRole = 'manager' | 'employee';

export interface UserProfile {
  uid: string;
  email: string;
  username?: string;
  displayName?: string;
  role: UserRole;
  department?: string;
}

export type ShiftType = 'normal' | 'second' | 'special' | 'late';

export interface Shift {
  id: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  date: string; // YYYY-MM-DD
  type: ShiftType;
  startTime: string;
  endTime: string;
  customerCareRole: string;
  status?: 'scheduled' | 'active' | 'complete';
}

export interface BreakPlan {
  id: string;
  date: string; // YYYY-MM-DD
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  breakStartTime: string;
  breakEndTime: string;
  lastModified: string;
  originalTime?: string; // For showing changes
  reason?: string;
}

export interface SwapRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  receiverId: string;
  receiverUid?: string;
  receiverName: string;
  shiftId: string;
  shiftDate?: string;
  shiftTime?: string;
  shiftType?: ShiftType;
  targetShiftDate?: string;
  targetShiftTime?: string;
  targetShiftType?: ShiftType;
  type: 'shift' | 'break';
  status: 'pending' | 'accepted' | 'approved' | 'rejected' | 'completed';
  createdAt: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success';
  read: boolean;
  createdAt: string;
}
