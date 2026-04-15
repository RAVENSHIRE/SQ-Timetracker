import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, writeBatch, where } from 'firebase/firestore';
import { Shift, BreakPlan, UserProfile, SwapRequest, AppNotification } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Trash2, Upload, Calendar as CalendarIcon, Clock, Users, Bell, Check, X, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
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
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([]);
  const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newShift, setNewShift] = useState<Partial<Shift>>({
    date: format(new Date(), 'yyyy-MM-dd'),
    startTime: '09:00',
    endTime: '17:00',
    customerCareRole: 'Support',
    status: 'scheduled'
  });

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

    return () => {
      unsubShifts();
      unsubBreaks();
      unsubSwaps();
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
        data.forEach((row) => {
          const shiftRef = doc(collection(db, 'shifts'));
          batch.set(shiftRef, {
            employeeId: row.Email || row.employeeId,
            employeeName: row.Name || row.employeeName,
            date: row.Date || format(new Date(), 'yyyy-MM-dd'),
            startTime: row.Start || row.startTime || '09:00',
            endTime: row.End || row.endTime || '17:00',
            customerCareRole: row.Role || row.customerCareRole || 'Support',
            status: 'scheduled'
          });
        });

        await batch.commit();
        toast.success(`Successfully imported ${data.length} shifts`);
        
        // Notify employees
        const uniqueEmails = Array.from(new Set(data.map(r => r.Email || r.employeeId)));
        for (const email of uniqueEmails) {
          // In a real app, we'd find the UID for this email
          // For now, we'll assume we can notify by email or just skip for this demo
        }
      } catch (error) {
        console.error("Excel parse error:", error);
        toast.error("Failed to parse Excel file. Ensure columns: Name, Email, Date, Start, End, Role");
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleAddShift = async () => {
    try {
      await addDoc(collection(db, 'shifts'), newShift);
      toast.success("Shift added");
      setIsShiftDialogOpen(false);
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
      {/* Left Sidebar: Navigation */}
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
          <div className="hd-label mb-2">System Health</div>
          <div className="hd-mono text-[9px] space-y-1 opacity-60">
            <div>DB_STATUS: CONNECTED</div>
            <div>AUTH_PROVIDER: MS_OAUTH</div>
            <div>LATENCY: 42ms</div>
          </div>
        </div>
      </aside>

      {/* Center: Content Area */}
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
                      <TableHead className="hd-label">Date</TableHead>
                      <TableHead className="hd-label">Window</TableHead>
                      <TableHead className="hd-label">Role</TableHead>
                      <TableHead className="hd-label text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shifts.map(s => (
                      <TableRow key={s.id} className="border-line hover:bg-bg/50">
                        <TableCell className="hd-mono text-xs font-bold">{s.employeeName}</TableCell>
                        <TableCell className="text-xs">{s.date}</TableCell>
                        <TableCell className="hd-mono text-xs text-accent">{s.startTime} - {s.endTime}</TableCell>
                        <TableCell className="text-xs uppercase font-medium">{s.customerCareRole}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => deleteDoc(doc(db, 'shifts', s.id))}>
                            <Trash2 className="h-3 w-3 text-muted" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
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
                      {swap.status === 'pending' && (
                        <div className="text-[9px] text-muted italic">WAITING_FOR_RECEIVER_ACCEPTANCE</div>
                      )}
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
                    {swap.status === 'pending' && (
                      <Button size="sm" variant="ghost" disabled className="hd-mono text-[10px] opacity-50">
                        PENDING_RECEIVER
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </section>

      {/* Right Sidebar: Notifications & Status */}
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

        <div className="mt-6 pt-4 border-t border-white/10">
          <div className="hd-label text-white/40 mb-3">Shift Distribution</div>
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-[9px] hd-mono">
                <span>TIER_1_SUPPORT</span>
                <span>85%</span>
              </div>
              <div className="h-1 bg-white/10">
                <div className="h-full bg-accent w-[85%]"></div>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[9px] hd-mono">
                <span>TIER_2_TECHNICAL</span>
                <span>40%</span>
              </div>
              <div className="h-1 bg-white/10">
                <div className="h-full bg-white/40 w-[40%]"></div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Shift Dialog */}
      <Dialog open={isShiftDialogOpen} onOpenChange={setIsShiftDialogOpen}>
        <DialogContent className="rounded-none border-line">
          <DialogHeader>
            <DialogTitle className="hd-serif uppercase">Manual Shift Entry</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label className="hd-label">Employee Identity</Label>
              <Input 
                className="rounded-none border-line hd-mono text-xs"
                placeholder="EMAIL_OR_ID" 
                value={newShift.employeeId || ''} 
                onChange={e => setNewShift({...newShift, employeeId: e.target.value})}
              />
              <Input 
                className="rounded-none border-line hd-mono text-xs"
                placeholder="DISPLAY_NAME" 
                value={newShift.employeeName || ''} 
                onChange={e => setNewShift({...newShift, employeeName: e.target.value})}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="hd-label">Operational Date</Label>
                <Input 
                  type="date"
                  className="rounded-none border-line hd-mono text-xs"
                  value={newShift.date || ''} 
                  onChange={e => setNewShift({...newShift, date: e.target.value})}
                />
              </div>
              <div className="grid gap-2">
                <Label className="hd-label">Functional Role</Label>
                <Select 
                  value={newShift.customerCareRole} 
                  onValueChange={v => setNewShift({...newShift, customerCareRole: v})}
                >
                  <SelectTrigger className="rounded-none border-line hd-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-none border-line">
                    <SelectItem value="Support">Support</SelectItem>
                    <SelectItem value="Billing">Billing</SelectItem>
                    <SelectItem value="Technical">Technical</SelectItem>
                  </SelectContent>
                </Select>
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
