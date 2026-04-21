import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, orderBy, doc, updateDoc, writeBatch, runTransaction, getDoc } from 'firebase/firestore';
import { Shift, UserProfile, SwapRequest } from '../types';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Upload, Check, X, BarChart3, Clock } from 'lucide-react';
import { toast } from 'sonner';

interface ManagerDashboardProps {
  profile: UserProfile;
}

export default function ManagerDashboard({ profile }: ManagerDashboardProps) {
  const [view, setView] = useState<'upload' | 'swaps' | 'dashboard'>('upload');
  const [csvInput, setCsvInput] = useState('');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<UserProfile[]>([]);
  const [pendingSwaps, setPendingSwaps] = useState<SwapRequest[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importErrors, setImportErrors] = useState<{ row: number; reason: string }[]>([]);

  useEffect(() => {
    const unsubShifts = onSnapshot(query(collection(db, 'shifts'), orderBy('date', 'asc')), (s) => setShifts(s.docs.map(d => ({ id: d.id, ...d.data() } as Shift))));
    const unsubEmployees = onSnapshot(collection(db, 'users'), (s) => setEmployees(s.docs.map(d => d.data() as UserProfile)));
    const unsubSwaps = onSnapshot(query(collection(db, 'swaps'), orderBy('createdAt', 'desc')), (s) => setPendingSwaps(s.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest))));
    return () => { unsubShifts(); unsubEmployees(); unsubSwaps(); };
  }, []);

  const handleUploadCSV = async () => {
    if (!csvInput.trim()) { toast.error("Please paste CSV data"); return; }

    setIsProcessing(true);
    setImportErrors([]);
    try {
      const lines = csvInput.trim().split('\n');
      const header = lines[0].split(',').map(h => h.trim().toLowerCase());
      const errors: { row: number; reason: string }[] = [];
      const rows: { employee: UserProfile; date: string; type: string; start: string; end: string }[] = [];

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = lines[i].split(',').map(v => v.trim());
        const row: Record<string, string> = {};
        header.forEach((key, idx) => { row[key] = values[idx] || ''; });

        const employee = employees.find(e => e.displayName?.toLowerCase() === row.name?.toLowerCase());
        if (!employee) {
          errors.push({ row: i + 1, reason: `Unknown employee: "${row.name}"` });
          continue;
        }
        if (!row.date?.match(/^\d{4}-\d{2}-\d{2}$/)) {
          errors.push({ row: i + 1, reason: `Invalid date format: "${row.date}" (expected YYYY-MM-DD)` });
          continue;
        }
        if (!row.type) {
          errors.push({ row: i + 1, reason: `Missing shift type on row ${i + 1}` });
          continue;
        }
        rows.push({ employee, date: row.date, type: row.type, start: row.start, end: row.end });
      }

      // Fail-fast: abort entire import if any row has errors
      if (errors.length > 0) {
        setImportErrors(errors);
        toast.error(`Import rejected: ${errors.length} error(s). No shifts were saved.`);
        return;
      }

      // Use deterministic IDs to prevent duplicate imports
      const batch = writeBatch(db);
      for (const r of rows) {
        const shiftId = `${r.employee.uid}_${r.date}_${r.start.replace(':', '')}`;
        const shiftRef = doc(db, 'shifts', shiftId);
        batch.set(shiftRef, {
          employeeId: r.employee.uid,
          employeeUid: r.employee.uid,
          employeeName: r.employee.displayName,
          date: r.date,
          type: r.type,
          startTime: r.start,
          endTime: r.end,
          customerCareRole: '',
          activeSwapId: null,
          createdAt: new Date().toISOString()
        }, { merge: true });
      }
      await batch.commit();
      toast.success(`Uploaded ${rows.length} shifts`);
      setCsvInput('');
    } catch (e) {
      console.error(e);
      toast.error("Failed to upload CSV");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApproveSwap = async (swap: SwapRequest) => {
    try {
      if (!swap.targetShiftId) {
        // One-way transfer — just mark completed, no shift reassignment needed
        await updateDoc(doc(db, 'swaps', swap.id), {
          status: 'completed',
          completedAt: new Date().toISOString()
        });
        toast.success("One-way transfer approved");
        return;
      }

      await runTransaction(db, async (tx) => {
        const shiftARef = doc(db, 'shifts', swap.shiftId);
        const shiftBRef = doc(db, 'shifts', swap.targetShiftId!);

        const [shiftA, shiftB] = await Promise.all([tx.get(shiftARef), tx.get(shiftBRef)]);

        if (!shiftA.exists() || !shiftB.exists()) throw new Error('shift_missing');

        // Re-verify ownership at approval time (guards against race conditions)
        if (shiftA.data()!.employeeUid !== swap.requesterUid) throw new Error('shift_a_ownership_changed');
        if (shiftB.data()!.employeeUid !== swap.receiverUid)  throw new Error('shift_b_ownership_changed');

        // Enforce late-swap rule inside the transaction
        const typeA = shiftA.data()!.type as string;
        const typeB = shiftB.data()!.type as string;
        const lateTypes = ['late', 'special'];
        if (typeA === 'late' && !lateTypes.includes(typeB)) throw new Error('late_swap_rule');
        if (typeB === 'late' && !lateTypes.includes(typeA)) throw new Error('late_swap_rule');

        // Atomic swap of both shifts
        tx.update(shiftARef, {
          employeeId:   swap.receiverUid,
          employeeUid:  swap.receiverUid,
          employeeName: swap.receiverName,
          activeSwapId: null
        });
        tx.update(shiftBRef, {
          employeeId:   swap.requesterUid,
          employeeUid:  swap.requesterUid,
          employeeName: swap.requesterName,
          activeSwapId: null
        });
        tx.update(doc(db, 'swaps', swap.id), {
          status: 'completed',
          completedAt: new Date().toISOString()
        });
      });
      toast.success("Swap approved and shifts reassigned");
    } catch (e: any) {
      console.error(e);
      if (e.message === 'shift_missing') toast.error("Error: One of the shifts no longer exists.");
      else if (e.message === 'shift_a_ownership_changed') toast.error("Error: Requester's shift ownership changed before approval.");
      else if (e.message === 'shift_b_ownership_changed') toast.error("Error: Receiver's shift ownership changed before approval.");
      else if (e.message === 'late_swap_rule') toast.error("Rule violation: Late shifts can only be swapped with Late or Special shifts.");
      else toast.error("Failed to approve swap");
    }
  };

  const handleRejectSwap = async (swap: SwapRequest) => {
    try {
      await runTransaction(db, async (tx) => {
        tx.update(doc(db, 'swaps', swap.id), { status: 'rejected' });
        // Clear activeSwapId from the requester's shift
        if (swap.shiftId) {
          tx.update(doc(db, 'shifts', swap.shiftId), { activeSwapId: null });
        }
      });
      toast.success("Swap rejected");
    } catch (e) {
      console.error(e);
      toast.error("Failed to reject swap");
    }
  };

  return (
    <div className="h-full grid grid-cols-[240px_1fr]">
      {/* Sidebar */}
      <aside className="border-r p-5 flex flex-col gap-8 bg-white">
        <div className="space-y-3">
          <div className="text-xs font-bold uppercase text-gray-500">Manager Tools</div>
          <nav className="space-y-1">
            <button onClick={() => setView('upload')} className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-bold rounded-none transition ${view === 'upload' ? 'bg-black text-white' : 'hover:bg-gray-100'}`}>
              <Upload className="h-4 w-4" /> CSV Upload
            </button>
            <button onClick={() => setView('swaps')} className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-bold rounded-none transition ${view === 'swaps' ? 'bg-black text-white' : 'hover:bg-gray-100'}`}>
              Swap Approvals
              {pendingSwaps.filter(s => s.status === 'accepted').length > 0 && (
                <span className="ml-auto bg-red-500 text-white px-2 py-0.5 text-[10px] rounded-none">{pendingSwaps.filter(s => s.status === 'accepted').length}</span>
              )}
            </button>
            <button onClick={() => setView('dashboard')} className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-bold rounded-none transition ${view === 'dashboard' ? 'bg-black text-white' : 'hover:bg-gray-100'}`}>
              <BarChart3 className="h-4 w-4" /> Dashboard
            </button>
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <section className="overflow-y-auto bg-gray-50 p-6">
        <h2 className="text-2xl font-bold uppercase mb-6">{view === 'upload' ? 'CSV Upload' : view === 'swaps' ? 'Swap Approvals' : 'Dashboard'}</h2>

        {view === 'upload' && (
          <div className="space-y-4">
            <div className="bg-white p-6 border">
              <div className="space-y-4">
                <div>
                  <Label className="font-bold text-sm">Shift CSV (name, date, type, start, end)</Label>
                  <textarea value={csvInput} onChange={(e) => setCsvInput(e.target.value)} placeholder="John Doe,2025-01-15,late,22:00,06:00&#10;Jane Smith,2025-01-15,normal,08:00,17:00" className="mt-2 w-full p-3 border rounded text-xs font-mono" rows={8} />
                </div>
                <Button onClick={handleUploadCSV} disabled={isProcessing} className="w-full bg-black text-white rounded-none">
                  {isProcessing ? 'Processing...' : 'Upload Shifts'}
                </Button>
                {importErrors.length > 0 && (
                  <div className="mt-3 bg-red-50 border border-red-200 p-3 rounded text-xs space-y-1">
                    <p className="font-bold text-red-700">Import rejected — {importErrors.length} error(s). No shifts were saved.</p>
                    <ul className="list-disc list-inside space-y-0.5 text-red-600">
                      {importErrors.map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-6 border">
              <h3 className="font-bold text-sm uppercase mb-4">Recent Shifts ({shifts.length})</h3>
              <div className="max-h-96 overflow-y-auto border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Window</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shifts.slice(0, 50).map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="text-xs font-bold">{s.employeeName}</TableCell>
                        <TableCell className="text-xs">{s.date}</TableCell>
                        <TableCell><Badge className="text-[10px] rounded-none">{s.type}</Badge></TableCell>
                        <TableCell className="text-xs text-gray-600">{s.startTime}-{s.endTime}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        {view === 'swaps' && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 p-4 rounded text-xs">
              <strong>Awaiting your decision:</strong> {pendingSwaps.filter(s => s.status === 'accepted').length} swap(s) (receiver already accepted).
            </div>

            {/* Swaps awaiting receiver — manager cannot act yet */}
            {pendingSwaps.filter(s => s.status === 'pending').length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded text-xs space-y-1">
                <strong>Awaiting receiver acceptance ({pendingSwaps.filter(s => s.status === 'pending').length}):</strong>
                <p className="text-gray-600">These swaps are waiting for the receiver to accept or reject. No manager action required yet.</p>
                <ul className="mt-2 space-y-1">
                  {pendingSwaps.filter(s => s.status === 'pending').map(s => (
                    <li key={s.id} className="flex items-center gap-2">
                      <Clock className="h-3 w-3 text-yellow-600 shrink-0" />
                      <span>{s.requesterName} → {s.receiverName} ({s.shiftDate}, {s.shiftType})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-3">
              {pendingSwaps.filter(s => s.status === 'accepted').map(s => (
                <div key={s.id} className="bg-white p-4 border">
                  <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
                    <div>
                      <div className="font-bold text-gray-600 uppercase">{s.requesterName} (gives away)</div>
                      <div className="text-sm font-bold">{s.shiftDate} • {s.shiftType}</div>
                      <div className="text-gray-600">{s.shiftTime}</div>
                    </div>
                    <div>
                      <div className="font-bold text-gray-600 uppercase">{s.receiverName} (gives away)</div>
                      <div className="text-sm font-bold">{s.targetShiftDate || <span className="italic font-normal text-gray-400">One-way transfer</span>}</div>
                      {s.targetShiftDate && <div className="text-gray-600">{s.targetShiftTime}</div>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleApproveSwap(s)} className="flex-1 bg-green-600 text-white rounded-none text-xs">
                      <Check className="h-3 w-3 mr-1" /> Approve
                    </Button>
                    <Button size="sm" onClick={() => handleRejectSwap(s)} variant="outline" className="flex-1 rounded-none text-xs">
                      <X className="h-3 w-3 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
              {pendingSwaps.filter(s => s.status === 'accepted').length === 0 && (
                <p className="text-center text-gray-500 py-8 text-xs">No swaps awaiting your decision</p>
              )}
            </div>
          </div>
        )}

        {view === 'dashboard' && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white p-6 border text-center">
              <div className="text-3xl font-bold">{shifts.length}</div>
              <div className="text-xs text-gray-600 uppercase mt-2">Total Shifts</div>
            </div>
            <div className="bg-white p-6 border text-center">
              <div className="text-3xl font-bold">{employees.length}</div>
              <div className="text-xs text-gray-600 uppercase mt-2">Employees</div>
            </div>
            <div className="bg-white p-6 border text-center">
              <div className="text-3xl font-bold">{pendingSwaps.filter(s => s.status === 'accepted').length}</div>
              <div className="text-xs text-gray-600 uppercase mt-2">Pending Approvals</div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
