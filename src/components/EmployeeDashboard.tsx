import { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, onSnapshot, query, where, orderBy,
  addDoc, doc, updateDoc, getDoc, getDocs, runTransaction
} from 'firebase/firestore';
import { Shift, UserProfile, SwapRequest } from '../types';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Clock, ArrowLeftRight, Plus, Loader2 } from 'lucide-react';
import { format, parseISO, startOfWeek } from 'date-fns';
import { toast } from 'sonner';

interface EmployeeDashboardProps {
  profile: UserProfile;
}

export default function EmployeeDashboard({ profile }: EmployeeDashboardProps) {
  const [view, setView] = useState<'schedule' | 'swaps'>('schedule');
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<UserProfile[]>([]);
  const [mySwaps, setMySwaps] = useState<SwapRequest[]>([]);
  const [incomingSwaps, setIncomingSwaps] = useState<SwapRequest[]>([]);

  // Swap dialog state
  const [isSwapDialogOpen, setIsSwapDialogOpen] = useState(false);
  const [selectedColleague, setSelectedColleague] = useState<string>('');
  const [selectedTargetShift, setSelectedTargetShift] = useState<Shift | null>(null);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [colleagueShifts, setColleagueShifts] = useState<Shift[]>([]);
  const [loadingColleagueShifts, setLoadingColleagueShifts] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    const unsubShifts = onSnapshot(
      query(collection(db, 'shifts'), where('employeeUid', '==', profile.uid), orderBy('date', 'asc')),
      (s) => setMyShifts(s.docs.map(d => ({ id: d.id, ...d.data() } as Shift)))
    );
    // Listen for swaps where I am the requester
    const unsubSwaps = onSnapshot(
      query(collection(db, 'swaps'), where('requesterUid', '==', profile.uid)),
      (s) => setMySwaps(s.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest)))
    );
    // Listen for swaps where I am the receiver
    const unsubIncoming = onSnapshot(
      query(collection(db, 'swaps'), where('receiverUid', '==', profile.uid)),
      (s) => setIncomingSwaps(s.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest)))
    );
    const unsubEmployees = onSnapshot(
      collection(db, 'users'),
      (s) => setEmployees(s.docs.map(d => d.data() as UserProfile))
    );
    return () => { unsubShifts(); unsubSwaps(); unsubIncoming(); unsubEmployees(); };
  }, [profile.uid]);

  // Fetch colleague shifts on-demand (not a global subscription — privacy + efficiency)
  const handleColleagueSelect = async (uid: string) => {
    setSelectedColleague(uid);
    setSelectedTargetShift(null);
    setSelectedShift(null);
    setColleagueShifts([]);
    if (!uid) return;

    setLoadingColleagueShifts(true);
    try {
      const fromDate = format(startOfWeek(new Date()), 'yyyy-MM-dd');
      const snap = await getDocs(query(
        collection(db, 'shifts'),
        where('employeeUid', '==', uid),
        where('date', '>=', fromDate),
        orderBy('date', 'asc')
      ));
      setColleagueShifts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Shift)));
    } catch (e) {
      console.error(e);
      toast.error('Could not load colleague\'s shifts');
    } finally {
      setLoadingColleagueShifts(false);
    }
  };

  const handleRequestSwap = async () => {
    if (!selectedShift || !selectedColleague) {
      toast.error("Please select both a shift and a colleague");
      return;
    }

    // Enforce late-shift rule on the client side (also enforced server-side in transaction)
    if (selectedShift.type === 'late') {
      const targetType = selectedTargetShift?.type;
      if (targetType !== 'late' && targetType !== 'special') {
        toast.error("Rule violation: Late shifts can ONLY be traded for Late or Special shifts.");
        return;
      }
    }
    if (selectedTargetShift?.type === 'late') {
      if (selectedShift.type !== 'late' && selectedShift.type !== 'special') {
        toast.error("Rule violation: A late shift can ONLY be traded for Late or Special shifts.");
        return;
      }
    }

    const colleague = employees.find(e => e.uid === selectedColleague);
    if (!colleague) { toast.error("Colleague not found"); return; }

    try {
      // Guard: check that my shift doesn't already have an active swap
      const shiftSnap = await getDoc(doc(db, 'shifts', selectedShift.id));
      if (shiftSnap.data()?.activeSwapId) {
        toast.error("This shift already has a pending swap request. Cancel it first.");
        return;
      }

      await runTransaction(db, async (tx) => {
        const swapRef = doc(collection(db, 'swaps'));
        tx.set(swapRef, {
          requesterUid:    profile.uid,
          requesterId:     profile.uid,   // kept for backwards compat
          requesterName:   profile.displayName,
          receiverId:      colleague.uid,
          receiverUid:     colleague.uid,
          receiverName:    colleague.displayName,
          shiftId:         selectedShift.id,
          shiftDate:       selectedShift.date,
          shiftTime:       `${selectedShift.startTime}-${selectedShift.endTime}`,
          shiftType:       selectedShift.type,
          targetShiftId:   selectedTargetShift?.id ?? null,
          targetShiftDate: selectedTargetShift?.date ?? null,
          targetShiftTime: selectedTargetShift ? `${selectedTargetShift.startTime}-${selectedTargetShift.endTime}` : null,
          targetShiftType: selectedTargetShift?.type ?? null,
          type:            'shift',
          status:          'pending',
          createdAt:       new Date().toISOString()
        });
        // Mark the shift as having an active swap
        tx.update(doc(db, 'shifts', selectedShift.id), { activeSwapId: swapRef.id });
      });

      toast.success("Swap request sent!");
      setIsSwapDialogOpen(false);
      setSelectedShift(null);
      setSelectedColleague('');
      setSelectedTargetShift(null);
      setColleagueShifts([]);
    } catch (e) {
      console.error(e);
      toast.error("Failed to create swap request");
    }
  };

  const handleRespondToSwap = async (swap: SwapRequest, accept: boolean) => {
    try {
      await updateDoc(doc(db, 'swaps', swap.id), {
        status: accept ? 'accepted' : 'rejected'
      });
      if (!accept && swap.shiftId) {
        // Clear the activeSwapId from the requester's shift when rejected
        await updateDoc(doc(db, 'shifts', swap.shiftId), { activeSwapId: null });
      }
      toast.success(accept ? "Swap accepted — awaiting manager approval" : "Swap rejected");
    } catch (e) {
      console.error(e);
      toast.error("Failed to respond to swap");
    }
  };

  return (
    <div className="h-full grid grid-cols-[240px_1fr]">
      {/* Sidebar */}
      <aside className="border-r p-5 flex flex-col gap-8 bg-white">
        <div className="space-y-3">
          <div className="text-xs font-bold uppercase text-gray-500">My Workspace</div>
          <nav className="space-y-1">
            <button
              onClick={() => setView('schedule')}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-bold rounded-none transition ${view === 'schedule' ? 'bg-black text-white' : 'hover:bg-gray-100'}`}
            >
              <Clock className="h-4 w-4" /> My Schedule
            </button>
            <button
              onClick={() => setView('swaps')}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-bold rounded-none transition ${view === 'swaps' ? 'bg-black text-white' : 'hover:bg-gray-100'}`}
            >
              <ArrowLeftRight className="h-4 w-4" /> Swap Requests
              {incomingSwaps.filter(s => s.status === 'pending').length > 0 && (
                <span className="ml-auto bg-red-500 text-white px-2 py-0.5 text-[10px] rounded-none">
                  {incomingSwaps.filter(s => s.status === 'pending').length}
                </span>
              )}
            </button>
          </nav>
        </div>
        <Button
          onClick={() => { setIsSwapDialogOpen(true); setSelectedColleague(''); setSelectedShift(null); setSelectedTargetShift(null); setColleagueShifts([]); }}
          className="w-full rounded-none bg-black text-white text-xs gap-2"
        >
          <Plus className="h-3 w-3" /> INITIATE SWAP
        </Button>
      </aside>

      {/* Main Content */}
      <section className="overflow-y-auto bg-gray-50 p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold uppercase">{view === 'schedule' ? 'Personal Schedule' : 'Swap Management'}</h2>
        </div>

        {view === 'schedule' && (
          <div className="bg-white border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myShifts.map(s => (
                  <TableRow key={s.id} className={s.date === today ? 'bg-blue-50' : ''}>
                    <TableCell className="font-bold text-xs">{format(parseISO(s.date), 'MMM dd (EEE)')}</TableCell>
                    <TableCell className="text-xs">{s.startTime} - {s.endTime}</TableCell>
                    <TableCell>
                      <Badge className="uppercase text-[10px] rounded-none">{s.type}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {s.activeSwapId ? <span className="text-orange-600 font-semibold">Swap pending</span> : '—'}
                    </TableCell>
                  </TableRow>
                ))}
                {myShifts.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-xs text-gray-400">No shifts assigned yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {view === 'swaps' && (
          <div className="space-y-6">
            <div>
              <h3 className="font-bold text-sm uppercase mb-3">Incoming Requests</h3>
              <div className="grid gap-3">
                {incomingSwaps.filter(s => s.status === 'pending').map(s => (
                  <div key={s.id} className="bg-white p-4 border">
                    <p className="text-xs mb-3">
                      <strong>{s.requesterName}</strong> wants to trade their{' '}
                      <strong>{s.shiftType}</strong> shift on <strong>{s.shiftDate}</strong>
                      {s.targetShiftDate ? (
                        <> for your <strong>{s.targetShiftType}</strong> on <strong>{s.targetShiftDate}</strong></>
                      ) : (
                        <> (one-way transfer — you receive, they give up their shift)</>
                      )}.
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleRespondToSwap(s, true)} className="bg-black text-white rounded-none text-xs">ACCEPT</Button>
                      <Button size="sm" variant="outline" onClick={() => handleRespondToSwap(s, false)} className="rounded-none text-xs">REJECT</Button>
                    </div>
                  </div>
                ))}
                {incomingSwaps.filter(s => s.status === 'pending').length === 0 && (
                  <p className="text-xs text-gray-500">No incoming requests.</p>
                )}
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="font-bold text-sm uppercase mb-3">Your Requests</h3>
              <div className="grid gap-3">
                {mySwaps.map(s => (
                  <div key={s.id} className="bg-white p-4 border flex justify-between items-center">
                    <div className="text-xs">
                      To <strong>{s.receiverName}</strong> — {s.shiftType} on {s.shiftDate}
                      {s.targetShiftDate && <> ↔ {s.targetShiftType} on {s.targetShiftDate}</>}
                    </div>
                    <Badge className={`text-[10px] rounded-none uppercase ${
                      s.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      s.status === 'accepted' ? 'bg-blue-100 text-blue-800' :
                      s.status === 'completed' ? 'bg-green-100 text-green-800' :
                      'bg-red-100 text-red-800'
                    }`}>{s.status}</Badge>
                  </div>
                ))}
                {mySwaps.length === 0 && <p className="text-xs text-gray-500">No active requests.</p>}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Swap Dialog */}
      <Dialog open={isSwapDialogOpen} onOpenChange={setIsSwapDialogOpen}>
        <DialogContent className="rounded-none border">
          <DialogHeader><DialogTitle className="uppercase">Initiate Swap</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">

            <div className="space-y-2">
              <Label>1. Select Colleague</Label>
              <Select onValueChange={handleColleagueSelect} value={selectedColleague}>
                <SelectTrigger><SelectValue placeholder="Select Colleague" /></SelectTrigger>
                <SelectContent>
                  {employees.filter(e => e.uid !== profile.uid).map(e => (
                    <SelectItem key={e.uid} value={e.uid}>{e.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedColleague && (
              <div className="space-y-2">
                <Label>2. Select Their Shift (You Receive)</Label>
                {loadingColleagueShifts ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading shifts...
                  </div>
                ) : (
                  <Select onValueChange={(val) => setSelectedTargetShift(colleagueShifts.find(x => x.id === val) || null)} value={selectedTargetShift?.id ?? ''}>
                    <SelectTrigger><SelectValue placeholder="Choose Their Shift (optional)" /></SelectTrigger>
                    <SelectContent>
                      {colleagueShifts.map(s => (
                        <SelectItem key={s.id} value={s.id} disabled={!!s.activeSwapId}>
                          {s.date} — {s.type} ({s.startTime}-{s.endTime}){s.activeSwapId ? ' [swap pending]' : ''}
                        </SelectItem>
                      ))}
                      {colleagueShifts.length === 0 && (
                        <SelectItem value="__none__" disabled>No upcoming shifts found</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {selectedColleague && (
              <div className="space-y-2">
                <Label>3. Select Your Shift (You Give Away)</Label>
                <Select onValueChange={(val) => setSelectedShift(myShifts.find(x => x.id === val) || null)} value={selectedShift?.id ?? ''}>
                  <SelectTrigger><SelectValue placeholder="Choose Your Shift" /></SelectTrigger>
                  <SelectContent>
                    {myShifts.filter(s => s.date >= today).map(s => (
                      <SelectItem key={s.id} value={s.id} disabled={!!s.activeSwapId}>
                        {s.date} — {s.type} ({s.startTime}-{s.endTime}){s.activeSwapId ? ' [swap pending]' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedShift?.type === 'late' && selectedTargetShift && selectedTargetShift.type !== 'late' && selectedTargetShift.type !== 'special' && (
              <p className="text-xs text-red-600 font-bold bg-red-50 p-2 border border-red-200">
                ⚠ Late shifts can only be swapped with Late or Special shifts.
              </p>
            )}

          </div>
          <DialogFooter>
            <Button
              onClick={handleRequestSwap}
              disabled={!selectedShift || !selectedColleague}
              className="w-full bg-black text-white rounded-none"
            >
              SUBMIT REQUEST
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
