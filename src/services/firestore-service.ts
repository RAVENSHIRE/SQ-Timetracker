/**
 * Firestore Service
 * 
 * Centralized abstraction layer for all Firestore database operations.
 * Provides type-safe methods with proper error handling and logging.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  onSnapshot,
  QuerySnapshot,
  DocumentSnapshot,
  SetOptions,
  Query,
  Unsubscribe
} from 'firebase/firestore';
import { db } from '../firebase';
import { Shift, BreakPlan, SwapRequest, UserProfile, AppNotification, ShiftType } from '../types';
import { logger } from './logger';

interface QueryConfig {
  where?: Array<[string, string, any]>;
  orderBy?: Array<[string, string]>;
}

class FirestoreService {
  /**
   * Shifts Operations
   */

  async getShifts(config?: QueryConfig): Promise<Shift[]> {
    try {
      const conditions = config?.where?.map(([field, op, value]) =>
        where(field, op as any, value)
      ) ?? [];
      
      const orders = config?.orderBy?.map(([field, direction]) =>
        orderBy(field, direction as any)
      ) ?? [];

      const q = query(
        collection(db, 'shifts'),
        ...conditions,
        ...orders
      );

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift));
    } catch (error) {
      logger.error('Failed to fetch shifts', { error, config });
      throw error;
    }
  }

  async getMyShifts(uid: string): Promise<Shift[]> {
    return this.getShifts({
      where: [['employeeUid', '==', uid]],
      orderBy: [['date', 'desc']]
    });
  }

  async getEmployeeShifts(employeeId: string): Promise<Shift[]> {
    return this.getShifts({
      where: [['employeeId', '==', employeeId]],
      orderBy: [['date', 'asc']]
    });
  }

  onShiftsSnapshot(
    config: QueryConfig,
    callback: (shifts: Shift[]) => void,
    onError?: (error: Error) => void
  ): Unsubscribe {
    try {
      const conditions = config.where?.map(([field, op, value]) =>
        where(field, op as any, value)
      ) ?? [];
      
      const orders = config.orderBy?.map(([field, direction]) =>
        orderBy(field, direction as any)
      ) ?? [];

      const q = query(
        collection(db, 'shifts'),
        ...conditions,
        ...orders
      );

      return onSnapshot(
        q,
        (snapshot) => {
          callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Shift)));
        },
        (error) => {
          logger.error('Shifts snapshot error', { error });
          onError?.(error as Error);
        }
      );
    } catch (error) {
      logger.error('Failed to setup shifts snapshot', { error });
      throw error;
    }
  }

  async createShift(shift: Omit<Shift, 'id'>): Promise<string> {
    try {
      const docRef = await addDoc(collection(db, 'shifts'), shift);
      logger.info('Shift created', { shiftId: docRef.id, date: shift.date, employee: shift.employeeName });
      return docRef.id;
    } catch (error) {
      logger.error('Failed to create shift', { error, shift });
      throw error;
    }
  }

  async updateShift(shiftId: string, updates: Partial<Shift>): Promise<void> {
    try {
      await updateDoc(doc(db, 'shifts', shiftId), updates);
      logger.info('Shift updated', { shiftId });
    } catch (error) {
      logger.error('Failed to update shift', { error, shiftId });
      throw error;
    }
  }

  async deleteShift(shiftId: string): Promise<void> {
    try {
      await deleteDoc(doc(db, 'shifts', shiftId));
      logger.info('Shift deleted', { shiftId });
    } catch (error) {
      logger.error('Failed to delete shift', { error, shiftId });
      throw error;
    }
  }

  /**
   * Swap Request Operations
   */

  async createSwapRequest(swap: Omit<SwapRequest, 'id'>): Promise<string> {
    try {
      const docRef = await addDoc(collection(db, 'swaps'), swap);
      logger.info('Swap request created', { swapId: docRef.id, requester: swap.requesterName, receiver: swap.receiverName });
      return docRef.id;
    } catch (error) {
      logger.error('Failed to create swap request', { error, swap });
      throw error;
    }
  }

  async updateSwapStatus(swapId: string, status: SwapRequest['status']): Promise<void> {
    try {
      await updateDoc(doc(db, 'swaps', swapId), { status });
      logger.info('Swap status updated', { swapId, status });
    } catch (error) {
      logger.error('Failed to update swap status', { error, swapId });
      throw error;
    }
  }

  async approveSwap(swapId: string, shift1Updates: Partial<Shift>, shift2Updates: Partial<Shift>): Promise<void> {
    const batch = writeBatch(db);
    try {
      const swapDoc = await getDoc(doc(db, 'swaps', swapId));
      if (!swapDoc.exists()) throw new Error('Swap request not found');

      const swap = swapDoc.data() as SwapRequest;

      // Update both shifts and swap status in transaction
      batch.update(doc(db, 'shifts', shift1Updates.id || swap.shiftId), shift1Updates);
      if (shift2Updates.id) {
        batch.update(doc(db, 'shifts', shift2Updates.id), shift2Updates);
      }
      batch.update(doc(db, 'swaps', swapId), { status: 'completed' });

      await batch.commit();
      logger.info('Swap approved and completed', { swapId });
    } catch (error) {
      logger.error('Failed to approve swap', { error, swapId });
      throw error;
    }
  }

  onSwapsSnapshot(
    config: QueryConfig,
    callback: (swaps: SwapRequest[]) => void,
    onError?: (error: Error) => void
  ): Unsubscribe {
    try {
      const conditions = config.where?.map(([field, op, value]) =>
        where(field, op as any, value)
      ) ?? [];
      
      const orders = config.orderBy?.map(([field, direction]) =>
        orderBy(field, direction as any)
      ) ?? [];

      const q = query(
        collection(db, 'swaps'),
        ...conditions,
        ...orders
      );

      return onSnapshot(
        q,
        (snapshot) => {
          callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SwapRequest)));
        },
        (error) => {
          logger.error('Swaps snapshot error', { error });
          onError?.(error as Error);
        }
      );
    } catch (error) {
      logger.error('Failed to setup swaps snapshot', { error });
      throw error;
    }
  }

  /**
   * Break Plan Operations
   */

  async getBreakPlans(config?: QueryConfig): Promise<BreakPlan[]> {
    try {
      const conditions = config?.where?.map(([field, op, value]) =>
        where(field, op as any, value)
      ) ?? [];
      
      const orders = config?.orderBy?.map(([field, direction]) =>
        orderBy(field, direction as any)
      ) ?? [];

      const q = query(
        collection(db, 'breakPlans'),
        ...conditions,
        ...orders
      );

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BreakPlan));
    } catch (error) {
      logger.error('Failed to fetch break plans', { error });
      throw error;
    }
  }

  async createBreakPlan(breakPlan: Omit<BreakPlan, 'id'>): Promise<string> {
    try {
      const docRef = await addDoc(collection(db, 'breakPlans'), breakPlan);
      logger.info('Break plan created', { breakId: docRef.id, date: breakPlan.date });
      return docRef.id;
    } catch (error) {
      logger.error('Failed to create break plan', { error });
      throw error;
    }
  }

  async createBreakPlans(breakPlans: Array<Omit<BreakPlan, 'id'>>): Promise<string[]> {
    const batch = writeBatch(db);
    const ids: string[] = [];
    try {
      const collectionRef = collection(db, 'breakPlans');
      for (const plan of breakPlans) {
        const docRef = doc(collectionRef);
        ids.push(docRef.id);
        batch.set(docRef, plan);
      }
      await batch.commit();
      logger.info('Break plans created', { count: ids.length });
      return ids;
    } catch (error) {
      logger.error('Failed to create break plans', { error });
      throw error;
    }
  }

  async deleteBreakPlans(ids: string[]): Promise<void> {
    const batch = writeBatch(db);
    try {
      for (const id of ids) {
        batch.delete(doc(db, 'breakPlans', id));
      }
      await batch.commit();
      logger.info('Break plans deleted', { count: ids.length });
    } catch (error) {
      logger.error('Failed to delete break plans', { error });
      throw error;
    }
  }

  /**
   * User Profile Operations
   */

  async getUser(uid: string): Promise<UserProfile | null> {
    try {
      const docSnap = await getDoc(doc(db, 'users', uid));
      return docSnap.exists() ? (docSnap.data() as UserProfile) : null;
    } catch (error) {
      logger.error('Failed to fetch user', { error, uid });
      throw error;
    }
  }

  async getUsers(): Promise<UserProfile[]> {
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      return snapshot.docs.map(doc => doc.data() as UserProfile);
    } catch (error) {
      logger.error('Failed to fetch users', { error });
      throw error;
    }
  }

  async createUser(user: UserProfile): Promise<void> {
    try {
      await addDoc(collection(db, 'users'), user);
      logger.info('User created', { uid: user.uid, email: user.email, role: user.role });
    } catch (error) {
      logger.error('Failed to create user', { error, uid: user.uid });
      throw error;
    }
  }

  onUsersSnapshot(
    callback: (users: UserProfile[]) => void,
    onError?: (error: Error) => void
  ): Unsubscribe {
    try {
      return onSnapshot(
        collection(db, 'users'),
        (snapshot) => {
          callback(snapshot.docs.map(doc => doc.data() as UserProfile));
        },
        (error) => {
          logger.error('Users snapshot error', { error });
          onError?.(error as Error);
        }
      );
    } catch (error) {
      logger.error('Failed to setup users snapshot', { error });
      throw error;
    }
  }

  /**
   * Notification Operations
   */

  async createNotification(notification: Omit<AppNotification, 'id'>): Promise<string> {
    try {
      const docRef = await addDoc(collection(db, 'notifications'), notification);
      logger.info('Notification created', { userId: notification.userId, type: notification.type });
      return docRef.id;
    } catch (error) {
      logger.error('Failed to create notification', { error });
      throw error;
    }
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), { read: true });
    } catch (error) {
      logger.error('Failed to mark notification as read', { error });
      throw error;
    }
  }
}

export const firestoreService = new FirestoreService();
