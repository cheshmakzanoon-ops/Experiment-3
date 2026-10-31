export interface DesktopSmokeJourney {
  requestedJourney: 'full' | 'compatibility-diagnostic';
  diagnosticOnly: boolean;
  omittedChecks: string[];
}
export function desktopSmokeJourney(value?: string): DesktopSmokeJourney;
export function runDesktopSmokeJourneys(
  journey: DesktopSmokeJourney,
  checks: {
    authoredModel(): Promise<void>;
    captureBabylon(): Promise<void>;
    compatibility(): Promise<void>;
  },
): Promise<void>;
export interface FirstGraphicsFault {
  record(message: string): void;
  read(): Error | undefined;
  wait<T>(operation: () => Promise<T>): Promise<T>;
}
export function createFirstGraphicsFault(): FirstGraphicsFault;
export function retainNativeSmokeFailure(
  report: { success?: boolean; failure?: string },
  error: unknown,
  graphicsFailure: FirstGraphicsFault,
): void;
