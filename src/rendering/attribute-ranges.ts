import type * as T from 'three';

/** Maximum disjoint pending spans before falling back to a full upload. */
const MAX_PENDING_RANGES = 16;

/** Upload only items `first..last` (inclusive) of a dynamic attribute at its
 * next render. Ranges added before that render merge; an empty span is a
 * no-op, so an unchanged attribute costs no transfer at all. */
export function markItems(attribute: T.BufferAttribute, first: number, last: number) {
  if (last < first) return;
  const size = attribute.itemSize;
  let start = first * size;
  let end = start + (last - first + 1) * size;
  const ranges = attribute.updateRanges;

  // A contained mark, including one after markAll(), needs no bookkeeping.
  if (ranges.length === 1 && start >= ranges[0].start && end <= ranges[0].start + ranges[0].count) {
    attribute.needsUpdate = true;
    return;
  }

  // Also normalize ranges added directly through Three's public API. Work in
  // place so repeated marks do not allocate another pending entry each time.
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
