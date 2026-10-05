export interface SecondaryStandCapture {
  name: string;
  image: string;
}
export type SecondaryStandCaptureSink = (capture: SecondaryStandCapture) => Promise<void>;

/** Own the current frame synchronously, then persist it before rendering or
 * stepping again. Reports retain metadata, not every base64 PNG in memory. */
export async function persistSecondaryStandCapture(
  canvas: Pick<HTMLCanvasElement, 'toDataURL'>,
  name: string,
  sink: SecondaryStandCaptureSink,
): Promise<void> {
  const image = canvas.toDataURL('image/png');
  if (!image.startsWith('data:image/png;base64,') || image.length <= 22)
    throw new Error('A12 capture did not produce a PNG');
  await sink({ name, image });
}
