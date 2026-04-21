# Development Guide

## Project Overview

SQ-Timetracker is a shift scheduling and swap management system for customer care teams. It allows managers to upload shift schedules and employees to request shift swaps with validation of business rules.

**Tech Stack:**
- Frontend: React 19 + Vite + TypeScript
- Styling: Tailwind CSS + shadcn/ui
- Backend: Firebase (Auth + Firestore)
- Testing: Firebase Emulator Suite

## Setup

### Prerequisites
- Node.js 18+
- npm 9+
- Firebase CLI (optional, for emulator tests)
- Git

### Installation

1. Clone the repository:
```bash
git clone <repo-url>
cd SQ-Timetracker
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment template:
```bash
cp .env.example .env.local
```

4. Update `.env.local` with your Firebase credentials:
```
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIRESTORE_DATABASE_ID=(default)
VITE_DEV_AUTH_BYPASS=false
```

### Development Server

```bash
npm run dev
```

Server runs at `http://localhost:5173`

## Architecture

### Directory Structure

```
src/
├── components/          # React components
│   ├── ManagerDashboard.tsx
│   ├── EmployeeDashboard.tsx
│   ├── ErrorBoundary.tsx
│   └── ui/             # shadcn components
├── services/           # Business logic layer
│   ├── firestore-service.ts   # Database abstraction
│   ├── validation.ts          # Business rules
│   └── logger.ts              # Logging service
├── config.ts           # Environment & feature flags
├── firebase.ts         # Firebase initialization
├── types.ts            # TypeScript interfaces
├── constants.ts        # Shift definitions
└── App.tsx            # Main app component

tests/
└── firestore.rules.test.mjs  # Firestore security tests

firestore.rules          # Firestore security rules
```

### Data Model

#### Users (Firestore Collection)
```typescript
interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  role: 'manager' | 'employee';
  department?: string;
}
```

#### Shifts
```typescript
interface Shift {
  id: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  date: string;           // YYYY-MM-DD
  type: 'normal' | 'second' | 'special' | 'late';
  startTime: string;      // HH:MM
  endTime: string;        // HH:MM
  status?: 'scheduled' | 'active' | 'complete';
}
```

#### Swap Requests
```typescript
interface SwapRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  receiverId: string;
  receiverUid: string;
  receiverName: string;
  shiftId: string;        // Shift being offered
  shiftDate: string;      // Date of shift being offered
  shiftType: ShiftType;
  targetShiftDate?: string | null;  // Shift being requested
  targetShiftTime?: string | null;
  targetShiftType?: ShiftType | null;
  status: 'pending' | 'accepted' | 'approved' | 'rejected' | 'completed';
  createdAt: string;
}
```

### Business Rules

**Late Shift Rules:**
1. After a late shift, the next shift must be special
2. Late shifts can only be traded for late or special shifts
3. Prevents double-booking employees

**Swap Workflow:**
1. Employee initiates swap request (pending)
2. Receiver accepts/rejects (accepted/rejected)
3. Manager approves accepted request (approved/completed)

## Services

### Firestore Service (`src/services/firestore-service.ts`)

Type-safe abstraction for all database operations:

```typescript
// Get shifts
const shifts = await firestoreService.getMyShifts(uid);

// Create swap request
const swapId = await firestoreService.createSwapRequest(swap);

// Approve swap (atomic operation)
await firestoreService.approveSwap(swapId, shift1Updates, shift2Updates);

// Listen for changes
const unsubscribe = firestoreService.onShiftsSnapshot(
  { where: [['employeeUid', '==', uid]] },
  (shifts) => updateUI(shifts)
);
```

### Validation Service (`src/services/validation.ts`)

Enforces business rules:

```typescript
// Validate shift placement
const result = await validationService.validateShiftPlacement(
  employeeId,
  '2024-04-20',
  'late'
);

// Validate swap request
const result = await validationService.validateSwapRequest(swap);
```

### Logger Service (`src/services/logger.ts`)

Structured logging with environment awareness:

```typescript
logger.info('User logged in', { uid: user.uid });
logger.warn('Swap validation failed', { reason: 'Late shift rule' });
logger.error('Database error', { error: err });
```

## Configuration

Environment variables in `.env.local`:

```
# Firebase
VITE_FIREBASE_PROJECT_ID=sq-timetracker
VITE_FIRESTORE_DATABASE_ID=(default)

# Development
VITE_DEV_AUTH_BYPASS=false    # Use test auth, no OAuth
VITE_AUDIT_LOGGING=false      # Log all changes

# Build mode (auto-set)
MODE=development
```

### Feature Flags

All feature flags defined in `src/config.ts`:

```typescript
config.getFeature('authBypass')           // Dev auth bypass
config.getFeature('breakOptimization')    // Advanced features
config.getFeature('auditLogging')         // Detailed logging
```

## Testing

### Firestore Rules Testing

```bash
npm run test:rules
```

Tests security rules against various scenarios. See `tests/firestore.rules.test.mjs`.

### Manual Testing

Enable auth bypass for local testing:

```bash
npm run auth:bypass:on
npm run dev
```

This skips OAuth login. Disable with:

```bash
npm run auth:bypass:off
```

## Common Tasks

### Adding a New Feature

1. Create business logic in `src/services/`
2. Add types in `src/types.ts`
3. Implement component in `src/components/`
4. Add corresponding Firestore rules
5. Test against rules: `npm run test:rules`

### Creating a New Shift Type

1. Add to `ShiftType` in `src/types.ts`
2. Add definition to `SHIFT_DEFINITIONS` in `src/constants.ts`
3. Update validation in `src/services/validation.ts` if new rules apply

### Debugging

Enable verbose logging:

```typescript
// In .env.local
VITE_DEBUG=true
```

Check browser console for debug logs. Production logs go to console (errors only).

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for production setup and CI/CD configuration.

## Performance Considerations

1. **Real-time listeners**: Limited to necessary data subsets (filtered queries)
2. **Batch operations**: Use `writeBatch` for multi-document updates
3. **Pagination**: Not implemented for MVP (assumes <1000 annual shifts)
4. **Lazy loading**: Components load data on-demand, not pre-fetched

## Security

- All database writes must pass Firestore rules validation
- Client-side validation for UX, server-side validation for security
- No sensitive data in localStorage
- OAuth providers validate user identity
- Bootstrap admin email hardcoded for initial setup only

## Troubleshooting

### OAuth "Unauthorized Domain" Error
→ Add your domain to Firebase Console > Authentication > Settings > Authorized domains

### "Anonymous Auth Disabled" Error
→ Not applicable - uses OAuth providers, no anonymous auth needed

### Shifts not appearing
→ Check Firestore rules allow current user to read shifts collection
→ Check filter conditions match your query

### Changes not reflecting in UI
→ Check Firestore listeners are properly unsubscribed
→ Look for "maximum snapshots" errors in console

## Contributing

1. Create a branch for your feature
2. Make changes following the existing code style
3. Test changes: `npm run dev` and manual testing
4. Commit with clear messages
5. Create pull request with description

## Resources

- [Firebase Documentation](https://firebase.google.com/docs)
- [React Documentation](https://react.dev)
- [Vite Documentation](https://vitejs.dev)
- [Tailwind CSS](https://tailwindcss.com)
