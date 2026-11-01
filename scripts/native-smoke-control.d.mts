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
export interface NativeAurelSurfaceReceipt {
  kind: 'formula-ribbon';
  roadChunks: number;
  paintChunks: number;
  leftPaintChunks: number;
  rightPaintChunks: number;
  vertices: number;
  paintFinishMaterials: number;
  asphaltSubstrateRoadChunks: number;
  asphaltSubstrateMaterials: number;
  asphaltSubstrateTextures: number;
  asphaltSubstrateSrgbTextures: number;
  gantryState: string;
  gantryParts: number;
  gantryMaterials: number;
  gantryTextures: number;
  gantryTriangles: number;
  gantrySha256: string;
  coarseMeshes: number;
}
export function validateNativeAurelSurface(value: unknown): NativeAurelSurfaceReceipt;
