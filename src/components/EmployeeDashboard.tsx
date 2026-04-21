import { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot, query, where, orderBy, addDoc, doc, updateDoc } from 'firebase/firestore';
import { Shift, BreakPlan, UserProfile, SwapRequest, AppNotification } from '../types';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Calendar, Clock, Coffee, Info, Bell, ArrowLeftRight, FileText, UserIcon, Plus, Check, ShieldCheck } from 'lucide-react';
import { format, isAfter, parseISO, addMinutes, subDays, addDays } from 'date-fns';
import { toast } from 'sonner';

interface EmployeeDashboardProps {
  profile: UserProfile;
  notifications: AppNotification[];
}

type EmployeeView = 'schedule' | 'plan' | 'swaps';
type SwapSubView = 'incoming' | 'outgoing' | 'history';

export default function EmployeeDashboard({ profile, notifications }: EmployeeDashboardProps) {
  const [view, setView] = useState<EmployeeView>('schedule');
  const [swapSubView, setSwapSubView] = useState<SwapSubView>('incoming');
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [todayBreaks, setTodayBreaks] = useState<BreakPlan[]>([]);
  const [employees, setEmployees] = useState<UserProfile[]>([]);
  const [mySwaps, setMySwaps] = useState<SwapRequest[]>([]);
  const [incomingSwaps, setIncomingSwaps] = useState<SwapRequest[]>([]);
  const [isSwapDialogOpen, setIsSwapDialogOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [selectedColleague, setSelectedColleague] = useState<string>('');
  const [selectedTargetShift, setSelectedTargetShift] = useState<Shift | null>(null);
  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    const unsubShifts = onSnapshot(query(
      collection(db, 'shifts'), 
      where('employeeUid', '==', profile.uid), 
      orderBy('date', 'desc')
    ), (s) => {
      setMyShifts(s.docs.map(d => ({ id: d.id, ...d.data() } as Shift)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'shifts');
    });
    
    const unsubBreaks = onSnapshot(query(
      collection(db, 'breakPlans'), 
      where('date', '==', today), 
      where('employeeUid', '==', profile.uid),
      orderBy('breakStartTime', 'asc')
    ), (s) => {
      setTodayBreaks(s.docs.map(d => ({ id: d.id, ...d.data() } as BreakPlan)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'breakPlans');
    });
    const unsubSwaps = onSnapshot(query(collection(db, 'swaps'), where('requesterId', '==', profile.uid)), (s) => {
      setMySwaps(s.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'swaps (outgoing)'));

    const unsubIncoming = onSnapshot(query(collection(db, 'swaps'), where('receiverUid', '==', profile.uid)), (s) => {
      setIncomingSwaps(s.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'swaps (incoming)'));

    const unsubAllShifts = onSnapshot(query(collection(db, 'shifts'), orderBy('date', 'asc')), (s) => {
      setAllShifts(s.docs.map(d => ({ id: d.id, ...d.data() } as Shift)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'all shifts'));

    return () => {
      unsubShifts();
      unsubBreaks();
      unsubSwaps();
      unsubIncoming();
      unsubAllShifts();
    };
  }, [profile.email, profile.uid, today]);

  useEffect(() => {
    const unsubEmployees = onSnapshot(collection(db, 'users'), (s) => {
      setEmployees(s.docs.map(d => d.data() as UserProfile));
    });
    return () => unsubEmployees();
  }, []);

  // Break Reminders
  useEffect(() => {
    const checkBreaks = () => {
      const now = new Date();
      
      todayBreaks.forEach(bp => {
        if (bp.employeeUid === profile.uid) {
          const [hours, minutes] = bp.breakStartTime.split(':').map(Number);
          const breakTime = new Date();
          breakTime.setHours(hours, minutes, 0);
          
          const diff = (breakTime.getTime() - now.getTime()) / (1000 * 60);
          if (diff > 0 && diff <= 5) {
            toast.info(`Break Reminder: Your break starts in ${Math.round(diff)} minutes!`, {
              icon: <Clock className="h-4 w-4" />
            });
          }
        }
      });
    };

    const interval = setInterval(checkBreaks, 60000);
    return () => clearInterval(interval);
  }, [todayBreaks, profile.email]);

  const handleRequestSwap = async () => {
    if (!selectedShift || !selectedColleague) {
      toast.error("Please select both a shift and a colleague.");
      return;
    }

    const colleague = employees.find(e => e.uid === selectedColleague);
    if (!colleague) {
        toast.error("Employee not found.");
        return;
    }

    try {
      console.log("Initiating swap transfer...", { shift: selectedShift, target: selectedColleague, exchange: selectedTargetShift });
      
      const payload = {
        requesterId: profile.uid,
        requesterName: profile.displayName || profile.username || 'Applicant',
        receiverId: colleague.email || colleague.username || colleague.uid,
        receiverUid: colleague.uid,
        receiverName: colleague.displayName || colleague.username || 'Target',
        shiftId: selectedShift.id,
        shiftDate: selectedShift.date,
        shiftTime: `${selectedShift.startTime}-${selectedShift.endTime}`,
        shiftType: selectedShift.type,
        targetShiftDate: selectedTargetShift ? selectedTargetShift.date : null,
        targetShiftTime: selectedTargetShift ? `${selectedTargetShift.startTime}-${selectedTargetShift.endTime}` : null,
        targetShiftType: selectedTargetShift?.type || null,
        type: 'shift' as const,
        status: 'pending' as const,
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'swaps'), payload);
      toast.success(`Swap request sent to ${colleague.displayName || colleague.username}`);
      setIsSwapDialogOpen(false);
      setSelectedColleague('');
    } catch (e) { 
      console.error("Swap initiation failed:", e);
      handleFirestoreError(e, OperationType.CREATE, 'swaps'); 
    }
  };

  const handleAcceptSwap = async (swap: SwapRequest) => {
    console.log("Attempting to accept swap:", swap.id);
    try {
      await updateDoc(doc(db, 'swaps', swap.id), { status: 'accepted' });
      toast.success("AGREED! Request moved to manager validation queue.");
    } catch (e) { 
      console.error("Accept swap error:", e);
      handleFirestoreError(e, OperationType.UPDATE, 'swaps');
    }
  };

  const markNotificationRead = async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  };

  return (
    <div className="h-full grid grid-cols-[240px_1fr_300px]">
      {/* Left Sidebar */}
      <aside className="hd-border-r p-5 flex flex-col gap-8 bg-white/50">
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="hd-label">My Workspace</div>
            <nav className="space-y-1">
              <button 
                onClick={() => setView('schedule')}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs hd-mono font-bold transition-colors ${view === 'schedule' ? 'text-accent bg-accent/5' : 'hover:bg-ink/5'}`}
              >
                <Clock className="h-4 w-4" /> Personal Schedule
              </button>
              <button 
                onClick={() => setView('plan')}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs hd-mono font-bold transition-colors ${view === 'plan' ? 'text-accent bg-accent/5' : 'hover:bg-ink/5'}`}
              >
                <Calendar className="h-4 w-4" /> Team Shift Plan
              </button>
              <button 
                onClick={() => setView('swaps')}
                className={`w-full flex items-center gap-3 px-3 py-2 text-xs hd-mono font-bold transition-colors ${view === 'swaps' ? 'text-accent bg-accent/5' : 'hover:bg-ink/5'}`}
              >
                <ArrowLeftRight className="h-4 w-4" /> Swap Logistics
                {(incomingSwaps.filter(s => s.status === 'pending').length > 0) && (
                  <span className="ml-auto bg-accent text-white px-1.5 py-0.5 text-[9px] rounded-sm animate-pulse">
                    {incomingSwaps.filter(s => s.status === 'pending').length}
                  </span>
                )}
              </button>
            </nav>
            <div className="pt-2">
              <Button 
                onClick={() => setIsSwapDialogOpen(true)} 
                className="w-full rounded-none hd-mono text-[10px] h-9 gap-2 bg-accent hover:bg-accent/90"
              >
                <ArrowLeftRight className="h-3 w-3" /> INITIATE_SWAP_REQUEST
              </Button>
            </div>
          </div>

          {incomingSwaps.filter(s => s.status === 'pending').length > 0 && (
            <div className="space-y-3">
              <div className="hd-label text-accent uppercase flex items-center gap-2">
                <Bell className="h-3 w-3 animate-bounce" /> Action Required: Swap Requests
              </div>
              <div className="space-y-2">
                {incomingSwaps.filter(s => s.status === 'pending').map(s => (
                  <div key={s.id} className="hd-card p-3 text-[10px] hd-mono space-y-3 bg-yellow-50 border-l-4 border-l-yellow-600">
                    <div className="flex justify-between items-start">
                      <div className="font-bold">FROM: {s.requesterName}</div>
                      <Badge className="bg-yellow-200 text-yellow-900 border border-yellow-400 text-[8px] h-4 rounded-none uppercase font-bold">PENDING</Badge>
                    </div>
                    <div className="opacity-70 leading-tight space-y-0.5">
                      <div className="font-bold uppercase">FROM: {s.requesterName}</div>
                      <div className="font-bold underline">SHIFT: {s.shiftDate} // {s.shiftTime} ({s.shiftType})</div>
                      <div className="opacity-60 uppercase mt-1">TO: You</div>
                      <div className={!s.targetShiftDate ? 'italic opacity-60' : 'font-bold'}>
                        RETURN SHIFT REQUESTED: {!s.targetShiftDate ? 'None (One-way transfer)' : `${s.targetShiftDate} // ${s.targetShiftTime} (${s.targetShiftType})`}
                      </div>
                    </div>
                    <div className="flex gap-1 pt-1">
                      <Button size="sm" onClick={() => handleAcceptSwap(s)} className="h-7 px-2 text-[9px] rounded-none bg-ink text-bg font-bold">ACCEPT</Button>
                      <Button size="sm" variant="outline" onClick={() => updateDoc(doc(db, 'swaps', s.id), { status: 'rejected' })} className="h-7 px-2 text-[9px] rounded-none border-line font-bold">REJECT</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="hd-label">Notifications</div>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {notifications.filter(n => !n.read).map(n => (
                <div key={n.id} className="text-[10px] hd-mono border-l-2 border-accent pl-2 py-1 bg-accent/5 cursor-pointer" onClick={() => markNotificationRead(n.id)}>
                  <div className="font-bold uppercase">{n.title}</div>
                  <div className="opacity-70 truncate">{n.message}</div>
                </div>
              ))}
              {notifications.filter(n => !n.read).length === 0 && (
                <div className="text-[9px] hd-mono opacity-40 text-center py-4">Status: No Alerts</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-auto pt-4 hd-border-t">
          <div className="hd-label mb-2">Month Progress</div>
          <div className="grid grid-cols-7 gap-1 hd-mono text-[9px]">
            {Array.from({length: 31}).map((_, i) => {
              const day = i + 1;
              const dateStr = format(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day), 'yyyy-MM-dd');
              const hasShift = myShifts.some(s => s.date === dateStr);
              return (
                <div key={i} className={`p-1 text-center ${hasShift ? 'bg-accent text-white font-bold' : 'bg-ink/5'}`}>
                  {String(day).padStart(2, '0')}
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Center Content */}
      <section className="overflow-y-auto bg-white">
        <div className="hd-border-b px-6 py-4 flex justify-between items-baseline sticky top-0 bg-white z-10 gap-4">
          <div className="flex flex-col">
            <h2 className="text-xl hd-serif uppercase tracking-tight">
              {view === 'schedule' && 'Daily Shift Schedule'}
              {view === 'plan' && 'Master Shift Plan'}
              {view === 'swaps' && 'Swap Logic Center'}
            </h2>
            <div className="hd-mono text-[10px] text-muted">
              {format(new Date(), 'EEEE // MMM dd, yyyy')}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {(view === 'schedule' || view === 'swaps') && (
              <Button 
                onClick={() => { 
                  setSelectedShift(null); 
                  setSelectedColleague(''); 
                  setIsSwapDialogOpen(true); 
                }} 
                className="rounded-none hd-mono text-[10px] h-8 gap-2 bg-accent hover:bg-accent/90"
              >
                <Plus className="h-3.5 w-3.5" /> INITIATE_SWAP_REQUEST
              </Button>
            )}
          </div>
        </div>

        <div className="p-6 space-y-6">
          {view === 'schedule' && (
            <div className="hd-card">
              <div className="hd-label mb-4 flex justify-between uppercase">
                <span>Your Shifts</span>
              </div>
              <div className="space-y-0">
                {myShifts
                  .filter(s => {
                     const d = new Date(s.date);
                     return d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
                  })
                  .sort((a,b) => a.date.localeCompare(b.date))
                  .map(s => (
                  <div key={s.id} className={`hd-table-row border-line ${s.date === today ? 'bg-accent/5 border-l-2 border-l-accent' : ''}`}>
                    <div className="flex items-center gap-4">
                      <div className="hd-mono text-[11px] font-bold w-24">
                          {format(parseISO(s.date), 'EEE, MMM dd')}
                      </div>
                      <div className="hd-mono text-sm font-medium w-32">{s.startTime} - {s.endTime}</div>
                      <div className="flex flex-col">
                        <div className="text-xs">{s.customerCareRole}</div>
                        <Badge className={`rounded-none uppercase text-[8px] hd-mono w-fit mt-0.5 px-1 h-3 inline-flex items-center ${
                          s.type === 'late' ? 'bg-red-100 text-red-600' : 
                          s.type === 'special' ? 'bg-blue-100 text-blue-600' : 
                          s.type === 'second' ? 'bg-green-100 text-green-600' : 
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {s.type}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {s.date === today && <div className="text-[10px] hd-mono uppercase text-accent font-bold">Today</div>}
                      {(() => {
                        const activeSwap = [...mySwaps, ...incomingSwaps].find(sw => sw.shiftId === s.id && (sw.status === 'pending' || sw.status === 'accepted'));
                        if (activeSwap) {
                          return (
                            <Badge className={`rounded-none uppercase text-[8px] hd-mono font-bold flex items-center gap-1 ${
                              activeSwap.status === 'pending' ? 'bg-yellow-200 text-yellow-900 border border-yellow-400' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {activeSwap.status === 'pending' ? (
                                <><Clock className="h-2 w-2" /> SWAP_PENDING</>
                              ) : (
                                <><ShieldCheck className="h-2 w-2" /> AWAITING_MANAGER</>
                              )}
                            </Badge>
                          );
                        }
                        return null;
                      })()}
                      <Button variant="outline" size="sm" onClick={() => {
                          setSelectedShift(s);
                          setSelectedColleague('');
                          setIsSwapDialogOpen(true);
                        }} className="h-6 hd-mono text-[9px] px-2 rounded-none border-line gap-1.5 font-bold">
                        <ArrowLeftRight className="h-2.5 w-2.5" /> SWAP
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'plan' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-2">
                <div className="hd-mono text-[10px] uppercase font-bold text-muted">Full Team Schedule (Month)</div>
                <div className="flex items-center gap-2">
                   <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subDays(currentMonth, 30))} className="h-7 text-[10px] rounded-none">PREV</Button>
                   <span className="hd-mono text-xs font-bold uppercase">{format(currentMonth, 'MMM yyyy')}</span>
                   <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addDays(currentMonth, 30))} className="h-7 text-[10px] rounded-none">NEXT</Button>
                </div>
              </div>
              <div className="hd-border overflow-hidden border-r border-line">
                <Table className="border-collapse">
                  <TableHeader className="bg-bg/90 sticky top-0 z-20">
                    <TableRow className="hover:bg-transparent border-line">
                      <TableHead className="hd-label py-2 border-r border-line first:border-l-0">Employee</TableHead>
                      <TableHead className="hd-label py-2 border-r border-line">Date</TableHead>
                      <TableHead className="hd-label py-2 border-r border-line">Shift Window</TableHead>
                      <TableHead className="hd-label py-2 text-right border-line">Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allShifts
                      .filter(s => {
                        const d = new Date(s.date);
                        return d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
                      })
                      .map(s => (
                        <TableRow key={s.id} className={`border-line hd-mono text-[11px] hover:bg-ink/5 transition-colors ${s.employeeUid === profile.uid ? 'bg-accent/5 font-bold' : ''}`}>
                          <TableCell className="py-2 border-r border-line">{s.employeeName}</TableCell>
                          <TableCell className="py-2 border-r border-line opacity-70">{format(parseISO(s.date), 'MMM dd (EEE)')}</TableCell>
                          <TableCell className="py-2 border-r border-line text-accent font-medium">{s.startTime} - {s.endTime}</TableCell>
                          <TableCell className="py-2 text-right text-[10px] uppercase opacity-50">{s.customerCareRole}</TableCell>
                        </TableRow>
                      ))}
                    {allShifts.filter(s => {
                        const d = new Date(s.date);
                        return d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
                    }).length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center py-20 hd-mono text-xs opacity-30 italic">NO_SHIFTS_PUBLISHED_FOR_WINDOW</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {view === 'swaps' && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 border-b border-line pb-px">
                <button 
                  onClick={() => setSwapSubView('incoming')}
                  className={`px-4 py-3 text-[11px] hd-mono font-bold uppercase transition-all border-b-2 ${swapSubView === 'incoming' ? 'border-accent text-accent' : 'border-transparent opacity-40 hover:opacity-100'}`}
                >
                  INCOMING_LOGISTICS
                  {incomingSwaps.filter(s => s.status === 'pending').length > 0 && (
                    <span className="ml-2 bg-accent text-white px-2 py-0.5 rounded-sm text-[9px] animate-pulse">
                      {incomingSwaps.filter(s => s.status === 'pending').length}
                    </span>
                  )}
                </button>
                <button 
                  onClick={() => setSwapSubView('outgoing')}
                  className={`px-4 py-3 text-[11px] hd-mono font-bold uppercase transition-all border-b-2 ${swapSubView === 'outgoing' ? 'border-accent text-accent' : 'border-transparent opacity-40 hover:opacity-100'}`}
                >
                  OUTBOUND_FLOW
                </button>
                <button 
                  onClick={() => setSwapSubView('history')}
                  className={`px-4 py-3 text-[11px] hd-mono font-bold uppercase transition-all border-b-2 ${swapSubView === 'history' ? 'border-accent text-accent' : 'border-transparent opacity-40 hover:opacity-100'}`}
                >
                  LIFECYCLE_ARCHIVE
                </button>
              </div>

              <div className="space-y-6 pt-2">
                {swapSubView === 'incoming' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="hd-label">Swap Requests for You</div>
                      <div className="hd-mono text-[9px] opacity-40 uppercase">Action required on active items</div>
                    </div>
                    <div className="hd-border overflow-hidden">
                      <Table>
                        <TableHeader className="bg-bg">
                          <TableRow className="hover:bg-transparent border-line">
                            <TableHead className="hd-label">Requester</TableHead>
                            <TableHead className="hd-label">Shift Details</TableHead>
                            <TableHead className="hd-label">Current Status</TableHead>
                            <TableHead className="hd-label text-right">Operations</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {incomingSwaps
                            .filter(s => s.status === 'pending' || s.status === 'accepted' || s.status === 'completed' || s.status === 'approved')
                            .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                            .map(swap => (
                            <TableRow key={swap.id} className={`border-line ${swap.status === 'pending' ? 'bg-yellow-50/40 border-l-4 border-l-yellow-600' : ''}`}>
                              <TableCell className="hd-mono text-[10px] space-y-0.5">
                                <div className="font-bold text-accent uppercase">FROM: {swap.requesterName}</div>
                                <div className="font-bold underline">SHIFT: {swap.shiftDate ? format(parseISO(swap.shiftDate), 'MMM dd') : 'N/A'} // {swap.shiftTime} ({swap.shiftType})</div>
                                <div className="opacity-40 uppercase mt-1">TO: {profile.displayName || profile.username || 'You'}</div>
                                <div className={!swap.targetShiftDate ? 'opacity-40 italic' : 'font-bold'}>
                                  RETURN SHIFT REQUESTED: {!swap.targetShiftDate ? 'None (One-way transfer)' : `${swap.targetShiftDate} // ${swap.targetShiftTime} (${swap.targetShiftType})`}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge className={`rounded-none uppercase text-[9px] hd-mono font-bold flex items-center gap-1 ${
                                  swap.status === 'pending' ? 'bg-yellow-200 text-yellow-900 border border-yellow-400' :
                                  swap.status === 'accepted' ? 'bg-blue-100 text-blue-700' :
                                  (swap.status === 'completed' || swap.status === 'approved') ? 'bg-green-100 text-green-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {swap.status === 'pending' && <><Bell className="h-2 w-2" /> PENDING_YOUR_APPROVAL</>}
                                  {swap.status === 'accepted' && 'AWAITING_MANAGER_VALIDATION'}
                                  {(swap.status === 'approved' || swap.status === 'completed') && <><Check className="h-2.5 w-2.5" /> APPROVED_BY_MANAGER</>}
                                  {swap.status === 'rejected' && 'REJECTED'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {swap.status === 'pending' ? (
                                  <div className="flex justify-end gap-2">
                                    <Button size="sm" onClick={() => handleAcceptSwap(swap)} className="h-7 px-3 text-[10px] rounded-none bg-accent hover:bg-accent/90 text-white font-bold">ACCEPT_SWAP</Button>
                                    <Button size="sm" variant="outline" onClick={() => updateDoc(doc(db, 'swaps', swap.id), { status: 'rejected' })} className="h-7 px-3 text-[10px] rounded-none border-line font-bold">DECLINE</Button>
                                  </div>
                                ) : (
                                   <div className="hd-mono text-[9px] opacity-40 italic">
                                     {swap.status === 'completed' ? 'STABILIZED' : 'LOCKED_FOR_REVIEW'}
                                   </div>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                          {incomingSwaps.filter(s => s.status === 'pending' || s.status === 'accepted' || s.status === 'completed' || s.status === 'approved').length === 0 && (
                            <TableRow><TableCell colSpan={4} className="text-center py-20 hd-mono text-[10px] opacity-40">NO_ACTIVE_INCOMING_LOGISTICS</TableCell></TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {swapSubView === 'outgoing' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="hd-label">Log of Your Outbound Flow</div>
                      <div className="hd-mono text-[9px] opacity-40 uppercase">Tracking requested shift transfers</div>
                    </div>
                    <div className="hd-border overflow-hidden">
                      <Table>
                        <TableHeader className="bg-bg">
                          <TableRow className="hover:bg-transparent border-line">
                            <TableHead className="hd-label">Target Colleague</TableHead>
                            <TableHead className="hd-label">Shift Details</TableHead>
                            <TableHead className="hd-label">Request Status</TableHead>
                            <TableHead className="hd-label text-right">Last Update</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {mySwaps
                            .filter(s => s.status === 'pending' || s.status === 'accepted' || s.status === 'completed' || s.status === 'approved')
                            .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                            .map(swap => (
                            <TableRow key={swap.id} className={`border-line ${swap.status === 'pending' ? 'bg-yellow-50/20' : ''}`}>
                              <TableCell className="hd-mono text-[10px] space-y-0.5">
                                <div className="opacity-40 uppercase">FROM: {profile.displayName || profile.username || 'You'}</div>
                                <div className="font-bold underline">SHIFT: {swap.shiftDate} // {swap.shiftTime} ({swap.shiftType})</div>
                                <div className="font-bold text-accent uppercase mt-1">TO: {swap.receiverName}</div>
                                <div className={!swap.targetShiftDate ? 'opacity-40 italic' : 'font-bold'}>
                                  RETURN SHIFT REQUESTED: {!swap.targetShiftDate ? 'None (One-way transfer)' : `${swap.targetShiftDate} // ${swap.targetShiftTime} (${swap.targetShiftType})`}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge className={`rounded-none uppercase text-[9px] hd-mono font-bold flex items-center gap-1 ${
                                  swap.status === 'pending' ? 'bg-yellow-200 text-yellow-900 border border-yellow-400' :
                                  swap.status === 'accepted' ? 'bg-blue-100 text-blue-700' :
                                  (swap.status === 'approved' || swap.status === 'completed') ? 'bg-green-100 text-green-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {swap.status === 'pending' && <><Clock className="h-2 w-2" /> PENDING_COLLEAGUE_RESPONSE</>}
                                  {swap.status === 'accepted' && 'AWAITING_MANAGER_VALIDATION'}
                                  {(swap.status === 'approved' || swap.status === 'completed') && <><Check className="h-2.5 w-2.5" /> APPROVED_BY_MANAGER</>}
                                  {swap.status === 'rejected' && 'REJECTED'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right hd-mono text-[9px] opacity-50">
                                {format(new Date(swap.createdAt), 'MM-dd HH:mm')}
                              </TableCell>
                            </TableRow>
                          ))}
                          {mySwaps.filter(s => s.status === 'pending' || s.status === 'accepted' || s.status === 'completed' || s.status === 'approved').length === 0 && (
                            <TableRow><TableCell colSpan={4} className="text-center py-20 hd-mono text-[10px] opacity-40">OUTBOUND_FLOW_EMPTY</TableCell></TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {swapSubView === 'history' && (
                  <div className="space-y-4">
                    <div className="hd-label opacity-60">Full Lifecycle Archive</div>
                    <div className="hd-border overflow-hidden opacity-60">
                      <Table>
                        <TableHeader className="bg-bg">
                          <TableRow className="hover:bg-transparent border-line">
                            <TableHead className="hd-label">Relationship</TableHead>
                            <TableHead className="hd-label">Shift</TableHead>
                            <TableHead className="hd-label text-right">Final Outcome</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...mySwaps, ...incomingSwaps]
                            .filter(s => s.status === 'completed' || s.status === 'rejected')
                            .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                            .map(swap => (
                            <TableRow key={swap.id} className="border-line font-mono text-[10px]">
                              <TableCell>
                                {swap.requesterId === profile.uid ? `TO: ${swap.receiverName}` : `FROM: ${swap.requesterName}`}
                              </TableCell>
                              <TableCell className="opacity-70 space-y-0.5">
                                <div className="flex items-center gap-1">
                                  <span>{swap.shiftDate} ({swap.shiftType})</span>
                                  <ArrowLeftRight className="h-2 w-2 opacity-30" />
                                  {swap.targetShiftDate ? (
                                    <span className="text-accent font-bold">{swap.targetShiftDate} ({swap.targetShiftType})</span>
                                  ) : (
                                    <span className="italic opacity-60">None (One-way transfer)</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <Badge className={`rounded-none uppercase text-[8px] hd-mono font-bold ${swap.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                  {swap.status === 'completed' ? 'APPROVED_BY_MANAGER' : 'REJECTED'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                          {[...mySwaps, ...incomingSwaps].filter(s => s.status === 'completed' || s.status === 'rejected').length === 0 && (
                            <TableRow><TableCell colSpan={3} className="text-center py-6 hd-mono text-[9px] opacity-40">ARCHIVE_EMPTY</TableCell></TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Right Sidebar: Break Logic */}
      <aside className="hd-border-l bg-ink text-bg p-5 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-2">
          <h3 className="hd-serif hd-italic text-lg">Daily Break Logic</h3>
          <Coffee className="h-4 w-4 text-accent" />
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
          {todayBreaks.map(bp => (
            <div key={bp.id} className={`p-3 border-l-2 ${bp.employeeId === profile.email ? 'border-accent bg-white/10' : 'border-white/20'} space-y-1`}>
              <div className="flex justify-between items-baseline">
                <div className={`hd-mono text-[10px] font-bold uppercase ${bp.employeeId === profile.email ? 'text-accent' : 'text-white/60'}`}>
                  {bp.breakStartTime} - {bp.breakEndTime}
                </div>
                {bp.employeeId === profile.email && <Badge className="bg-accent text-white text-[8px] h-3 px-1 rounded-none">YOU</Badge>}
              </div>
              <div className="text-[12px] font-medium">{bp.employeeName}</div>
              {bp.originalTime && (
                <div className="text-[10px] line-through opacity-40 hd-mono">PREV: {bp.originalTime}</div>
              )}
              {bp.reason && (
                <div className="text-[10px] text-accent hd-mono italic">REASON: {bp.reason}</div>
              )}
            </div>
          ))}
          {todayBreaks.length === 0 && (
            <div className="hd-mono text-[10px] opacity-40 text-center py-10">NO_BREAK_DATA_PUBLISHED</div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-white/10 hd-mono text-[9px] opacity-60 space-y-1 leading-tight">
          <div>* BREAK_PLAN v1.2_STABILIZED</div>
          <div>* LAST_UPDATE: {format(new Date(), 'HH:mm')}</div>
          <div>* PROTOCOL: TIER_2_PRIORITY</div>
        </div>
      </aside>

      <Dialog open={isSwapDialogOpen} onOpenChange={setIsSwapDialogOpen}>
        <DialogContent className="rounded-none border-line">
          <DialogHeader>
            <DialogTitle className="hd-serif uppercase">Initiate Shift Swap</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
                <Label className="hd-label">1. Select Target Colleague</Label>
                <Select onValueChange={(val) => {
                  setSelectedColleague(val);
                  setSelectedShift(null);
                  setSelectedTargetShift(null);
                }} value={selectedColleague}>
                    <SelectTrigger className="rounded-none hd-mono text-xs border-line">
                        <SelectValue placeholder="SELECT_EMPLOYEE" />
                    </SelectTrigger>
                    <SelectContent className="rounded-none border-line">
                        {employees.filter(e => e.uid !== profile.uid).map(e => (
                            <SelectItem key={e.uid} value={e.uid}>{e.displayName || e.username}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {selectedColleague && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                <Label className="hd-label">2. Select Colleague's Shift (to receive)</Label>
                <Select onValueChange={(val) => {
                  if (val === 'none') {
                    setSelectedTargetShift(null);
                  } else {
                    const s = allShifts.find(x => x.id === val);
                    setSelectedTargetShift(s || null);
                  }
                  setSelectedShift(null); // Reset my shift when colleague shift changes
                }} value={selectedTargetShift?.id || (selectedTargetShift === null ? 'none' : undefined)}>
                  <SelectTrigger className="rounded-none hd-mono text-xs border-line bg-bg">
                    <SelectValue placeholder="CHOOSE_THEIR_SHIFT" />
                  </SelectTrigger>
                  <SelectContent className="rounded-none border-line">
                    <SelectItem value="none">NO_SPECIFIC_SHIFT_REQUESTED</SelectItem>
                    {allShifts
                      .filter(s => s.employeeUid === selectedColleague && s.date >= today)
                      .map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {format(parseISO(s.date), 'MMM dd')} - {s.startTime} ({s.type})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedTargetShift && (
              <div className="p-3 bg-accent/5 border border-accent/20 hd-mono text-[10px] space-y-1 animate-in fade-in slide-in-from-top-1">
                  <div className="font-bold text-accent uppercase">Requested Shift Info:</div>
                  <div>DATE: {format(parseISO(selectedTargetShift.date), 'EEEE, MMM dd')}</div>
                  <div>WINDOW: {selectedTargetShift.startTime} - {selectedTargetShift.endTime}</div>
                  <div>TYPE: {selectedTargetShift.type.toUpperCase()}</div>
              </div>
            )}

            {selectedColleague && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                <Label className="hd-label">3. Select Your Shift (my shift to be changed)</Label>
                <Select onValueChange={(val) => {
                  const s = myShifts.find(x => x.id === val);
                  setSelectedShift(s || null);
                }} value={selectedShift?.id}>
                  <SelectTrigger className="rounded-none hd-mono text-xs border-line">
                    <SelectValue placeholder={selectedTargetShift ? `CHOOSE_YOUR_${selectedTargetShift.type.toUpperCase()}_SHIFT` : "CHOOSE_FROM_SCHEDULE"} />
                  </SelectTrigger>
                  <SelectContent className="rounded-none border-line">
                    {myShifts
                      .filter(s => s.date >= today && (!selectedTargetShift || s.type === selectedTargetShift.type))
                      .map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {format(parseISO(s.date), 'MMM dd')} - {s.startTime} ({s.type})
                        </SelectItem>
                      ))}
                    {myShifts.filter(s => s.date >= today && (!selectedTargetShift || s.type === selectedTargetShift.type)).length === 0 && (
                      <div className="p-2 text-[9px] hd-mono opacity-40 text-center uppercase">
                        {selectedTargetShift ? `No matching ${selectedTargetShift.type} shifts found in your schedule` : "No shifts found"}
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
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
