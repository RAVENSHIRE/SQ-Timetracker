/**
 * Validation Service
 * 
 * Business logic validation for shifts, swaps, and schedules.
 * Enforces company rules and constraints.
 */

import { Shift, ShiftType, SwapRequest } from '../types';
import { SHIFT_DEFINITIONS } from '../constants';
import { firestoreService } from './firestore-service';
import { addDays, subDays, format } from 'date-fns';

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

class ValidationService {
  /**
   * Shift Validation Rules:
   * 1. After a late shift, the next shift must be special
   * 2. Late shifts can only be traded for late or special shifts
   */

  async validateShiftPlacement(
    employeeId: string,
    date: string,
    type: ShiftType
  ): Promise<ValidationResult> {
    try {
      // Rule: After late shift, next must be special
      const yesterday = format(subDays(new Date(date), 1), 'yyyy-MM-dd');
      const yesterdayShifts = await firestoreService.getEmployeeShifts(employeeId);
      const wasYesterdayLate = yesterdayShifts.some(
        s => s.date === yesterday && s.type === 'late'
      );

      if (wasYesterdayLate && type !== 'special') {
        return {
          valid: false,
          message: 'After a Late shift, the next shift must be Special. Rule violation.'
        };
      }

      // Rule: If assigning late shift, tomorrow must be special (or have none)
      if (type === 'late') {
        const tomorrow = format(addDays(new Date(date), 1), 'yyyy-MM-dd');
        const tomorrowShifts = await firestoreService.getEmployeeShifts(employeeId);
        const hasTomorrowShift = tomorrowShifts.some(s => s.date === tomorrow);

        if (hasTomorrowShift) {
          const tomorrowType = tomorrowShifts.find(s => s.date === tomorrow)?.type;
          if (tomorrowType !== 'special') {
            return {
              valid: false,
              message: 'Late shifts require the following day to be Special or free.'
            };
          }
        }
      }

      return { valid: true };
    } catch (error) {
      throw new Error(`Validation error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  /**
   * Swap Validation:
   * 1. Requester must have the shift they're offering
   * 2. Receiver must have the shift they're offering (if target shift selected)
   * 3. Late shifts can only be swapped for late/special shifts
   * 4. No double-booking (employee can't have 2 shifts same day)
   */

  async validateSwapRequest(swap: Omit<SwapRequest, 'id' | 'createdAt'>): Promise<ValidationResult> {
    try {
      // Get both employees' shifts
      const requesterShifts = await firestoreService.getMyShifts(swap.requesterId);
      const receiverShifts = await firestoreService.getEmployeeShifts(swap.receiverId);

      // Verify requester owns the shift they're offering
      const requesterShift = requesterShifts.find(s => s.id === swap.shiftId);
      if (!requesterShift) {
        return { valid: false, message: 'You do not own this shift.' };
      }

      // If this is a two-way swap, verify receiver has target shift
      if (swap.targetShiftDate && swap.targetShiftDate.length > 0) {
        const receiverTargetShift = receiverShifts.find(
          s => s.date === swap.targetShiftDate && s.type === swap.targetShiftType
        );
        if (!receiverTargetShift) {
          return {
            valid: false,
            message: 'Target employee does not have the shift you want to exchange for.'
          };
        }

        // Rule: Late shifts can only be traded for late/special
        if (requesterShift.type === 'late') {
          if (receiverTargetShift.type !== 'late' && receiverTargetShift.type !== 'special') {
            return {
              valid: false,
              message: 'Late shifts can only be traded for Late or Special shifts.'
            };
          }
        }
      }

      // Check for double-booking after swap
      const requesterNewDate = swap.targetShiftDate || requesterShift.date;
      const wouldDoubleBook = requesterShifts.some(
        s => s.date === requesterNewDate && s.id !== swap.shiftId
      );
      if (wouldDoubleBook) {
        return {
          valid: false,
          message: 'You already have a shift on that date.'
        };
      }

      return { valid: true };
    } catch (error) {
      throw new Error(`Swap validation error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  /**
   * Check if shift type is valid
   */

  isValidShiftType(type: string): type is ShiftType {
    return ['normal', 'second', 'special', 'late'].includes(type);
  }

  /**
   * Get allowed target shift types for trading
   */

  getAllowedSwapTargets(sourceType: ShiftType): ShiftType[] {
    if (sourceType === 'late') {
      return ['late', 'special'];
    }
    return ['normal', 'second', 'special', 'late'];
  }

  /**
   * Validate time format (HH:MM)
   */

  isValidTimeFormat(time: string): boolean {
    return /^\d{2}:\d{2}$/.test(time);
  }

  /**
   * Validate date format (YYYY-MM-DD)
   */

  isValidDateFormat(date: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(date);
  }
}

export const validationService = new ValidationService();
