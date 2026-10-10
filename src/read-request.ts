import { t } from './i18n';
import type { HttpResponse, Transport } from './api';
import { ReadBudget } from './read-budget';

export interface ReadDiagnostic {
  path: string;
  attempt: number;
  elapsedMs: number;
  kind: 'response' | 'connection' | 'timeout';
  status?: number;
}

/** GET only. At most one sequential recovery after a settled transient failure.
 * Obsidian requestUrl cannot abort a transport, so late results are guarded.
 * All callers share this entire operation, including recovery and its deadline.
 */
export function recoverRead(url: string, transport: Transport, report: (event: ReadDiagnostic) => void, budget = new ReadBudget()): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const started = Date.now(), path = new URL(url).pathname;
    let settled = false, attempts = 0, active = 0;
    let lastResponse: HttpResponse | undefined, lastError: unknown;
    let retryTimer: number | undefined;
    const record = (attempt: number, kind: ReadDiagnostic['kind'], status?: number) => report({ path, attempt, elapsedMs: Date.now() - started, kind, status });
    const finish = (response?: HttpResponse, error?: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(deadline); window.clearTimeout(retryTimer);
      if (response) resolve(response); else reject(error instanceof Error ? error : new Error(t('error.networkUnavailable')));
    };
    const deadline = window.setTimeout(() => {
      record(attempts, 'timeout');
      finish(undefined, new Error(t('error.requestTimeout')));
    }, 20_000);
    const failed = () => {
      if (attempts < 2 && budget.allowRetry()) {
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(start, 1000 + Math.floor(Math.random() * 1000));
      } else if (!active) finish(lastResponse, lastError);
    };
    const start = () => {
      if (settled || attempts >= 2) return;
      const attempt = ++attempts; active++;
      // Keep the first call synchronous for the transport contract, but handle
      // synchronous transport errors just like rejected connection promises.
      const respond = (response: HttpResponse) => {
        if (settled) return;
        active--; record(attempt, 'response', response.status);
        if (![408, 502, 504].includes(response.status)) { finish(response); return; }
        lastResponse = response; failed();
      };
      const rejectAttempt = (error: unknown) => {
        if (settled) return;
        active--; lastError = error; record(attempt, 'connection'); failed();
      };
      try { void transport(url).then(respond, rejectAttempt); } catch (error) { rejectAttempt(error); }
    };
    start();
  });
}
