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
import { Calendar, Clock, Coffee, Info, Bell, ArrowLeftRight, FileText, UserIcon, Plus } from 'lucide-react';
import { format, isAfter, parseISO, addMinutes, subDays, addDays } from 'date-fns';
import { toast } from 'sonner';

interface EmployeeDashboardProps {
  profile: UserProfile;
  notifications: AppNotification[];
}

type EmployeeView = 'schedule' | 'plan' | 'swaps';

export default function EmployeeDashboard({ profile, notifications }: EmployeeDashboardProps) {
  const [view, setView] = useState<EmployeeView>('schedule');
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
      console.log("Initiating swap transfer...", { shift: selectedShift, target: selectedColleague });
      
      const payload = {
        requesterId: profile.uid,
        requesterName: profile.displayName || profile.username || 'Applicant',
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
      toast.success(`Swap request sent to ${colleague.displayName || colleague.username}`);
      setIsSwapDialogOpen(false);
      setSelectedColleague('');
    } catch (e) { 
      console.error("Swap initiation failed:", e);
      handleFirestoreError(e, OperationType.CREATE, 'swaps'); 
    }
  };

  const handleAcceptSwap = async (swap: SwapRequest) => {
    try {
      await updateDoc(doc(db, 'swaps', swap.id), { status: 'accepted' });
      toast.success("Request accepted. Waiting for manager approval.");
    } catch (e) { 
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
              <div className="hd-label text-accent">Pending Swap Requests</div>
              <div className="space-y-2">
                {incomingSwaps.filter(s => s.status === 'pending').map(s => (
                  <div key={s.id} className="hd-card p-2 text-[10px] hd-mono space-y-2">
                    <div>FROM: {s.requesterName}</div>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => handleAcceptSwap(s)} className="h-6 px-2 text-[9px] rounded-none">APPROVE</Button>
                      <Button size="sm" variant="outline" onClick={() => updateDoc(doc(db, 'swaps', s.id), { status: 'rejected' })} className="h-6 px-2 text-[9px] rounded-none border-line">DENY</Button>
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
            {view === 'schedule' && (
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
              <div className="hd-border overflow-hidden">
                <Table>
                  <TableHeader className="bg-bg/80">
                    <TableRow className="hover:bg-transparent border-line">
                      <TableHead className="hd-label py-2">Employee</TableHead>
                      <TableHead className="hd-label py-2">Date</TableHead>
                      <TableHead className="hd-label py-2">Shift Window</TableHead>
                      <TableHead className="hd-label py-2 text-right">Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allShifts
                      .filter(s => {
                        const d = new Date(s.date);
                        return d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
                      })
                      .map(s => (
                        <TableRow key={s.id} className={`border-line hd-mono text-[11px] ${s.employeeUid === profile.uid ? 'bg-accent/5 font-bold' : ''}`}>
                          <TableCell className="py-2">{s.employeeName}</TableCell>
                          <TableCell className="py-2 opacity-70">{format(parseISO(s.date), 'MMM dd (EEE)')}</TableCell>
                          <TableCell className="py-2 text-accent">{s.startTime} - {s.endTime}</TableCell>
                          <TableCell className="py-2 text-right text-[10px] uppercase opacity-50">{s.customerCareRole}</TableCell>
                        </TableRow>
                      ))}
                    {allShifts.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center py-20 hd-mono text-xs opacity-30 italic">NO_SHIFTS_PUBLISHED</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {view === 'swaps' && (
            <div className="space-y-8">
              <div className="flex justify-between items-center bg-bg/50 p-4 hd-border">
                <div className="space-y-1">
                  <div className="hd-label">Swap Protocol</div>
                  <div className="text-[10px] opacity-60">INITIATE A NEW SHIFT TRANSFER REQUEST</div>
                </div>
                <Button onClick={() => setIsSwapDialogOpen(true)} className="rounded-none hd-mono text-xs gap-2">
                  <Plus className="h-4 w-4" /> INITIATE_SWAP_REQUEST
                </Button>
              </div>

              <div className="space-y-4">
                <div className="hd-label">Incoming Requests (Awaiting Your Action)</div>
                <div className="hd-border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-bg">
                      <TableRow className="hover:bg-transparent border-line">
                        <TableHead className="hd-label">Requester</TableHead>
                        <TableHead className="hd-label">Shift Details</TableHead>
                        <TableHead className="hd-label text-right">Operations</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {incomingSwaps.filter(s => s.status === 'pending' || s.status === 'accepted').map(swap => (
                        <TableRow key={swap.id} className={`border-line ${swap.status === 'pending' ? 'bg-yellow-50/40 border-l-4 border-l-yellow-600' : ''}`}>
                          <TableCell className="hd-mono text-xs font-bold">{swap.requesterName}</TableCell>
                          <TableCell className="hd-mono text-[10px]">
                            {swap.shiftDate ? format(parseISO(swap.shiftDate), 'MMM dd') : 'N/A'} // {swap.shiftTime || 'N/A'}
                          </TableCell>
                          <TableCell className="text-right">
                            {swap.status === 'pending' ? (
                              <div className="flex justify-end gap-2">
                                <Button size="sm" onClick={() => handleAcceptSwap(swap)} className="h-7 px-3 text-[10px] rounded-none bg-accent hover:bg-accent/90 text-white">APPROVE</Button>
                                <Button size="sm" variant="outline" onClick={() => updateDoc(doc(db, 'swaps', swap.id), { status: 'rejected' })} className="h-7 px-3 text-[10px] rounded-none border-line">DENY</Button>
                              </div>
                            ) : (
                               <Badge className="rounded-none uppercase text-[9px] hd-mono bg-blue-100 text-blue-700 font-bold">
                                 AWAITING_VALIDATION
                               </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {incomingSwaps.filter(s => s.status === 'pending' || s.status === 'accepted').length === 0 && (
                        <TableRow><TableCell colSpan={3} className="text-center py-10 hd-mono text-[10px] opacity-40">NO_ACTIVE_INCOMING_REQUESTS</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="space-y-4">
                <div className="hd-label">Sent Requests (Outbound Queue)</div>
                <div className="hd-border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-bg">
                      <TableRow className="hover:bg-transparent border-line">
                        <TableHead className="hd-label">Target Colleague</TableHead>
                        <TableHead className="hd-label">Current Status</TableHead>
                        <TableHead className="hd-label text-right">Created At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mySwaps.filter(s => s.status === 'pending' || s.status === 'accepted').map(swap => (
                        <TableRow key={swap.id} className={`border-line ${swap.status === 'pending' ? 'bg-yellow-50/40 border-l-4 border-l-yellow-600' : ''}`}>
                          <TableCell className="hd-mono text-xs font-bold">{swap.receiverName}</TableCell>
                          <TableCell>
                            <Badge className={`rounded-none uppercase text-[9px] hd-mono ${swap.status === 'pending' ? 'bg-yellow-100 text-yellow-700 font-bold' : 'bg-blue-100 text-blue-700 font-bold'}`}>
                              {swap.status === 'pending' ? 'PENDING_RESPONSE' : 'AWAITING_VALIDATION'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right hd-mono text-[9px] opacity-50">
                            {format(new Date(swap.createdAt), 'yyyy-MM-dd HH:mm')}
                          </TableCell>
                        </TableRow>
                      ))}
                      {mySwaps.filter(s => s.status === 'pending' || s.status === 'accepted').length === 0 && (
                        <TableRow><TableCell colSpan={3} className="text-center py-10 hd-mono text-[10px] opacity-40">NO_ACTIVE_OUTBOUND_REQUESTS</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="space-y-4">
                <div className="hd-label">Past Requests (History)</div>
                <div className="hd-border overflow-hidden opacity-60">
                  <Table>
                    <TableHeader className="bg-bg">
                      <TableRow className="hover:bg-transparent border-line">
                        <TableHead className="hd-label">Colleague</TableHead>
                        <TableHead className="hd-label">Shift</TableHead>
                        <TableHead className="hd-label text-right">Final Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...mySwaps, ...incomingSwaps]
                        .filter(s => s.status === 'completed' || s.status === 'rejected')
                        .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                        .map(swap => (
                        <TableRow key={swap.id} className="border-line">
                          <TableCell className="hd-mono text-xs">
                            {swap.requesterId === profile.uid ? `TO: ${swap.receiverName}` : `FROM: ${swap.requesterName}`}
                          </TableCell>
                          <TableCell className="hd-mono text-[9px]">
                            {swap.shiftDate} // {swap.shiftTime}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge className={`rounded-none uppercase text-[8px] hd-mono ${swap.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {swap.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {[...mySwaps, ...incomingSwaps].filter(s => s.status === 'completed' || s.status === 'rejected').length === 0 && (
                        <TableRow><TableCell colSpan={3} className="text-center py-6 hd-mono text-[9px] opacity-40">HISTORY_EMPTY</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
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
                <Label className="hd-label">Select Your Shift</Label>
                <Select onValueChange={(val) => {
                  const s = myShifts.find(x => x.id === val);
                  setSelectedShift(s || null);
                }} value={selectedShift?.id}>
                    <SelectTrigger className="rounded-none hd-mono text-xs border-line bg-bg">
                        <SelectValue placeholder="CHOOSE_FROM_SCHEDULE" />
                    </SelectTrigger>
                    <SelectContent className="rounded-none border-line">
                        {myShifts.filter(s => s.date >= today).map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              {format(parseISO(s.date), 'MMM dd')} - {s.startTime} ({s.type})
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {selectedShift && (
              <div className="p-3 bg-accent/5 border border-accent/20 hd-mono text-[10px] space-y-1">
                  <div className="font-bold text-accent uppercase">Shift Metadata:</div>
                  <div>DATE: {format(parseISO(selectedShift.date), 'EEEE, MMM dd')}</div>
                  <div>WINDOW: {selectedShift.startTime} - {selectedShift.endTime}</div>
                  <div>ROLE: {selectedShift.customerCareRole}</div>
              </div>
            )}
            <div className="space-y-2">
                <Label className="hd-label">Select Target Colleague</Label>
                <Select onValueChange={setSelectedColleague} value={selectedColleague}>
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
