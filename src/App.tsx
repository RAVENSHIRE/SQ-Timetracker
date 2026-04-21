import React, { useState } from 'react';
import { auth, db } from './firebase';
import { signInAnonymously, signOut, User } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { UserProfile } from './types';
import { Button } from '@/components/ui/button';
import { Toaster, toast } from 'sonner';
import { LogOut } from 'lucide-react';
import ManagerDashboard from './components/ManagerDashboard';
import EmployeeDashboard from './components/EmployeeDashboard';

// Define our 4 test stages exactly
const TEST_ACCOUNTS = [
  { username: 'admin', name: 'Manager Admin', role: 'manager' as const },
  { username: 'emp1', name: 'Employee One', role: 'employee' as const },
  { username: 'emp2', name: 'Employee Two', role: 'employee' as const },
  { username: 'emp3', name: 'Employee Three', role: 'employee' as const }
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);

  // Quick Login Bypass for Testing
  const handleTestLogin = async (account: typeof TEST_ACCOUNTS[0]) => {
    setLoading(true);
    try {
      const { user: anonUser } = await signInAnonymously(auth);
      const testProfile: UserProfile = {
        uid: anonUser.uid,
        email: `${account.username}@local.test`,
        username: account.username,
        displayName: account.name,
        role: account.role,
        department: 'Operations'
      };
      
      // Auto-provision profile in Firestore
      await setDoc(doc(db, 'users', anonUser.uid), testProfile);
      
      setProfile(testProfile);
      setUser(anonUser);
      toast.success(`Logged in as ${account.name}`);
    } catch (err: any) {
      console.error("Login failed:", err);
      toast.error("Firebase Auth failed. Is Anonymous login enabled in Firebase Console?");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setProfile(null);
      setUser(null);
      toast.success('Logged out');
    } catch (err) {
      toast.error('Logout failed');
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;

  if (!user || !profile) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <Toaster position="top-right" />
        <div className="max-w-md w-full bg-white p-8 border shadow-sm space-y-6">
          <div className="text-center">
            <h1 className="font-bold text-2xl uppercase tracking-tighter">Shift Planner</h1>
            <p className="text-xs text-gray-500 uppercase mt-1">Test Environment Authentication</p>
          </div>
          
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase border-b pb-1">1. Management</div>
            <Button onClick={() => handleTestLogin(TEST_ACCOUNTS[0])} className="w-full bg-black text-white rounded-none">
              Login as MANAGER
            </Button>

            <div className="text-xs font-bold uppercase border-b pb-1 mt-6">2. Employees</div>
            <div className="grid gap-2">
              <Button onClick={() => handleTestLogin(TEST_ACCOUNTS[1])} variant="outline" className="rounded-none">Login as EMP 1</Button>
              <Button onClick={() => handleTestLogin(TEST_ACCOUNTS[2])} variant="outline" className="rounded-none">Login as EMP 2</Button>
              <Button onClick={() => handleTestLogin(TEST_ACCOUNTS[3])} variant="outline" className="rounded-none">Login as EMP 3</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 text-gray-900 overflow-hidden">
      <Toaster position="top-right" />
      <header className="h-[60px] border-b flex justify-between items-center px-5 bg-white shrink-0">
        <div className="font-black text-lg tracking-tighter uppercase">Shift Planner</div>
        <div className="flex items-center gap-6">
          <div className="text-xs text-right">
            <div className="font-bold uppercase">{profile.role}: {profile.displayName}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {profile.role === 'manager' ? (
          <ManagerDashboard profile={profile} />
        ) : (
          <EmployeeDashboard profile={profile} />
        )}
      </main>
    </div>
  );
}
