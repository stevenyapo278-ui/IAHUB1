import { useEffect, useRef } from 'react';
import { createXmasScene } from '../lib/xmasScene';

/**
 * Scène de Noël en canvas (sapin, neige, guirlandes, cadeaux, étincelles).
 *
 * Encapsule `createXmasScene` dans un composant React : montage/démontage propre,
 * adaptation à la taille du conteneur, respect de `prefers-reduced-motion`.
 *
 * @param {object} props
 * @param {string} [props.className]  Classes du conteneur (doit avoir une taille).
 * @param {boolean} [props.title]     Affiche « Joyeux Noël » en bas de la scène.
 * @param {boolean} [props.snow]      Active la neige (défaut true).
 * @param {boolean} [props.presents]  Affiche les cadeaux au pied du sapin (défaut true).
 * @param {boolean} [props.sparks]    Étincelles au survol/clic (défaut true).
 * @param {(api: object) => void} [props.onReady] Reçoit l'API (musique, resize…).
 */
export default function XmasScene({
  className = '',
  title = false,
  snow = true,
  presents = true,
  sparks = true,
  onReady,
}) {
  const canvasRef = useRef(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const api = createXmasScene(canvas, { snow, presents, sparks });
    onReadyRef.current?.(api);

    return () => {
      api.destroy();
    };
  }, [snow, presents, sparks]);

  return (
    <div className={`xmas-scene ${className}`.trim()}>
      <canvas ref={canvasRef} className="xmas-scene-canvas" aria-hidden="true" />
      {title && (
        <div className="xmas-scene-caption" aria-hidden="true">
          <h2 className="xmas-scene-title">Joyeux Noël</h2>
          <p className="xmas-scene-sub">Merry Christmas</p>
        </div>
      )}
    </div>
  );
}
