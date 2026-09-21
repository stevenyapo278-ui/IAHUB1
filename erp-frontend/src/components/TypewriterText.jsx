import { useState, useEffect, useRef } from 'react';
import MarkdownContent from './MarkdownContent';

export default function TypewriterText({ content, speed = 18, isNew = true }) {
  const [displayedLength, setDisplayedLength] = useState(0);
  const [done, setDone] = useState(!isNew);
  const revealedRef = useRef(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (done) return;

    const fullLen = (content || '').length;

    if (revealedRef.current === 0 && fullLen > 0) {
      revealedRef.current = 0;
      setDisplayedLength(0);

      intervalRef.current = setInterval(() => {
        revealedRef.current += 1;
        if (revealedRef.current >= fullLen) {
          revealedRef.current = fullLen;
          setDisplayedLength(fullLen);
          setDone(true);
          clearInterval(intervalRef.current);
        } else {
          setDisplayedLength(revealedRef.current);
        }
      }, speed);
    } else if (revealedRef.current >= fullLen) {
      setDisplayedLength(fullLen);
      setDone(true);
    } else {
      setDisplayedLength(fullLen);
      setDone(true);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [content, speed, done]);

  if (!content) return null;

  const text = done ? content : content.slice(0, displayedLength);

  return (
    <span className="typewriter-wrapper">
      <MarkdownContent content={text} />
      {!done && <span className="typewriter-cursor" />}
    </span>
  );
}
