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
import { Plus, Trash2, Upload, Calendar as CalendarIcon, Clock, Users, Bell, Check, X, FileSpreadsheet, AlertTriangle, Lock } from 'lucide-react';
import { format, addDays, subDays } from 'date-fns';
import * as XLSX from 'xlsx';

interface ManagerDashboardProps {
  profile: UserProfile;
  notifications: AppNotification[];
}

type ViewType = 'shifts' | 'breaks' | 'swaps' | 'team';

export default function ManagerDashboard({ profile, notifications }: ManagerDashboardProps) {
  const [view, setView] = useState<ViewType>('shifts');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [breakPlans, setBreakPlans] = useState<BreakPlan[]>([]);
  const [employees, setEmployees] = useState<UserProfile[]>([]);
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([]);
  const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false);
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
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const batch = writeBatch(db);
        let importedCount = 0;
        let rejectedCount = 0;

        for (const row of data) {
          const email = row.Email || row.employeeId;
          const name = row.Name || row.employeeName;
          const date = row.Date || format(new Date(), 'yyyy-MM-dd');
          const start = row.Start || row.startTime;
          
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
            endTime: row.End || row.endTime || SHIFT_DEFINITIONS[shiftType].endTime,
            customerCareRole: row.Role || row.customerCareRole || 'Support',
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
        console.error("Excel parse error:", error);
        toast.error("Failed to parse Excel file. Ensure columns: Name, Email, Date, Start, End, Role");
      }
    };
    reader.readAsBinaryString(file);
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

  const markNotificationRead = async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  };

  return (
    <div className="h-full grid grid-cols-[240px_1fr_300px]">
      <aside className="hd-border-r p-5 flex flex-col gap-8 bg-white/50">
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="hd-label">Management Console</div>
            <nav className="space-y-1">
              <button 
                onClick={() => setView('shifts')}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs hd-mono font-bold transition-colors ${view === 'shifts' ? 'text-accent bg-accent/5' : 'hover:bg-ink/5'}`}
              >
                <CalendarIcon className="h-4 w-4" /> SHIFT_LOGS
              </button>
              <button 
                onClick={() => setView('breaks')}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs hd-mono font-bold transition-colors ${view === 'breaks' ? 'text-accent bg-accent/5' : 'hover:bg-ink/5'}`}
              >
                <Clock className="h-4 w-4" /> BREAK_PLANNER
              </button>
              <button 
                onClick={() => setView('swaps')}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs hd-mono font-bold transition-colors ${view === 'swaps' ? 'text-accent bg-accent/5' : 'hover:bg-ink/5'}`}
              >
                <Users className="h-4 w-4" /> SWAP_REQUESTS
                {swapRequests.filter(s => s.status === 'pending').length > 0 && (
                  <span className="ml-auto bg-accent text-white px-1.5 py-0.5 text-[9px] rounded-sm">
                    {swapRequests.filter(s => s.status === 'pending').length}
                  </span>
                )}
              </button>
            </nav>
          </div>

          <div className="space-y-3">
            <div className="hd-label">System Operations</div>
            <div className="px-3 space-y-2">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                accept=".xlsx, .xls" 
              />
              <Button 
                variant="outline" 
                className="w-full rounded-none hd-mono text-[10px] h-8 border-line gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3 w-3" /> IMPORT_EXCEL
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-auto pt-4 hd-border-t">
          <div className="hd-label mb-2">Shift Rules</div>
          <div className="hd-mono text-[9px] space-y-2 opacity-80 bg-bg p-3 border border-line">
            <div className="text-accent font-bold">STRICT_LATE_POLICY:</div>
            <div className="leading-tight text-[8px]">
              IF PREV_SHIFT == LATE<br/>
              THEN NEXT_SHIFT MUST == SPECIAL
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
              <div className="flex justify-end">
                <Button onClick={() => setIsShiftDialogOpen(true)} className="rounded-none hd-mono text-xs gap-2">
                  <Plus className="h-4 w-4" /> NEW_SHIFT_ENTRY
                </Button>
              </div>
              <div className="hd-border">
                <Table>
                  <TableHeader className="bg-bg">
                    <TableRow className="hover:bg-transparent border-line">
                      <TableHead className="hd-label">Employee</TableHead>
                      <TableHead className="hd-label">Type</TableHead>
                      <TableHead className="hd-label">Window</TableHead>
                      <TableHead className="hd-label text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shifts.map(s => (
                      <TableRow key={s.id} className="border-line hover:bg-bg/50">
                        <TableCell className="hd-mono text-xs font-bold">{s.employeeName}</TableCell>
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
                 {breakPlans.map(bp => (
                   <TableRow key={bp.id} className="border-line hover:bg-bg/50">
                     <TableCell className="hd-mono text-xs font-bold">{bp.employeeName}</TableCell>
                     <TableCell className="hd-mono text-xs text-accent">{bp.breakStartTime} - {bp.breakEndTime}</TableCell>
                     <TableCell className="text-xs italic">{bp.reason || 'SOP_STANDSTILL'}</TableCell>
                     <TableCell className="text-right text-[10px] hd-mono opacity-60">{bp.date}</TableCell>
                   </TableRow>
                 ))}
               </TableBody>
             </Table>
           </div>
          )}

          {view === 'swaps' && (
            <div className="space-y-4">
              {swapRequests.length === 0 ? (
                <div className="hd-card text-center py-20 hd-mono text-xs text-muted">NO_PENDING_SWAP_REQUESTS</div>
              ) : (
                swapRequests.map(swap => (
                  <div key={swap.id} className="hd-card flex items-center justify-between border-l-4 border-l-accent">
                    <div className="space-y-1">
                      <div className="hd-mono text-xs font-bold uppercase">
                        {swap.requesterName} <span className="text-muted mx-2">→</span> {swap.receiverName}
                      </div>
                      <div className="text-[10px] text-muted uppercase">
                        TYPE: {swap.type} // SHIFT_ID: {swap.shiftId} // STATUS: <span className={swap.status === 'accepted' ? 'text-accent font-bold' : ''}>{swap.status}</span>
                      </div>
                    </div>
                    {swap.status === 'accepted' && (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleApproveSwap(swap)} className="bg-ink text-bg rounded-none hd-mono text-[10px] h-7">
                          FINAL_APPROVE
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updateDoc(doc(db, 'swaps', swap.id), { status: 'rejected' })} className="rounded-none hd-mono text-[10px] h-7 border-line">
                          REJECT
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
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
