import { ShiftType } from './types';

export interface ShiftDefinition {
  type: ShiftType;
  label: string;
  startTime: string;
  endTime: string;
  breaks: { start: string; end: string; label: string }[];
}

export const SHIFT_DEFINITIONS: Record<ShiftType, ShiftDefinition> = {
  normal: {
    type: 'normal',
    label: 'Normal Shift',
    startTime: '08:00',
    endTime: '17:30',
    breaks: [
      { start: '10:00', end: '10:15', label: 'Morning Break' },
      { start: '12:00', end: '13:00', label: 'Lunch Break' },
      { start: '15:30', end: '15:45', label: 'Afternoon Break' }
    ]
  },
  second: {
    type: 'second',
    label: 'Second Shift',
    startTime: '08:45',
    endTime: '18:15',
    breaks: [
      { start: '10:45', end: '11:00', label: 'Morning Break' },
      { start: '13:00', end: '14:00', label: 'Lunch Break' },
      { start: '16:00', end: '16:15', label: 'Afternoon Break' }
    ]
  },
  special: {
    type: 'special',
    label: 'Special Shift',
    startTime: '09:00',
    endTime: '18:30',
    breaks: [
      { start: '11:00', end: '11:15', label: 'Morning Break' },
      { start: '13:30', end: '14:30', label: 'Lunch Break' },
      { start: '16:30', end: '16:45', label: 'Afternoon Break' }
    ]
  },
  afternoon: {
    type: 'afternoon',
    label: 'Afternoon Shift',
    startTime: '13:30',
    endTime: '22:00',
    breaks: [
      { start: '16:30', end: '17:15', label: 'Main Break' },
      { start: '19:30', end: '19:45', label: 'Evening Break' }
    ]
  },
  late: {
    type: 'late',
    label: 'Late Shift (11:30)',
    startTime: '11:30',
    endTime: '22:00',
    breaks: [
      { start: '14:30', end: '15:15', label: 'Main Break' },
      { start: '18:00', end: '18:15', label: 'Evening Break' }
    ]
  },
  sick: {
    type: 'sick',
    label: 'Sick Leave',
    startTime: '08:00',
    endTime: '17:00',
    breaks: [
      { start: '12:00', end: '13:00', label: 'Lunch Break' }
    ]
  },
  holiday: {
    type: 'holiday',
    label: 'Holiday',
    startTime: '08:00',
    endTime: '17:00',
    breaks: [
      { start: '12:00', end: '13:00', label: 'Lunch Break' }
    ]
  },
  military: {
    type: 'military',
    label: 'Military Reserve',
    startTime: '08:00',
    endTime: '17:00',
    breaks: [
      { start: '12:00', end: '13:00', label: 'Lunch Break' }
    ]
  }
};
