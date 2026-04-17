import * as React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: any) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleRetry = () => {
    window.location.reload();
  };

  public render() {
    const state = (this as any).state;
    if (state.hasError) {
      let displayMessage = "A system error has occurred.";
      
      try {
        if (state.error?.message) {
          const parsed = JSON.parse(state.error.message);
          if (parsed.error) {
            displayMessage = `Security Error: ${parsed.error}`;
          }
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-[#F0F0EE] flex items-center justify-center p-4">
          <div className="max-w-md w-full hd-card space-y-6 text-center">
            <div className="flex justify-center">
              <div className="p-3 bg-red-100 rounded-full">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
            </div>
            <div className="space-y-2">
              <h2 className="hd-mono font-black text-xl tracking-tighter uppercase text-red-600">system_failure_detected</h2>
              <p className="hd-label text-muted leading-tight">
                {displayMessage}
              </p>
            </div>
            <div className="pt-4">
              <Button 
                onClick={this.handleRetry}
                className="w-full rounded-none hd-mono text-xs py-6 bg-ink text-bg hover:bg-[#2A2A2A]"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                INITIATE_RECOVERY_PROTOCOL
              </Button>
            </div>
            <div className="text-[10px] hd-mono text-muted opacity-50 uppercase">
              Debug Info: {state.error?.name || 'unknown_error'}
            </div>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default ErrorBoundary;
