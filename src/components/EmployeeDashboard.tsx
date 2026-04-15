import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, where, orderBy, addDoc, doc, updateDoc } from 'firebase/firestore';
import { Shift, BreakPlan, UserProfile, SwapRequest, AppNotification } from '../types';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, Coffee, Info, Bell, ArrowLeftRight, FileText } from 'lucide-react';
import { format, isAfter, parseISO, addMinutes } from 'date-fns';
import { toast } from 'sonner';

interface EmployeeDashboardProps {
  profile: UserProfile;
  notifications: AppNotification[];
}

export default function EmployeeDashboard({ profile, notifications }: EmployeeDashboardProps) {
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [todayBreaks, setTodayBreaks] = useState<BreakPlan[]>([]);
  const [mySwaps, setMySwaps] = useState<SwapRequest[]>([]);
  const [incomingSwaps, setIncomingSwaps] = useState<SwapRequest[]>([]);
  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    const unsubShifts = onSnapshot(query(collection(db, 'shifts'), where('employeeId', '==', profile.email), orderBy('date', 'desc')), (s) => {
      setMyShifts(s.docs.map(d => ({ id: d.id, ...d.data() } as Shift)));
    });
    const unsubBreaks = onSnapshot(query(collection(db, 'breakPlans'), where('date', '==', today), orderBy('breakStartTime', 'asc')), (s) => {
      setTodayBreaks(s.docs.map(d => ({ id: d.id, ...d.data() } as BreakPlan)));
    });
    const unsubSwaps = onSnapshot(query(collection(db, 'swaps'), where('requesterId', '==', profile.uid)), (s) => {
      setMySwaps(s.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest)));
    });
    const unsubIncoming = onSnapshot(query(collection(db, 'swaps'), where('receiverId', '==', profile.email)), (s) => {
      setIncomingSwaps(s.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest)));
    });

    return () => {
      unsubShifts();
      unsubBreaks();
      unsubSwaps();
      unsubIncoming();
    };
  }, [profile.email, profile.uid, today]);

  // Break Reminders
  useEffect(() => {
    const checkBreaks = () => {
      const now = new Date();
      todayBreaks.forEach(bp => {
        if (bp.employeeId === profile.email) {
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

  const handleRequestSwap = async (shift: Shift) => {
    const receiverEmail = prompt("Enter the email of the employee you want to swap with:");
    if (!receiverEmail) return;

    try {
      await addDoc(collection(db, 'swaps'), {
        requesterId: profile.uid,
        requesterName: profile.displayName,
        receiverId: receiverEmail,
        receiverName: receiverEmail.split('@')[0],
        shiftId: shift.id,
        type: 'shift',
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      toast.success("Swap request sent to colleague");
    } catch (e) { toast.error("Failed to send swap request"); }
  };

  const handleAcceptSwap = async (swap: SwapRequest) => {
    try {
      await updateDoc(doc(db, 'swaps', swap.id), { status: 'accepted' });
      toast.success("Request accepted. Waiting for manager approval.");
    } catch (e) { toast.error("Failed to accept request"); }
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
            <div className="hd-label">Personal Workspace</div>
            <nav className="space-y-1">
              <div className="w-full flex items-center gap-3 px-3 py-2 text-xs hd-mono font-bold text-accent bg-accent/5">
                <Clock className="h-4 w-4" /> MY_SHIFTS <span className="ml-auto bg-accent text-white px-1 py-0.5 text-[8px]">ACTIVE</span>
              </div>
              <div className="w-full flex items-center gap-3 px-3 py-2 text-xs hd-mono font-bold hover:bg-ink/5 cursor-pointer">
                <ArrowLeftRight className="h-4 w-4" /> SWAP_LOGS
              </div>
            </nav>
          </div>

          {incomingSwaps.filter(s => s.status === 'pending').length > 0 && (
            <div className="space-y-3">
              <div className="hd-label text-accent">Pending Colleague Swaps</div>
              <div className="space-y-2">
                {incomingSwaps.filter(s => s.status === 'pending').map(s => (
                  <div key={s.id} className="hd-card p-2 text-[10px] hd-mono space-y-2">
                    <div>FROM: {s.requesterName}</div>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => handleAcceptSwap(s)} className="h-6 px-2 text-[9px] rounded-none">ACCEPT</Button>
                      <Button size="sm" variant="outline" onClick={() => updateDoc(doc(db, 'swaps', s.id), { status: 'rejected' })} className="h-6 px-2 text-[9px] rounded-none border-line">DECLINE</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="hd-label">System Notifications</div>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {notifications.filter(n => !n.read).map(n => (
                <div key={n.id} className="text-[10px] hd-mono border-l-2 border-accent pl-2 py-1 bg-accent/5 cursor-pointer" onClick={() => markNotificationRead(n.id)}>
                  <div className="font-bold uppercase">{n.title}</div>
                  <div className="opacity-70 truncate">{n.message}</div>
                </div>
              ))}
              {notifications.filter(n => !n.read).length === 0 && (
                <div className="text-[9px] hd-mono opacity-40 text-center py-4">NO_NEW_ALERTS</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-auto pt-4 hd-border-t">
          <div className="hd-label mb-2">Month Overview</div>
          <div className="grid grid-cols-7 gap-1 hd-mono text-[9px]">
            {Array.from({length: 28}).map((_, i) => (
              <div key={i} className={`p-1 text-center ${i === 11 ? 'bg-ink text-bg' : 'bg-ink/5'}`}>
                {String(i + 1).padStart(2, '0')}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Center Content */}
      <section className="overflow-y-auto bg-white">
        <div className="hd-border-b px-6 py-4 flex justify-between items-baseline sticky top-0 bg-white z-10">
          <h2 className="text-xl hd-serif uppercase tracking-tight">Daily Shift Schedule</h2>
          <div className="hd-mono text-[11px] text-muted">
            {format(new Date(), 'EEEE // MMM dd, yyyy')}
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="hd-card">
            <div className="hd-label mb-4 flex justify-between">
              <span>Primary Operational Shifts</span>
              <span>REF: CC-304-X</span>
            </div>
            <div className="space-y-0">
              {myShifts.filter(s => s.date === today).map(s => (
                <div key={s.id} className="hd-table-row border-line">
                  <div className="flex items-center gap-4">
                    <div className="hd-mono text-sm font-bold w-20">{s.startTime}</div>
                    <div className="text-sm font-bold">{s.customerCareRole}: Inbound Queue</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-[10px] hd-mono uppercase text-accent font-bold">ACTIVE</div>
                    <Button variant="ghost" size="icon" onClick={() => handleRequestSwap(s)} className="h-6 w-6">
                      <ArrowLeftRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
              {myShifts.filter(s => s.date === today).length === 0 && (
                <div className="py-10 text-center hd-mono text-xs text-muted">NO_SHIFTS_LOGGED_FOR_TODAY</div>
              )}
            </div>
          </div>

          <div className="hd-card">
            <div className="hd-label mb-4">Upcoming Week Summary</div>
            <div className="grid grid-cols-3 gap-4">
              {myShifts.filter(s => s.date > today).slice(0, 3).map(s => (
                <div key={s.id} className="bg-bg p-3 hd-border hd-mono text-[10px] space-y-1">
                  <div className="font-bold text-accent">{format(parseISO(s.date), 'EEE: MM/dd')}</div>
                  <div>{s.startTime} - {s.endTime}</div>
                  <div className="opacity-60 uppercase">{s.customerCareRole}</div>
                </div>
              ))}
            </div>
          </div>
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
    </div>
  );
}
