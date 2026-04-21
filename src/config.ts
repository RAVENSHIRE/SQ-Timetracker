/**
 * Configuration Service
 * 
 * Centralized app configuration with environment separation.
 * Provides typed access to environment variables and feature flags.
 */

interface AppConfig {
  // Environment
  env: 'development' | 'staging' | 'production';
  isDev: boolean;
  isProd: boolean;

  // Firebase
  firebase: {
    projectId: string;
    firestoreDatabaseId: string;
  };

  // Feature Flags
  features: {
    authBypass: boolean; // Dev/testing only
    breakOptimization: boolean; // Advanced feature
    auditLogging: boolean; // Log all changes
  };

  // App behavior
  app: {
    notificationCheckInterval: number; // ms
    requestTimeoutMs: number;
    maxInitialShiftsToLoad: number;
  };
}

class Config {
  private config: AppConfig;

  constructor() {
    this.config = this.loadConfig();
    this.validate();
  }

  private loadConfig(): AppConfig {
    const env = (import.meta.env.MODE || 'development') as 'development' | 'staging' | 'production';

    return {
      env,
      isDev: import.meta.env.DEV,
      isProd: import.meta.env.PROD,

      firebase: {
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'sq-timetracker',
        firestoreDatabaseId: import.meta.env.VITE_FIRESTORE_DATABASE_ID || '(default)'
      },

      features: {
        authBypass: import.meta.env.VITE_DEV_AUTH_BYPASS === 'true',
        breakOptimization: false, // Disabled for MVP
        auditLogging: import.meta.env.VITE_AUDIT_LOGGING === 'true'
      },

      app: {
        notificationCheckInterval: 30000, // 30 seconds
        requestTimeoutMs: 10000, // 10 seconds
        maxInitialShiftsToLoad: 365 // 1 year
      }
    };
  }

  private validate(): void {
    // Validate required environment variables
    if (!this.config.firebase.projectId) {
      console.warn('VITE_FIREBASE_PROJECT_ID not set, using default');
    }

    // Auth bypass should only be in dev
    if (this.config.features.authBypass && !this.config.isDev) {
      console.error('AUTH BYPASS ENABLED IN NON-DEV ENVIRONMENT. THIS IS A SECURITY RISK.');
    }
  }

  get(): AppConfig {
    return this.config;
  }

  getFeature(featureName: keyof AppConfig['features']): boolean {
    return this.config.features[featureName];
  }

  getFirebase() {
    return this.config.firebase;
  }

  getApp() {
    return this.config.app;
  }

  getEnv() {
    return this.config.env;
  }

  isProduction(): boolean {
    return this.config.isProd;
  }

  isDevelopment(): boolean {
    return this.config.isDev;
  }
}

export const config = new Config();
