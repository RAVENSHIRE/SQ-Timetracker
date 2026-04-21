<div align="center">
<h1>SQ-Timetracker</h1>
<p>Professional Shift Scheduling & Swap Management System</p>
</div>

## Overview

SQ-Timetracker is a production-ready web application for managing shift schedules and facilitating shift swaps in customer care teams. It simplifies schedule coordination, enforces business rules, and eliminates manual swap administration.

**Key Features:**
- 📅 **Shift Management**: Managers upload monthly schedules via CSV
- 🔄 **Shift Swaps**: Employees request swaps with automatic validation
- 📋 **Business Rules**: Automatic enforcement of shift trading constraints
- 🔐 **Role-Based Access**: Separate interfaces for managers and employees
- 📊 **Real-Time Updates**: Live synchronization via Firebase Firestore
- 🛡️ **Secure**: OAuth authentication + Firestore rules validation

## Quick Start

### Prerequisites
- Node.js 18+
- npm 9+
- Firebase project (create at [firebase.google.com](https://firebase.google.com))

### Installation

```bash
# Clone repository
git clone <repo-url>
cd SQ-Timetracker

# Install dependencies
npm install

# Configure Firebase
cp .env.example .env.local
# Edit .env.local with your Firebase project ID
```

### Development

```bash
npm run dev
```

Open http://localhost:5173 and sign in with Google or Microsoft.

### Production Build

```bash
npm run build
npm run preview
```

## Documentation

- **[DEVELOPMENT.md](DEVELOPMENT.md)** - Setup, architecture, and development guide
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Production deployment instructions

## Features

### For Managers
- Upload shift schedules (CSV format)
- View all employee schedules
- Validate shift rules before import
- Approve/reject swap requests
- Monitor team scheduling

### For Employees
- View personal shift schedule
- Request shift swaps with colleagues
- Accept/reject incoming swap requests
- See break schedule for each shift

## Technical Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS + shadcn/ui
- **Backend**: Firebase (Auth + Firestore)
- **Database**: Firestore with security rules
- **Testing**: Firebase Emulator Suite

## Project Structure

```
src/
├── components/          # React components
├── services/           # Business logic (Firebase, validation, logging)
├── config.ts          # Environment & feature flags
├── types.ts           # TypeScript interfaces
├── constants.ts       # Shift definitions
└── App.tsx           # Main component

firestore.rules        # Firestore security rules (tested)
tests/                # Firestore rules tests
```

## Business Rules

### Shift Types
- **Normal**: 08:00 - 17:30
- **Second**: 08:45 - 18:15
- **Special**: 09:00 - 18:30
- **Late**: 11:30 - 22:00

### Swap Constraints
1. Late shifts → only trade for late or special shifts
2. After late shift → next day must be special shift
3. No double-booking (same employee, same day)

## Configuration

Environment variables in `.env.local`:

```
# Firebase
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIRESTORE_DATABASE_ID=(default)

# Development
VITE_DEV_AUTH_BYPASS=false    # Disable for production
VITE_AUDIT_LOGGING=false      # Enable in production
```

## Scripts

```bash
# Development
npm run dev              # Start dev server
npm run build            # Build for production
npm run preview          # Preview production build
npm run lint             # Type check

# Testing
npm run test:rules       # Test Firestore security rules

# Development Tools
npm run auth:bypass:on   # Enable dev auth bypass
npm run auth:bypass:off  # Disable dev auth bypass
```

## Security

- **Authentication**: OAuth 2.0 (Google, Microsoft)
- **Database**: Firestore rules enforce role-based access
- **Validation**: Server-side & client-side checks
- **Rules Testing**: Comprehensive test coverage in `tests/firestore.rules.test.mjs`

See [SECURITY.md](DEVELOPMENT.md#security) for details.

## Performance

- Real-time data sync with Firestore listeners
- Lazy loading of shift data
- Static asset caching (1 year for versioned files)
- Optimized bundle size (~150KB gzipped)

## Error Handling

- Structured logging with environment awareness
- User-friendly error messages
- Automatic retry for transient failures
- Error boundary for graceful degradation

## Troubleshooting

**OAuth "Unauthorized Domain" Error**
→ Add your domain to Firebase Console > Authentication > Settings > Authorized domains

**Shifts not appearing**
→ Check Firestore rules allow current user to read shifts collection

**Changes not updating in real-time**
→ Check browser console for listener errors
→ Verify Firestore connection status

See [DEVELOPMENT.md](DEVELOPMENT.md#troubleshooting) for more solutions.

## Contributing

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes following code style
3. Test: `npm run dev` and manual testing
4. Commit: `git commit -m "Add my feature"`
5. Push: `git push origin feature/my-feature`
6. Create pull request

## License

Proprietary - All rights reserved

## Support

For issues or questions:
1. Check [DEVELOPMENT.md](DEVELOPMENT.md#troubleshooting)
2. Check [DEPLOYMENT.md](DEPLOYMENT.md#troubleshooting-deployment)
3. Review Firebase documentation
4. Contact system administrator

## Roadmap

**Future Features (Post-MVP):**
- [ ] Holiday/sick leave management
- [ ] Break time customization
- [ ] Advanced reporting & analytics
- [ ] Mobile app
- [ ] SMS notifications
- [ ] Email notifications with approval links
- [ ] Admin user management interface
- [ ] Audit trail viewer

## Version History

**v1.0.0** - Initial production release
- Shift management with CSV import
- Shift swap requests with validation
- Role-based manager/employee interfaces
- Firestore security rules
- OAuth authentication

