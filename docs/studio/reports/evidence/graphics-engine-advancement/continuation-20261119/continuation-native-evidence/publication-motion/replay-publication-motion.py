from pathlib import Path
import json
import sys

# Arithmetic replay only; no simulation, source mutation, or race.
source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name('native-rider-samples.json')
data = json.loads(source.read_text())
samples = [dict(zip(data['columns'], row)) for row in data['rows']]
rows = []
for previous, current in zip(samples, samples[1:]):
    dt = current['t'] - previous['t']
    if dt <= 0:
        raise ValueError('Samples must advance in time')
    rate = ((current['tactical'] + current['launch']) - (previous['tactical'] + previous['launch'])) / dt
    rows.append({
        't': current['t'], 's': current['s'], 'rawSelectedRate': rate,
        'publishedOffsetDifferenceRate': (current['aiOffset'] - previous['aiOffset']) / dt,
        'absoluteOffsetDifferenceRate': (current['baseOffset'] - previous['baseOffset']) / dt,
        'steeringTargetDifferenceRate': (current['steeringTarget'] - previous['steeringTarget']) / dt,
        'lag': current['baseOffset'] - current['lateral'], 'aiOffset': current['aiOffset'],
        'nearEdgeApprox': current['width'] - 2.4,
    })
rows.sort(key=lambda row: abs(row['publishedOffsetDifferenceRate'] - row['rawSelectedRate']), reverse=True)
print(json.dumps({
    'candidate': data['candidate'], 'sourceHashes': data['sourceHashes'],
    'originalTraceSha256': data['originalTraceSha256'],
    'sampleCount': len(samples),
    'observedSlewIntervals': sum(abs(abs(row['rawSelectedRate']) - 1.6) < 1e-5 for row in rows),
    'largestPublicationContamination': rows[:4],
    'limitation': 'The nominal 1.6 m/s criterion only counts observed intervals. This does not identify the sole cause of a fall or establish acceptance of temporal compensation.',
}, indent=2))
