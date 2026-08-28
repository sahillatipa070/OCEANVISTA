import { SkipBack, Play, Pause, SkipForward } from 'lucide-react';
import { useEffect } from 'react';
import { useOceanStore } from '../store/oceanStore';

export default function Timeline() {
  const s = useOceanStore();

  const labels = s.dataTimes || [];

  useEffect(() => {
    if (!s.playing) return;
    if (labels.length <= 1) return;

    const ms = 1600 / s.speed;

    const timer = setInterval(() => {
      s.set('timeIndex', (s.timeIndex + 1) % labels.length);
    }, ms);

    return () => clearInterval(timer);
  }, [s.playing, s.speed, s.timeIndex, labels.length]);

  const previous = () => {
    if (!labels.length) return;
    s.set('timeIndex', Math.max(0, s.timeIndex - 1));
  };

  const next = () => {
    if (!labels.length) return;
    s.set('timeIndex', Math.min(labels.length - 1, s.timeIndex + 1));
  };

  return (
    <footer className="timeline">
      <div className="playback">
        <button onClick={previous} disabled={!labels.length}>
          <SkipBack />
        </button>

        <button
          className="play"
          onClick={() => s.set('playing', !s.playing)}
          disabled={labels.length <= 1}
        >
          {s.playing ? <Pause /> : <Play />}
        </button>

        <button onClick={next} disabled={!labels.length}>
          <SkipForward />
        </button>

        <select
          value={s.speed}
          onChange={e => s.set('speed', +e.target.value)}
        >
          {[0.5, 1, 2, 4].map(x => (
            <option key={x} value={x}>
              {x}x
            </option>
          ))}
        </select>
      </div>

      <div className="track">
        {labels.length > 0 ? (
          labels.map((t, i) => (
            <button
              className={i === s.timeIndex ? 'now' : ''}
              key={`${t}-${i}`}
              onClick={() => s.set('timeIndex', i)}
            >
              <i />
              {t}
            </button>
          ))
        ) : (
          <div className="no-times">
            Upload a model dataset to load available times
          </div>
        )}

        <div className="pastpresent">
          <span>PAST</span>
          <b>PRESENT</b>
          <span>FORECAST →</span>
        </div>
      </div>
    </footer>
  );
}