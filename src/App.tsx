import { useEffect, useState } from 'react';
import { auth, db, microsoftProvider } from './firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { UserProfile, UserRole, AppNotification } from './types';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { LogIn, LogOut, Clock, ShieldCheck, Bell } from 'lucide-react';
import ManagerDashboard from './components/ManagerDashboard';
import EmployeeDashboard from './components/EmployeeDashboard';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        setUser(firebaseUser);
        const profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        
        if (profileDoc.exists()) {
          setProfile(profileDoc.data() as UserProfile);
        } else {
          const isBootstrapAdmin = firebaseUser.email === 'j.krayenbuehl@gmail.com';
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
            role: isBootstrapAdmin ? 'manager' : 'employee',
            department: 'Customer Care / Tier 1'
          };
          
          try {
            await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
            setProfile(newProfile);
            toast.success(`Welcome ${newProfile.displayName}! Role: ${newProfile.role}`);
          } catch (error) {
            console.error("Error creating profile:", error);
            toast.error("Failed to create user profile");
          }
        }

        // Listen for notifications
        const q = query(
          collection(db, 'notifications'),
          where('userId', '==', firebaseUser.uid),
          orderBy('createdAt', 'desc')
        );
        const unsubNotify = onSnapshot(q, (snapshot) => {
          const n = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AppNotification));
          setNotifications(n);
          const unread = n.filter(x => !x.read);
          if (unread.length > 0) {
            toast.info(`You have ${unread.length} new notifications`);
          }
        });

        return () => unsubNotify();
      } else {
        setUser(null);
        setProfile(null);
        setNotifications([]);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
      toast.error("Login failed.");
    }
  };

  const handleMicrosoftLogin = async () => {
    try {
      await signInWithPopup(auth, microsoftProvider);
    } catch (error) {
      console.error("Microsoft Login error:", error);
      toast.error("Microsoft Login failed.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.info("Logged out");
    } catch (error) {
      toast.error("Logout failed");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F0F0EE]">
        <div className="hd-mono text-sm animate-pulse">INITIALIZING_SYSTEM_CORE...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F0F0EE] flex items-center justify-center p-4">
        <Toaster position="top-right" />
        <div className="max-w-md w-full hd-card space-y-8">
          <div className="text-center space-y-2">
            <div className="hd-mono font-black text-2xl tracking-tighter">TEAM//SYNC_CORE</div>
            <div className="hd-label">Authentication Required</div>
          </div>
          <div className="space-y-4">
            <Button onClick={handleMicrosoftLogin} className="w-full bg-[#00a1f1] hover:bg-[#0081c1] text-white rounded-none hd-mono text-xs py-6">
              SIGN_IN_WITH_MICROSOFT
            </Button>
            <Button onClick={handleGoogleLogin} variant="outline" className="w-full rounded-none hd-mono text-xs py-6 border-[#2A2A2A]">
              SIGN_IN_WITH_GOOGLE
            </Button>
          </div>
          <div className="text-[10px] hd-mono text-muted text-center opacity-50">
            SECURE_SESSION_ENCRYPTION_ENABLED // NODE: US-EAST-1
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#F0F0EE] text-[#141414] hd-border overflow-hidden">
      <Toaster position="top-right" />
      
      {/* Header */}
      <header className="h-[60px] hd-border-b flex justify-between items-center px-5 shrink-0 bg-white">
        <div className="hd-mono font-black text-lg tracking-tighter">TEAM//SYNC_CORE</div>
        <div className="flex items-center gap-6">
          <div className="text-[11px] text-right leading-tight">
            <div className="hd-mono text-accent uppercase font-bold">
              {profile?.role}: {profile?.displayName} [ID_{user.uid.slice(0,4).toUpperCase()}]
            </div>
            <div className="text-muted uppercase font-medium">
              DEPT: {profile?.department || 'CUSTOMER CARE / TIER 1'}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} className="rounded-none hover:bg-ink hover:text-bg">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden">
        {profile?.role === 'manager' ? (
          <ManagerDashboard profile={profile} notifications={notifications} />
        ) : (
          <EmployeeDashboard profile={profile!} notifications={notifications} />
        )}
      </main>

      {/* Footer */}
      <footer className="h-[30px] bg-[#2A2A2A] text-[#888] text-[10px] flex items-center px-5 hd-mono shrink-0">
        SYSTEM STATUS: NOMINAL // SESSION: {user.uid.slice(0,8).toUpperCase()} // {format(new Date(), 'yyyy-MM-dd HH:mm:ss')}
      </footer>
    </div>
  );
}
