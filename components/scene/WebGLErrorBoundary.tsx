'use client';

import React, { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class WebGLErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[WebGLErrorBoundary] Caught WebGL/Render error:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errorMessage = this.state.error?.message ?? 'Unknown WebGL failure';
      const isContextError =
        errorMessage.includes('WebGL') ||
        errorMessage.includes('context') ||
        errorMessage.includes('BindToCurrentSequence') ||
        errorMessage.includes('Renderer');

      return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#07070a]/95 p-6 backdrop-blur-md">
          <div className="w-full max-w-xl rounded-2xl border border-red-500/30 bg-[#0f0f15] p-8 shadow-2xl shadow-red-950/40">
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-400 ring-1 ring-red-500/20">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-wide text-white">
                  {isContextError ? 'WebGL Context Initialization Failed' : '3D Viewport Error'}
                </h2>
                <p className="text-xs text-zinc-400">
                  Your browser was unable to allocate a 3D graphics rendering context.
                </p>
              </div>
            </div>

            {/* Error Detail */}
            <div className="mt-4 rounded-lg border border-red-500/20 bg-red-950/20 p-3 text-xs font-mono text-red-300 break-words">
              {errorMessage}
            </div>

            {/* Troubleshooting Guide */}
            <div className="mt-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                How to resolve this in Chrome / Edge:
              </h3>
              <ol className="space-y-2 text-xs text-zinc-300">
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white">
                    1
                  </span>
                  <span>
                    <strong className="text-white">Enable Hardware Acceleration:</strong> Open{' '}
                    <code className="rounded bg-black/40 px-1.5 py-0.5 text-zinc-200">
                      chrome://settings/system
                    </code>{' '}
                    (or <code className="rounded bg-black/40 px-1.5 py-0.5 text-zinc-200">edge://settings/system</code>
                    ) and turn <strong className="text-emerald-400">ON</strong> &quot;Use graphics acceleration when available&quot;.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white">
                    2
                  </span>
                  <span>
                    <strong className="text-white">Restart the GPU Process:</strong> In the URL bar,
                    navigate to{' '}
                    <code className="rounded bg-black/40 px-1.5 py-0.5 text-zinc-200">
                      chrome://restart
                    </code>{' '}
                    and hit Enter to quickly reboot the browser&apos;s GPU process.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white">
                    3
                  </span>
                  <span>
                    <strong className="text-white">Verify WebGL:</strong> Check{' '}
                    <code className="rounded bg-black/40 px-1.5 py-0.5 text-zinc-200">
                      chrome://gpu
                    </code>{' '}
                    to verify that WebGL &amp; WebGL2 say <em>&quot;Hardware accelerated&quot;</em>.
                  </span>
                </li>
              </ol>
            </div>

            {/* Action Buttons */}
            <div className="mt-6 flex items-center justify-end gap-3 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={this.handleReload}
                className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-xs font-medium text-white transition hover:bg-white/10"
              >
                Reload Page
              </button>
              <button
                type="button"
                onClick={this.handleRetry}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-red-900/30 transition hover:bg-red-500"
              >
                Retry Initialization
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
