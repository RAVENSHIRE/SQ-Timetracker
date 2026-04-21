export type UserRole = 'manager' | 'employee';


export interface FairnessCounters {
  totalShifts: number;
  earlyCount: number;
  lateCount: number;
  specialCount: number;
  afternoonCount: number;
  lastUpdated: string; // ISO timestamp
}

export interface UserProfile {
  uid: string;
  email: string;
  username?: string;
  displayName?: string;
  role: UserRole;
  department?: string;
  fairness?: FairnessCounters;
}

export type ShiftType = 'normal' | 'second' | 'special' | 'afternoon' | 'late' | 'sick' | 'holiday' | 'military';

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
  activeSwapId?: string | null;
}

export interface SwapRequest {
  id: string;
  requesterUid: string;  // uid of requester
  requesterId: string;   // kept for backwards compat (also uid)
  requesterName: string;
  receiverId: string;
  receiverUid: string;
  receiverName: string;
  shiftId: string;
  shiftDate?: string;
  shiftTime?: string;
  shiftType?: ShiftType;
  targetShiftId?: string | null;   // Firestore doc ID of shiftB
  targetShiftDate?: string | null;
  targetShiftTime?: string | null;
  targetShiftType?: ShiftType | null;
  type: 'shift';
  status: 'pending' | 'accepted' | 'approved' | 'rejected' | 'completed';
  createdAt: string;
  completedAt?: string;
}

export interface BreakPlan {
  id: string;
  date: string; // YYYY-MM-DD
  employeeId: string;
  employeeUid: string;
  employeeName?: string;
  breakStartTime: string;
  breakEndTime: string;
  lastModified?: string;
  originalTime?: string;
  reason?: string;
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
