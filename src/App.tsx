import React, { useEffect, useState } from 'react';
import { auth, db, microsoftProvider, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User, signInAnonymously } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { UserProfile, UserRole, AppNotification } from './types';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { LogIn, LogOut, Clock, ShieldCheck, Bell, User as UserIcon, Lock } from 'lucide-react';
import ManagerDashboard from './components/ManagerDashboard';
import EmployeeDashboard from './components/EmployeeDashboard';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  
  // Custom credential login state
  const [isStaffLogin, setIsStaffLogin] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLegacySession, setIsLegacySession] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        setLoading(true);
        if (firebaseUser) {
          setUser(firebaseUser);
          setIsLegacySession(false);
          
          let profileDoc;
          try {
            profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          } catch (error) {
            handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
            throw error;
          }
          
          if (profileDoc && profileDoc.exists()) {
            setProfile(profileDoc.data() as UserProfile);
          } else {
            const isBootstrapAdmin = firebaseUser.email === 'j.krayenbuehl@gmail.com';
            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              username: firebaseUser.email?.split('@')[0],
              displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
              role: isBootstrapAdmin ? 'manager' : 'employee',
              department: 'Customer Care / Tier 1'
            };
            
            try {
              await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
              setProfile(newProfile);
              toast.success(`Welcome ${newProfile.displayName}! Role: ${newProfile.role}`);
            } catch (error) {
              handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}`);
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
          }, (error) => {
            handleFirestoreError(error, OperationType.LIST, 'notifications');
          });

          return () => unsubNotify();
        } else if (!isLegacySession) {
          setUser(null);
          setProfile(null);
          setNotifications([]);
        }
      } catch (error) {
        console.error("Initialization error:", error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [isLegacySession]);

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

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // 1. Sign in anonymously so we have a real Firebase Auth session
      const { user: anonUser } = await signInAnonymously(auth);
      
      // 2. Locate or Create profile
      if (username === 'Admin' && password === '1234') {
        const adminProfile: UserProfile = {
          uid: anonUser.uid,
          email: 'admin@shiftplanner.local',
          username: 'Admin',
          displayName: 'System Administrator',
          role: 'manager',
          department: 'Management'
        };
        await setDoc(doc(db, 'users', anonUser.uid), adminProfile);
        setProfile(adminProfile);
        setIsLegacySession(true);
        setUser(anonUser);
        toast.success("Logged in as Administrator");
        setLoading(false);
        return;
      }

      // Syntax check for other users: anfangsbucstabe vorname. nachname (e.g. j.doe)
      // We look for a profile with this username.
      const q = query(collection(db, 'users'), where('username', '==', username));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const userData = snapshot.docs[0].data() as UserProfile;
        if (password === '1234') {
          // If the profile already has a UID that doesn't match this anon session, 
          // we should ideally re-authenticate or link, but for this applet 
          // we'll just allow the anon session to take over if it's a "Staff Login".
          // In practice, we'll update the profile with the new anon UID.
          const updatedProfile = { ...userData, uid: anonUser.uid };
          await setDoc(doc(db, 'users', anonUser.uid), updatedProfile);
          
          setProfile(updatedProfile);
          setIsLegacySession(true);
          setUser(anonUser);
          toast.success(`Logged in as ${userData.displayName}`);
        } else {
          toast.error("Invalid credentials.");
          await signOut(auth); // Clean up anon session
        }
      } else {
        toast.error("User not found.");
        await signOut(auth);
      }
    } catch (err: any) {
      console.error("Staff login error details:", err);
      if (err.code === 'auth/admin-restricted-operation') {
        toast.error("Anonymous authentication is disabled in Firebase. Please enable it in the Firebase Console -> Authentication -> Sign-in method.", { duration: 6000 });
      } else {
        toast.error("Authentication error. Please check your credentials or network.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (isLegacySession) {
        setIsLegacySession(false);
        setUser(null);
        setProfile(null);
      } else {
        await signOut(auth);
      }
      toast.info("Logged out");
    } catch (error) {
      toast.error("Logout failed");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F0F0EE]">
        <div className="hd-mono text-sm animate-pulse">Initializing Planner...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F0F0EE] flex items-center justify-center p-4">
        <Toaster position="top-right" />
        <div className="max-w-md w-full hd-card space-y-6">
          <div className="text-center space-y-2">
            <div className="hd-mono font-black text-2xl tracking-tighter uppercase">Customer Care Planner</div>
            <div className="text-[10px] uppercase font-bold text-muted">Authentication Portal</div>
          </div>
          
          <AnimatePresence mode="wait">
            {!isStaffLogin ? (
              <motion.div 
                key="social"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 gap-3">
                  <Button onClick={handleMicrosoftLogin} className="w-full bg-[#00a1f1] hover:bg-[#0081c1] text-white rounded-none hd-mono text-xs py-6 gap-3">
                    <ShieldCheck className="h-4 w-4" /> Sign in with Microsoft
                  </Button>
                  <Button onClick={handleGoogleLogin} variant="outline" className="w-full rounded-none hd-mono text-xs py-6 border-[#2A2A2A] gap-3">
                    <LogIn className="h-4 w-4" /> Sign in with Google
                  </Button>
                </div>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-line"></span></div>
                  <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-white px-3 text-muted hd-mono">or manual access</span></div>
                </div>
                <Button variant="ghost" onClick={() => setIsStaffLogin(true)} className="w-full rounded-none hd-mono text-[10px] hover:bg-ink hover:text-bg">
                  ENTER_STAFF_CREDENTIALS
                </Button>
              </motion.div>
            ) : (
              <motion.form 
                key="staff"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onSubmit={handleStaffLogin}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <div className="hd-label text-[10px]">Username (e.g. j.doe)</div>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
                    <input 
                      type="text" 
                      placeholder="Enter Username" 
                      required
                      className="w-full pl-10 pr-4 py-3 bg-bg border-line hd-mono text-xs focus:outline-none focus:border-accent"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="hd-label text-[10px]">Access Code</div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
                    <input 
                      type="password" 
                      placeholder="Enter Password" 
                      required
                      className="w-full pl-10 pr-4 py-3 bg-bg border-line hd-mono text-xs focus:outline-none focus:border-accent"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full bg-ink text-bg rounded-none hd-mono text-xs py-5 transition-all active:scale-95">
                  AUTHENTICATE
                </Button>
                <Button variant="ghost" onClick={() => setIsStaffLogin(false)} className="w-full rounded-none hd-mono text-[10px] hover:underline">
                  BACK_TO_SOCIAL_LOGIN
                </Button>
              </motion.form>
            )}
          </AnimatePresence>
          
          <div className="text-[10px] hd-mono text-muted text-center opacity-30 uppercase border-t border-line/20 pt-4">
            Secured Connection // HTTPS_ENABLED
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
        <div className="hd-mono font-black text-lg tracking-tighter uppercase">Customer Care Planner</div>
        <div className="flex items-center gap-6">
          <div className="text-[11px] text-right leading-tight">
            <div className={`hd-mono uppercase font-bold ${profile?.role === 'manager' ? 'text-accent' : 'text-ink'}`}>
              {profile?.role === 'manager' ? 'MANAGER' : 'STAFF'}: {profile?.displayName}
            </div>
            <div className="text-muted uppercase font-medium">
              DEPT: {profile?.department === 'Customer Care / Tier 1' ? 'CUSTOMER CARE' : profile?.department?.toUpperCase()}
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
        System Status: Online // Active Session: {user.uid.slice(0,8).toUpperCase()} // {format(new Date(), 'HH:mm')}
      </footer>
    </div>
  );
}
