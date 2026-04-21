# Deployment Guide

## Production Readiness Checklist

Before deploying to production:

- [ ] All tests passing (`npm run test:rules`)
- [ ] No console errors in development build
- [ ] Environment variables configured for production
- [ ] Firestore rules reviewed and tested
- [ ] Firebase project created and configured
- [ ] OAuth providers (Google, Microsoft) configured
- [ ] Custom domain added to authorized domains
- [ ] Database indexed for common queries
- [ ] Error logging service configured (optional: Sentry, LogRocket)
- [ ] Security rules tested against malicious inputs

## Firebase Setup

### Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create new project: "SQ-Timetracker"
3. Enable Google Analytics (optional)
4. Create web app (add to project)

### Authentication Setup

1. In Firebase Console, go to **Authentication**
2. Enable sign-in methods:
   - **Google** (required)
   - **Microsoft** (recommended)
3. Add authorized domains under **Settings** > **Authorized domains**
   - Add your production domain (e.g., `timetracker.example.com`)
   - Add localhost domains for development

### Firestore Setup

1. Create Firestore database in **Native mode**
2. Choose production location (not emulator)
3. Copy security rules from `firestore.rules` to Firestore Security Rules editor
4. Create indexes:
   ```
   Collection: shifts
   - employeeUid + date + type
   - date + type
   
   Collection: swaps
   - receiverUid + status + createdAt
   - requesterId + status + createdAt
   
   Collection: breakPlans
   - employeeUid + date
   - date
   ```

## Environment Configuration

### Production `.env`

```
# Firebase
VITE_FIREBASE_PROJECT_ID=sq-timetracker-prod
VITE_FIRESTORE_DATABASE_ID=(default)

# Feature Flags (PROD)
VITE_DEV_AUTH_BYPASS=false
VITE_AUDIT_LOGGING=true        # Enable in production for compliance

# Build environment
MODE=production
```

### Staging `.env.staging`

```
# Firebase (staging project)
VITE_FIREBASE_PROJECT_ID=sq-timetracker-staging
VITE_FIRESTORE_DATABASE_ID=(default)

# Feature Flags (STAGING)
VITE_DEV_AUTH_BYPASS=false
VITE_AUDIT_LOGGING=true

# Build environment
MODE=staging
```

## Build & Deploy

### Build Static Files

```bash
npm run build
```

Outputs optimized build to `dist/` directory.

### Deploy Options

#### Option A: Firebase Hosting (Recommended)

```bash
# Install Firebase CLI if needed
npm install -g firebase-tools

# Login to Firebase
firebase login

# Deploy to hosting
firebase deploy --only hosting
```

**firebase.json** configuration:
```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ],
    "headers": [
      {
        "source": "**/*.{js,css}",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "public, max-age=1year, immutable"
          }
        ]
      }
    ]
  }
}
```

#### Option B: Traditional Web Server (Nginx/Apache)

Build the app and serve `dist/` directory:

**Nginx Configuration:**
```nginx
server {
  listen 443 ssl http2;
  server_name timetracker.example.com;

  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;

  root /var/www/sq-timetracker/dist;
  index index.html;

  # SPA routing
  location / {
    try_files $uri $uri/ /index.html;
  }

  # Cache static assets
  location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  # No cache for HTML
  location ~* \.html$ {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
  }

  # Security headers
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-XSS-Protection "1; mode=block" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "no-referrer-when-downgrade" always;
  add_header Content-Security-Policy "default-src 'self' https:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;" always;
}
```

**Apache Configuration:**
```apache
<VirtualHost *:443>
  ServerName timetracker.example.com
  DocumentRoot /var/www/sq-timetracker/dist

  SSLEngine on
  SSLCertificateFile /path/to/cert.pem
  SSLCertificateKeyFile /path/to/key.pem

  <Directory /var/www/sq-timetracker/dist>
    Options -Indexes +FollowSymLinks
    AllowOverride All
    Require all granted

    # SPA routing
    RewriteEngine On
    RewriteBase /
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule ^ index.html [QSA,L]
  </Directory>

  # Cache static assets
  <FilesMatch "\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>

  # No cache for HTML
  <FilesMatch "\.html$">
    Header set Cache-Control "no-cache, no-store, must-revalidate"
  </FilesMatch>

  # Security Headers
  Header set X-Frame-Options "SAMEORIGIN"
  Header set X-XSS-Protection "1; mode=block"
  Header set X-Content-Type-Options "nosniff"
</VirtualHost>
```

