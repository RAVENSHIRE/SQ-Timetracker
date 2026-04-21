import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, writeBatch, where, getDocs } from 'firebase/firestore';
import { UserProfile, UserRole, AppNotification, Shift, BreakPlan, SwapRequest, ShiftType } from '../types';
import { SHIFT_DEFINITIONS } from '../constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Trash2, Upload, Calendar as CalendarIcon, Clock, Users, Bell, Check, X, FileSpreadsheet, AlertTriangle, Lock, ShieldCheck, ArrowLeftRight } from 'lucide-react';
import { format, addDays, subDays } from 'date-fns';

interface ManagerDashboardProps {
  profile: UserProfile;
  notifications: AppNotification[];
}

type ViewType = 'shifts' | 'breaks' | 'swaps' | 'team';

const parseCsvRow = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

const parseCsv = (csvText: string): Array<Record<string, string>> => {
  const lines = csvText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvRow(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
};

const getValue = (row: Record<string, string>, aliases: string[]): string | undefined => {
  const normalized = Object.entries(row).reduce<Record<string, string>>((acc, [key, value]) => {
    acc[key.trim().toLowerCase()] = value;
    return acc;
  }, {});

  for (const alias of aliases) {
    const value = normalized[alias.toLowerCase()];
    if (value) return value;
  }

  return undefined;
};

export default function ManagerDashboard({ profile, notifications }: ManagerDashboardProps) {
  const [view, setView] = useState<ViewType>('shifts');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [breakPlans, setBreakPlans] = useState<BreakPlan[]>([]);
  const [employees, setEmployees] = useState<UserProfile[]>([]);
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([]);
  const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false);
  const [isSwapDialogOpen, setIsSwapDialogOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [selectedColleague, setSelectedColleague] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newShift, setNewShift] = useState<Partial<Shift>>({
    date: format(new Date(), 'yyyy-MM-dd'),
    type: 'normal',
    startTime: SHIFT_DEFINITIONS.normal.startTime,
    endTime: SHIFT_DEFINITIONS.normal.endTime,
    customerCareRole: 'Support',
    status: 'scheduled'
  });

  const handleShiftTypeChange = (type: ShiftType) => {
    const def = SHIFT_DEFINITIONS[type];
    setNewShift({
      ...newShift,
      type,
      startTime: def.startTime,
      endTime: def.endTime
    });
  };

  useEffect(() => {
    const unsubShifts = onSnapshot(query(collection(db, 'shifts'), orderBy('date', 'desc')), (s) => {
      setShifts(s.docs.map(d => ({ id: d.id, ...d.data() } as Shift)));
    });
    const unsubBreaks = onSnapshot(query(collection(db, 'breakPlans'), orderBy('date', 'desc')), (s) => {
      setBreakPlans(s.docs.map(d => ({ id: d.id, ...d.data() } as BreakPlan)));
    });
    const unsubSwaps = onSnapshot(query(collection(db, 'swaps'), orderBy('createdAt', 'desc')), (s) => {
      setSwapRequests(s.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest)));
    });
    const unsubEmployees = onSnapshot(collection(db, 'users'), (s) => {
      setEmployees(s.docs.map(d => d.data() as UserProfile));
    });

    return () => {
      unsubShifts();
      unsubBreaks();
      unsubSwaps();
      unsubEmployees();
    };
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const content = String(evt.target?.result ?? '');
        const data = parseCsv(content);

        const batch = writeBatch(db);
        let importedCount = 0;
        let rejectedCount = 0;

        for (const row of data) {
          const email = getValue(row, ['Email', 'employeeId']);
          const name = getValue(row, ['Name', 'employeeName']);
          const date = getValue(row, ['Date']) || format(new Date(), 'yyyy-MM-dd');
          const start = getValue(row, ['Start', 'startTime']);
          
          // Find employee UID from existing system users
          const employee = employees.find(e => 
            (e.email && e.email.toLowerCase() === email?.toLowerCase()) || 
            (e.username && e.username.toLowerCase() === email?.toLowerCase()) ||
            (e.displayName && e.displayName.toLowerCase() === name?.toLowerCase())
          );

          if (!employee) {
            console.warn(`Skipping shift for ${email}: User not found in system.`);
            rejectedCount++;
            continue;
          }

          let shiftType: ShiftType = 'normal';
          if (start === SHIFT_DEFINITIONS.second.startTime) shiftType = 'second';
          else if (start === SHIFT_DEFINITIONS.special.startTime) shiftType = 'special';
          else if (start === SHIFT_DEFINITIONS.late.startTime) shiftType = 'late';

          const { valid, message } = await validateShiftRule(employee.email || employee.username!, date, shiftType);
          
          if (!valid) {
            console.warn(`Skipping invalid shift for ${employee.email} on ${date}: ${message}`);
            rejectedCount++;
            continue;
          }

          const shiftRef = doc(collection(db, 'shifts'));
          batch.set(shiftRef, {
            employeeId: employee.email || employee.username,
            employeeUid: employee.uid,
            employeeName: employee.displayName || employee.username,
            date,
            type: shiftType,
            startTime: start || SHIFT_DEFINITIONS[shiftType].startTime,
            endTime: getValue(row, ['End', 'endTime']) || SHIFT_DEFINITIONS[shiftType].endTime,
            customerCareRole: getValue(row, ['Role', 'customerCareRole']) || 'Support',
            status: 'scheduled'
          });

          const def = SHIFT_DEFINITIONS[shiftType];
          def.breaks.forEach(b => {
            const breakRef = doc(collection(db, 'breakPlans'));
            batch.set(breakRef, {
              date,
              employeeId: employee.email || employee.username,
              employeeUid: employee.uid,
              employeeName: employee.displayName || employee.username,
              breakStartTime: b.start,
              breakEndTime: b.end,
              lastModified: new Date().toISOString(),
              reason: `Imported: ${b.label}`
            });
          });
          
          importedCount++;
        }

        await batch.commit();
        if (rejectedCount > 0) {
          toast.warning(`Imported ${importedCount} shifts. ${rejectedCount} shifts were skipped due to rule violations.`);
        } else {
          toast.success(`Successfully imported ${importedCount} shifts`);
        }
      } catch (error) {
        console.error("CSV parse error:", error);
        toast.error("Failed to parse CSV file. Ensure columns: Name, Email, Date, Start, End, Role");
      }
    };
    reader.readAsText(file);
  };

  const validateShiftRule = async (employeeId: string, dateStr: string, type: ShiftType): Promise<{ valid: boolean; message?: string }> => {
    const date = new Date(dateStr);
    
    // Rule: after one late there must be a special shift following!
    
    // Check if yesterday was a late shift
    const yesterday = format(subDays(date, 1), 'yyyy-MM-dd');
    const yesterdayShifts = await getDocs(query(
      collection(db, 'shifts'), 
      where('employeeId', '==', employeeId), 
      where('date', '==', yesterday)
    ));
    
    const wasYesterdayLate = yesterdayShifts.docs.some(d => d.data().type === 'late');
    if (wasYesterdayLate && type !== 'special') {
      return { 
        valid: false, 
        message: "Rule Violation: The previous day was a Late shift. A Special shift is required today." 
      };
    }

    // Check if today is a late shift, then tomorrow must be special
    if (type === 'late') {
      const tomorrow = format(addDays(date, 1), 'yyyy-MM-dd');
      const tomorrowShifts = await getDocs(query(
        collection(db, 'shifts'), 
        where('employeeId', '==', employeeId), 
        where('date', '==', tomorrow)
      ));
      
      const existsTomorrowNonSpecial = tomorrowShifts.docs.some(d => d.data().type !== 'special');
      if (existsTomorrowNonSpecial) {
        return { 
          valid: false, 
          message: "Rule Violation: Assigning a Late shift today requires the existing Special shift tomorrow." 
        };
      }
    }

    return { valid: true };
  };

  const handleAddShift = async () => {
    if (!newShift.employeeId || !newShift.date || !newShift.type) {
      toast.error("Please fill all required fields");
      return;
    }

    const { valid, message } = await validateShiftRule(newShift.employeeId, newShift.date, newShift.type as ShiftType);
    if (!valid) {
      toast.error(message, { duration: 5000 });
      return;
    }

    try {
      await addDoc(collection(db, 'shifts'), newShift);
      toast.success("Shift added successfully");
      setIsShiftDialogOpen(false);
      
      // Auto-generate breaks for this shift
      const def = SHIFT_DEFINITIONS[newShift.type as ShiftType];
      const batch = writeBatch(db);
      def.breaks.forEach(b => {
        const breakRef = doc(collection(db, 'breakPlans'));
        batch.set(breakRef, {
          date: newShift.date,
          employeeId: newShift.employeeId,
          employeeUid: newShift.employeeUid,
          employeeName: newShift.employeeName,
          breakStartTime: b.start,
          breakEndTime: b.end,
          lastModified: new Date().toISOString(),
          reason: `Automatic: ${b.label}`
        });
      });
      await batch.commit();

    } catch (e) { toast.error("Failed to add shift"); }
  };

  const handleApproveSwap = async (swap: SwapRequest) => {
    try {
      const batch = writeBatch(db);
      
      // Update swap status
      batch.update(doc(db, 'swaps', swap.id), { status: 'completed' });
      
      // Update the shift owner
      batch.update(doc(db, 'shifts', swap.shiftId), { 
        employeeId: swap.receiverId,
        employeeUid: swap.receiverUid || '', 
        employeeName: swap.receiverName 
      });

      // Notify both
      const notifyRef1 = doc(collection(db, 'notifications'));
      batch.set(notifyRef1, {
        userId: swap.requesterId,
        title: "Swap Approved",
        message: `Your swap request for shift ${swap.shiftId} has been approved by management.`,
        type: 'success',
        read: false,
        createdAt: new Date().toISOString()
      });

      await batch.commit();
      toast.success("Swap approved and shift updated");
    } catch (e) { toast.error("Failed to approve swap"); }
  };

  const handleAcceptSwap = async (id: string) => {
    console.log("Manager attempting to accept self-swap:", id);
    try {
      await updateDoc(doc(db, 'swaps', id), { status: 'accepted' });
      toast.success("Confirmed! This swap is now ready for your final validation.");
    } catch (e) { 
      console.error("Manager accept error:", e);
      toast.error("Failed to accept swap. Check permissions."); 
    }
  };

  const handleRequestSwap = async () => {
    if (!selectedShift || !selectedColleague) {
      toast.error("Please select both a shift and a colleague.");
      return;
    }

    const colleague = employees.find(e => e.uid === selectedColleague);
    if (!colleague) return;

    try {
      const payload = {
        requesterId: profile.uid,
        requesterName: profile.displayName || profile.username || 'Manager',
        receiverId: colleague.email || colleague.username || colleague.uid,
        receiverUid: colleague.uid,
        receiverName: colleague.displayName || colleague.username || 'Target',
        shiftId: selectedShift.id,
        shiftDate: selectedShift.date,
        shiftTime: `${selectedShift.startTime}-${selectedShift.endTime}`,
        type: 'shift' as const,
        status: 'pending' as const,
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'swaps'), payload);
      toast.success("Swap request initiated by manager");
      setIsSwapDialogOpen(false);
    } catch (e) {
      toast.error("Failed to initiate swap");
    }
  };

  const markNotificationRead = async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  };

  const scrambleBreaks = async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const shiftsToday = shifts.filter(s => s.date === today);
    if (shiftsToday.length === 0) {
      toast.error("No shifts found for today to optimize.");
      return;
    }

    try {
      const batch = writeBatch(db);
      
      // 1. Delete existing breaks for today
      const todayBreaks = breakPlans.filter(b => b.date === today);
      todayBreaks.forEach(b => {
        batch.delete(doc(db, 'breakPlans', b.id));
      });

      // 2. Resource usage tracker (15-min slots from 00:00 to 23:45)
      // Array of 96 slots (24 hours * 4 slots/hour)
      const slots = new Array(96).fill(0);

      const getTimeSlotIndex = (timeStr: string) => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 4 + Math.floor(m / 15);
      };

      const getTimeStrFromIndex = (index: number) => {
        const h = Math.floor(index / 4);
        const m = (index % 4) * 15;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      };

      // 3. Assign breaks for each shift
      shiftsToday.forEach(shift => {
         const def = SHIFT_DEFINITIONS[shift.type as ShiftType];
         if (!def) return;

         def.breaks.forEach((bDef, bIdx) => {
            const durationInSlots = Math.ceil(((parseInt(bDef.end.split(':')[0])*60 + parseInt(bDef.end.split(':')[1])) - (parseInt(bDef.start.split(':')[0])*60 + parseInt(bDef.start.split(':')[1]))) / 15);
            
            // Define a search window (e.g. +/- 45 mins around standard time)
            const preferredStartSlot = getTimeSlotIndex(bDef.start);
            const searchRange = 6; // +/- 1.5 hours
            
            let bestStartSlot = -1;
            let minConflict = 999;

            // Try different offsets randomly to distribute
            const offsets = Array.from({length: searchRange * 2 + 1}, (_, i) => i - searchRange);
            // Shuffle offsets
            for (let i = offsets.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
            }

            for (const offset of offsets) {
                const testStart = preferredStartSlot + offset;
                if (testStart < 0 || testStart + durationInSlots >= 96) continue;

                // Check conflict
                let maxConcurrency = 0;
                for (let s = testStart; s < testStart + durationInSlots; s++) {
                    maxConcurrency = Math.max(maxConcurrency, slots[s]);
                }

                if (maxConcurrency < 3) { // Our "Line Protection" target
                    bestStartSlot = testStart;
                    break;
                }
                
                if (maxConcurrency < minConflict) {
                    minConflict = maxConcurrency;
                    bestStartSlot = testStart;
                }
            }

            if (bestStartSlot !== -1) {
                // Update tracker
                for (let s = bestStartSlot; s < bestStartSlot + durationInSlots; s++) {
                    slots[s]++;
                }

                const startTime = getTimeStrFromIndex(bestStartSlot);
                const endTime = getTimeStrFromIndex(bestStartSlot + durationInSlots);

                const breakRef = doc(collection(db, 'breakPlans'));
                batch.set(breakRef, {
                    date: today,
                    employeeId: shift.employeeId,
                    employeeUid: shift.employeeUid,
                    employeeName: shift.employeeName,
                    breakStartTime: startTime,
                    breakEndTime: endTime,
                    lastModified: new Date().toISOString(),
                    reason: `Optimized: ${bDef.label}`
                });
            }
         });
      });

      await batch.commit();
      toast.success("Break schedule scrambled & optimized (Max 3/slot)");
    } catch (e) {
      console.error(e);
      toast.error("Optimization failed");
    }
  };

  return (
    <div className="h-full grid grid-cols-[240px_1fr_300px]">
      <aside className="hd-border-r p-5 flex flex-col gap-8 bg-white/50">
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="hd-label">Dispatcher Hub</div>
            <nav className="space-y-1">
              <button 
                onClick={() => setView('shifts')}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs hd-mono font-bold transition-colors ${view === 'shifts' ? 'text-accent bg-accent/5' : 'hover:bg-ink/5'}`}
              >
                <CalendarIcon className="h-4 w-4" /> Shift Logs
              </button>
              <button 
                onClick={() => setView('breaks')}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs hd-mono font-bold transition-colors ${view === 'breaks' ? 'text-accent bg-accent/5' : 'hover:bg-ink/5'}`}
              >
                <Clock className="h-4 w-4" /> Break Logic
              </button>
              <button 
                onClick={() => setView('swaps')}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs hd-mono font-bold transition-colors ${view === 'swaps' ? 'text-accent bg-accent/5' : 'hover:bg-ink/5'}`}
              >
                <Users className="h-4 w-4" /> Swap Requests
                {swapRequests.filter(s => s.status === 'pending').length > 0 && (
                  <span className="ml-auto bg-accent text-white px-1.5 py-0.5 text-[9px] rounded-sm">
                    {swapRequests.filter(s => s.status === 'pending').length}
                  </span>
                )}
              </button>
            </nav>
          </div>

          <div className="space-y-3">
            <div className="hd-label">Administration</div>
            <div className="px-3 space-y-2">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                accept=".csv" 
              />
              <Button 
                variant="outline" 
                className="w-full rounded-none hd-mono text-[10px] h-8 border-line gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3 w-3" /> IMPORT_SCHEDULE
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <section className="overflow-y-auto bg-white">
        <div className="hd-border-b px-6 py-4 flex justify-between items-baseline sticky top-0 bg-white z-10">
          <h2 className="text-xl hd-serif uppercase tracking-tight">
            {view === 'shifts' && 'Shift Management'}
            {view === 'breaks' && 'Daily Break Logic'}
            {view === 'swaps' && 'Swap Approval Queue'}
          </h2>
          <div className="hd-mono text-[11px] text-muted">
            {format(new Date(), 'EEEE // MMM dd, yyyy')}
          </div>
        </div>

        <div className="p-6">
          {view === 'shifts' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center bg-bg/30 p-2 hd-border">
                <div className="flex items-center gap-4">
                  <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(subDays(currentMonth, 30))} className="hd-mono text-[10px]">PREV</Button>
                  <span className="hd-mono text-sm font-bold uppercase">{format(currentMonth, 'MMMM yyyy')}</span>
                  <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(addDays(currentMonth, 30))} className="hd-mono text-[10px]">NEXT</Button>
                </div>
                <Button onClick={() => setIsShiftDialogOpen(true)} className="rounded-none hd-mono text-xs gap-2">
                  <Plus className="h-4 w-4" /> NEW_ENTRY
                </Button>
              </div>
              <div className="hd-border">
                <Table>
                  <TableHeader className="bg-bg">
                    <TableRow className="hover:bg-transparent border-line">
                      <TableHead className="hd-label">Employee</TableHead>
                      <TableHead className="hd-label">Date</TableHead>
                      <TableHead className="hd-label">Type</TableHead>
                      <TableHead className="hd-label">Window</TableHead>
                      <TableHead className="hd-label text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shifts
                      .filter(s => {
                        const sDate = new Date(s.date);
                        return sDate.getMonth() === currentMonth.getMonth() && sDate.getFullYear() === currentMonth.getFullYear();
                      })
                      .map(s => (
                      <TableRow key={s.id} className="border-line hover:bg-bg/50">
                        <TableCell className="hd-mono text-xs font-bold">{s.employeeName}</TableCell>
                        <TableCell className="hd-mono text-[10px] opacity-70">{format(new Date(s.date), 'MMM dd')}</TableCell>
                        <TableCell>
                          <Badge className={`rounded-none uppercase text-[9px] hd-mono ${
                            s.type === 'late' ? 'bg-red-100 text-red-600' : 
                            s.type === 'special' ? 'bg-blue-100 text-blue-600' : 
                            s.type === 'second' ? 'bg-green-100 text-green-600' : 
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {s.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="hd-mono text-xs text-accent font-bold">{s.startTime} - {s.endTime}</TableCell>
                        <TableCell className="text-right">
                          {profile.role === 'manager' ? (
                            <Button variant="ghost" size="icon" onClick={() => deleteDoc(doc(db, 'shifts', s.id))}>
                              <Trash2 className="h-3 w-3 text-muted" />
                            </Button>
                          ) : (
                            <Lock className="h-3 w-3 text-muted mx-auto opacity-30" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {view === 'breaks' && (
             <div className="space-y-4">
                <div className="flex justify-between items-center bg-accent/5 p-4 hd-border">
                    <div className="space-y-1">
                        <div className="hd-mono text-xs font-bold text-accent italic">Automatic Line Balancing v2.4</div>
                        <div className="text-[10px] opacity-60 uppercase">Constraints: 15m intervals // Max 3 employees / slot</div>
                    </div>
                    <Button onClick={scrambleBreaks} variant="outline" className="hd-mono text-[10px] border-accent text-accent hover:bg-accent hover:text-white rounded-none">
                        SHUFFLE_DAILY_BREAKS
                    </Button>
                </div>
                <div className="hd-border">
                <Table>
                  <TableHeader className="bg-bg">
                    <TableRow className="hover:bg-transparent border-line">
                      <TableHead className="hd-label">Employee</TableHead>
                      <TableHead className="hd-label">Time</TableHead>
                      <TableHead className="hd-label">Note</TableHead>
                      <TableHead className="hd-label text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breakPlans
                      .filter(bp => bp.date === format(new Date(), 'yyyy-MM-dd'))
                      .map(bp => (
                      <TableRow key={bp.id} className="border-line hover:bg-bg/50">
                        <TableCell className="hd-mono text-xs font-bold">{bp.employeeName}</TableCell>
                        <TableCell className="hd-mono text-xs text-accent">{bp.breakStartTime} - {bp.breakEndTime}</TableCell>
                        <TableCell className="text-xs italic">{bp.reason || 'Manual Adjustment'}</TableCell>
                        <TableCell className="text-right text-[10px] hd-mono opacity-60">{bp.date}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
           </div>
          )}

          {view === 'swaps' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center bg-bg/50 p-4 hd-border">
                <div className="space-y-1">
                  <div className="hd-label">Swap Protocol</div>
                  <div className="text-[10px] opacity-60">ADMINISTRATIVE SHIFT TRANSFER</div>
                </div>
                <Button onClick={() => setIsSwapDialogOpen(true)} className="rounded-none hd-mono text-xs gap-2">
                  <Plus className="h-4 w-4" /> INITIATE_SWAP_REQUEST
                </Button>
              </div>

              <div className="space-y-3">
                <div className="hd-label">Awaiting Validation</div>
                <div className="space-y-2">
                  {swapRequests.filter(s => s.status === 'accepted').length === 0 ? (
                    <div className="hd-mono text-[10px] opacity-40 text-center py-8 bg-bg flex flex-col items-center gap-2">
                      <ShieldCheck className="h-4 w-4 opacity-20" />
                      NO_SWAPS_AWAITING_VALIDATION
                    </div>
                  ) : (
                    swapRequests.filter(s => s.status === 'accepted').map(swap => (
                      <div key={swap.id} className="hd-card flex items-center justify-between border-l-4 border-l-accent p-4 bg-accent/5">
                        <div className="space-y-1">
                          <div className="hd-mono text-[11px] font-bold uppercase space-y-0.5">
                            <div className="text-accent">FROM: {swap.requesterName}</div>
                            <div className="font-bold underline">SHIFT: {swap.shiftDate} // {swap.shiftTime} ({swap.shiftType})</div>
                            <div className="opacity-60 text-muted mt-1">TO: {swap.receiverName}</div>
                            <div className={!swap.targetShiftDate ? 'opacity-40 italic' : 'font-bold'}>
                              RETURN SHIFT REQUESTED: {!swap.targetShiftDate ? 'None (One-way transfer)' : `${swap.targetShiftDate} // ${swap.targetShiftTime} (${swap.targetShiftType})`}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleApproveSwap(swap)} className="bg-ink text-bg rounded-none hd-mono text-[10px] h-7 px-4 font-bold">
                            VALIDATE_SWAP
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => {
                            updateDoc(doc(db, 'swaps', swap.id), { status: 'rejected' });
                            toast.error("Swap request rejected.");
                          }} className="rounded-none hd-mono text-[10px] h-7 border-line font-bold">
                            REJECT
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {swapRequests.filter(s => s.status === 'pending' && s.receiverUid === profile.uid).length > 0 && (
                <div className="space-y-3">
                  <div className="hd-label text-accent uppercase flex items-center gap-2">
                    <Bell className="h-3 w-3 animate-pulse" /> Incoming Swap Requests For You
                  </div>
                  <div className="space-y-2">
                    {swapRequests.filter(s => s.status === 'pending' && s.receiverUid === profile.uid).map(swap => (
                      <div key={swap.id} className="hd-card flex items-center justify-between border-l-4 border-l-yellow-500 p-4 bg-yellow-50/30">
                        <div className="space-y-1">
                          <div className="hd-mono text-[11px] font-bold uppercase space-y-0.5">
                            <div className="text-accent">FROM: {swap.requesterName}</div>
                            <div className="font-bold underline">SHIFT: {swap.shiftDate} // {swap.shiftTime} ({swap.shiftType})</div>
                            <div className="opacity-60 text-muted mt-1">TO: {profile.displayName || profile.username || 'You'}</div>
                            <div className={!swap.targetShiftDate ? 'opacity-40 italic' : 'font-bold'}>
                              RETURN SHIFT REQUESTED: {!swap.targetShiftDate ? 'None (One-way transfer)' : `${swap.targetShiftDate} // ${swap.targetShiftTime} (${swap.targetShiftType})`}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleAcceptSwap(swap.id)} className="bg-accent text-white rounded-none hd-mono text-[10px] h-7 px-4 font-bold">
                            ACCEPT_REQUEST
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => updateDoc(doc(db, 'swaps', swap.id), { status: 'rejected' })} className="rounded-none hd-mono text-[10px] h-7 border-line font-bold">
                            DECLINE
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {swapRequests.filter(s => s.status === 'pending').length > 0 && (
                <div className="space-y-3 opacity-70">
                  <div className="hd-label">Awaiting Employee Response</div>
                  <div className="space-y-2">
                    {swapRequests.filter(s => s.status === 'pending').map(swap => (
                      <div key={swap.id} className="hd-card flex items-center justify-between p-3 border border-dashed border-line">
                        <div className="space-y-1">
                          <div className="hd-mono text-[11px] font-bold uppercase space-y-0.5">
                            <div className="text-accent">FROM: {swap.requesterName}</div>
                            <div className="font-bold underline">SHIFT: {swap.shiftDate} // {swap.shiftTime} ({swap.shiftType})</div>
                            <div className="opacity-60 text-muted mt-1">TO: {swap.receiverName}</div>
                            <div className={!swap.targetShiftDate ? 'opacity-40 italic' : 'font-bold'}>
                              RETURN SHIFT REQUESTED: {!swap.targetShiftDate ? 'None (One-way transfer)' : `${swap.targetShiftDate} // ${swap.targetShiftTime} (${swap.targetShiftType})`}
                            </div>
                          </div>
                          <div className="text-[8px] text-muted uppercase italic pt-1 border-t border-line/10 mt-1">
                            AWAITING: {swap.receiverName} to click ACCEPT
                          </div>
                        </div>
                        <Badge className="bg-yellow-100 text-yellow-700 rounded-none text-[8px] hd-mono font-bold">
                          PENDING_EMPLOYEE
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3 opacity-60">
                <div className="hd-label">Swap History</div>
                <div className="space-y-2">
                  {swapRequests.filter(s => s.status !== 'accepted' && s.status !== 'pending').map(swap => (
                    <div key={swap.id} className="hd-card flex items-center justify-between p-3 border border-line">
                      <div className="space-y-1">
                        <div className="hd-mono text-xs font-bold">
                          {swap.requesterName} → {swap.receiverName}
                        </div>
                        <div className="text-[9px] text-muted uppercase">
                          {swap.shiftDate} // {swap.shiftTime}
                        </div>
                      </div>
                      <Badge className={`rounded-none uppercase text-[8px] hd-mono font-bold flex items-center gap-1 ${
                        (swap.status === 'completed' || swap.status === 'approved') ? 'bg-green-100 text-green-700' : 
                        (swap.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700')
                      }`}>
                        {(swap.status === 'completed' || swap.status === 'approved') && <Check className="h-2 w-2" />}
                        {swap.status === 'completed' ? 'APPROVED_BY_MANAGER' : (swap.status === 'rejected' ? 'REJECTED' : swap.status.toUpperCase())}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="hd-border-l bg-[#2A2A2A] text-bg p-5 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-2">
          <h3 className="hd-serif hd-italic text-lg">System Alerts</h3>
          <Bell className="h-4 w-4 text-accent" />
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
          {notifications.length === 0 ? (
            <div className="hd-mono text-[10px] opacity-40 text-center py-10">NO_ACTIVE_ALERTS</div>
          ) : (
            notifications.map(n => (
              <div 
                key={n.id} 
                className={`p-3 border-l-2 ${n.read ? 'border-white/20 opacity-60' : 'border-accent bg-white/5'} space-y-1 cursor-pointer`}
                onClick={() => markNotificationRead(n.id)}
              >
                <div className="hd-mono text-[10px] text-accent font-bold uppercase">{n.title}</div>
                <div className="text-[11px] leading-tight">{n.message}</div>
                <div className="text-[9px] opacity-40 hd-mono">{format(new Date(n.createdAt), 'HH:mm:ss')}</div>
              </div>
            ))
          )}
        </div>
      </aside>

      <Dialog open={isShiftDialogOpen} onOpenChange={setIsShiftDialogOpen}>
        <DialogContent className="rounded-none border-line">
          <DialogHeader>
            <DialogTitle className="hd-serif uppercase">Manual Shift Entry</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label className="hd-label">Employee Selection</Label>
              <Select 
                onValueChange={(uid) => {
                  const emp = employees.find(e => e.uid === uid);
                  if (emp) {
                    setNewShift({
                      ...newShift, 
                      employeeId: emp.email || emp.username || '',
                      employeeUid: emp.uid,
                      employeeName: emp.displayName || emp.username || ''
                    });
                  }
                }}
              >
                <SelectTrigger className="rounded-none border-line hd-mono text-xs">
                  <SelectValue placeholder="SELECT_EMPLOYEE" />
                </SelectTrigger>
                <SelectContent className="rounded-none border-line">
                  {employees.map(e => (
                    <SelectItem key={e.uid} value={e.uid}>
                      {e.displayName || e.username} ({e.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
               <div className="grid gap-2">
                <Label className="hd-label">Shift Type</Label>
                <Select 
                  value={newShift.type} 
                  onValueChange={(v) => handleShiftTypeChange(v as ShiftType)}
                >
                  <SelectTrigger className="rounded-none border-line hd-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-none border-line">
                    <SelectItem value="normal">Normal (08:00)</SelectItem>
                    <SelectItem value="second">Second (08:45)</SelectItem>
                    <SelectItem value="special">Special (09:00)</SelectItem>
                    <SelectItem value="late">Late (11:30)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label className="hd-label">Operational Date</Label>
                <Input 
                  type="date"
                  className="rounded-none border-line hd-mono text-xs"
                  value={newShift.date || ''} 
                  onChange={e => setNewShift({...newShift, date: e.target.value})}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="hd-label">Window Start</Label>
                <Input 
                  className="rounded-none border-line hd-mono text-xs"
                  value={newShift.startTime || ''} 
                  onChange={e => setNewShift({...newShift, startTime: e.target.value})}
                />
              </div>
              <div className="grid gap-2">
                <Label className="hd-label">Window End</Label>
                <Input 
                  className="rounded-none border-line hd-mono text-xs"
                  value={newShift.endTime || ''} 
                  onChange={e => setNewShift({...newShift, endTime: e.target.value})}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddShift} className="rounded-none hd-mono text-xs">COMMIT_ENTRY</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSwapDialogOpen} onOpenChange={setIsSwapDialogOpen}>
        <DialogContent className="rounded-none border-line">
          <DialogHeader>
            <DialogTitle className="hd-serif uppercase">Initiate Shift Swap (Admin)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
                <Label className="hd-label">Select Shift to Transfer</Label>
                <Select onValueChange={(val) => {
                  const s = shifts.find(x => x.id === val);
                  setSelectedShift(s || null);
                }} value={selectedShift?.id}>
                    <SelectTrigger className="rounded-none hd-mono text-xs border-line bg-bg">
                        <SelectValue placeholder="CHOOSE_FROM_ALL_SHIFTS" />
                    </SelectTrigger>
                    <SelectContent className="rounded-none border-line">
                        {shifts.filter(s => new Date(s.date) >= new Date()).map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.employeeName}: {format(new Date(s.date), 'MMM dd')} - {s.startTime}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {selectedShift && (
              <div className="p-3 bg-accent/5 border border-accent/20 hd-mono text-[10px] space-y-1">
                  <div className="font-bold text-accent uppercase">Current Owner: {selectedShift.employeeName}</div>
                  <div>DATE: {selectedShift.date}</div>
                  <div>WINDOW: {selectedShift.startTime} - {selectedShift.endTime}</div>
              </div>
            )}
            <div className="space-y-2">
                <Label className="hd-label">Select Target Employee</Label>
                <Select onValueChange={setSelectedColleague} value={selectedColleague}>
                    <SelectTrigger className="rounded-none hd-mono text-xs border-line">
                        <SelectValue placeholder="SELECT_NEW_OWNER" />
                    </SelectTrigger>
                    <SelectContent className="rounded-none border-line">
                        {employees.filter(e => e.uid !== selectedShift?.employeeUid).map(e => (
                            <SelectItem key={e.uid} value={e.uid}>{e.displayName || e.username}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
          </div>
          <DialogFooter>
            <Button 
              onClick={handleRequestSwap} 
              disabled={!selectedShift || !selectedColleague}
              className="rounded-none hd-mono text-xs w-full bg-ink text-bg disabled:opacity-30"
            >
              INITIATE_SWAP_REQUEST
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}
