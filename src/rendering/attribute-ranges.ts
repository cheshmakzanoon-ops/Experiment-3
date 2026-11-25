import type * as T from 'three';

/** Maximum pending entries before checking their union for a full upload. */
const MAX_PENDING_RANGES = 16;

/** Upload only items `first..last` (inclusive) of a dynamic attribute at its
 * next render. Three merges pending ranges before uploading; an empty span is
 * a no-op, so an unchanged attribute costs no transfer at all. */
export function markItems(attribute: T.BufferAttribute, first: number, last: number) {
  if (last < first) return;
  const size = attribute.itemSize;
  let start = first * size;
  let end = start + (last - first + 1) * size;
  const ranges = attribute.updateRanges;

  // Most producers extend their last span or append a separate one. Keep this
  // path constant-time; Three sorts and coalesces the public list at upload.
  // Do not cache order or coverage: callers may directly mutate updateRanges.
  if (ranges.length <= MAX_PENDING_RANGES) {
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous.start + previous.count && end >= previous.start) {
      if (start < previous.start) {
        previous.count += previous.start - start;
        previous.start = start;
      }
      if (end > previous.start + previous.count) previous.count = end - previous.start;
      attribute.needsUpdate = true;
      return;
    }
    if (ranges.length < MAX_PENDING_RANGES) {
      attribute.addUpdateRange(start, end - start);
      attribute.needsUpdate = true;
      return;
    }
  }

  // At capacity, normalize the actual public list before deciding fallback.
  // A duplicate or bridge can fit even when all pending entries are occupied.
  if (ranges.length > 1) {
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].start < ranges[i - 1].start) {
        ranges.sort((a, b) => a.start - b.start);
        break;
      }
    }
    let count = 0;
    for (const range of ranges) {
      const previous = ranges[count - 1];
      if (previous && range.start <= previous.start + previous.count)
        previous.count = Math.max(previous.count, range.start + range.count - previous.start);
      else ranges[count++] = range;
    }
    ranges.length = count;
  }

  let firstRange = 0;
  while (firstRange < ranges.length && ranges[firstRange].start + ranges[firstRange].count < start)
    firstRange++;
  let afterRange = firstRange;
  while (afterRange < ranges.length && ranges[afterRange].start <= end) {
    const range = ranges[afterRange++];
    start = Math.min(start, range.start);
    end = Math.max(end, range.start + range.count);
  }

  // Count the union before inserting: even a seventeenth mark can bridge
  // several spans, and the pending list never needs a seventeenth entry.
  if (ranges.length - (afterRange - firstRange) + 1 > MAX_PENDING_RANGES) {
    markAll(attribute);
    return;
  }
  if (afterRange === firstRange) ranges.splice(firstRange, 0, { start, count: end - start });
  else {
    ranges[firstRange].start = start;
    ranges[firstRange].count = end - start;
    ranges.splice(firstRange + 1, afterRange - firstRange - 1);
  }
  attribute.needsUpdate = true;
}

/** Upload the whole attribute at its next render. An explicit full range,
 * rather than an empty range list, keeps later partial marks in the same
 * frame from narrowing the upload. */
export function markAll(attribute: T.BufferAttribute) {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, attribute.array.length);
  attribute.needsUpdate = true;
}