#### Option C: Docker

**Dockerfile:**
```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**nginx.conf:**
```nginx
server {
  listen 80;
  location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
  }
}
```

Build and run:
```bash
docker build -t sq-timetracker:1.0.0 .
docker run -p 80:80 sq-timetracker:1.0.0
```

## Monitoring & Maintenance

### Error Tracking (Optional: Sentry)

Add to production for error reporting:

```bash
npm install @sentry/react @sentry/tracing
```

Initialize in `src/main.tsx`:
```typescript
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "https://...@sentry.io/...",
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
});
```

### Firestore Backups

Enable automated backups in Firebase Console:
- **Firestore** > **Backups**
- Set weekly backup schedule
- Retain backups for 90+ days

### Monitoring

Monitor in Firebase Console:
- **Usage & Billing** > **Real-time Database** for quota usage
- **Cloud Firestore** > **Metrics** for operations/latency
- **Authentication** for sign-in activity

## Zero-Downtime Updates

1. Build and test new version locally
2. Deploy to staging environment first
3. Verify functionality on staging
4. Deploy to production during low-traffic period
5. Monitor error rates and user activity

## Rollback Procedure

If critical issue found in production:

**With Firebase Hosting:**
```bash
firebase hosting:channels:list            # Find previous version
firebase hosting:channels:deploy:prod     # Redeploy previous version
```

**With Docker:**
```bash
docker run -p 80:80 sq-timetracker:0.9.0  # Previous version
```

## Security Hardening

1. **Enable Firestore Rules Enforcement**
   - Test rules: `npm run test:rules` before deploy
   - Review all rules for access control

2. **Configure CORS** (if API gateway used)
   ```json
   {
     "origin": ["https://timetracker.example.com"],
     "methods": ["GET", "POST", "PUT"],
     "allowedHeaders": ["Content-Type", "Authorization"]
   }
   ```

3. **Enable HTTPS Only**
   - Configure SSL/TLS certificates
   - Set HSTS headers

4. **API Rate Limiting** (if applicable)
   - Implement in reverse proxy or API gateway
   - Limit: 100 requests/minute per IP for auth endpoints

5. **Regular Security Updates**
   - Monthly: `npm update` and test
   - Quarterly: Security audit of dependencies
   - Review Firebase security advisories

## Troubleshooting Deployment

### "Cannot find module" errors
→ Run `npm ci` instead of `npm install` in production
→ Ensure `package-lock.json` is committed

### Blank page after deploy
→ Check browser console for errors
→ Verify Firebase credentials in production environment
→ Check Firestore rules allow reads from your domain

### High latency
→ Enable Firestore indexes (auto-suggested in console)
→ Check regional location (data center should match users)
→ Consider CDN for static assets (Firebase Hosting includes)

### Users can't login
→ Verify domain in Firebase > Authentication > Authorized domains
→ Check OAuth provider credentials are current
→ Test with incognito/private window (no cached auth)

## Performance Optimization

- **Lazy loading**: Components load data on-demand
- **Caching**: Static assets cached 1 year (with cache busting)
- **Compression**: Enable gzip in web server
- **CDN**: Firebase Hosting includes global CDN
- **Database**: Use Firestore indexes for common queries

## Disaster Recovery

**RTO/RPO:**
- Recovery Time Objective: 1 hour
- Recovery Point Objective: 1 day (daily backups)

**Recovery Steps:**
1. Restore database from automated backup
2. Redeploy application code
3. Clear CDN cache
4. Monitor data consistency
5. Notify users if data was lost

## Support & Monitoring Links

- [Firebase Console](https://console.firebase.google.com)
- [Google Cloud Console](https://console.cloud.google.com)
- [Firebase Status](https://status.firebase.google.com)
