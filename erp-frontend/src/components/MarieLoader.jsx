export default function MarieLoader() {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-0">
        <svg height="0" width="0" viewBox="0 0 64 64" className="absolute">
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" y2="2" x2="0" y1="62" x1="0" id="g-m">
              <stop stopColor="var(--skin-primary, #0067ff)"></stop>
              <stop stopColor="var(--skin-info, #0ea5e9)" offset="1"></stop>
            </linearGradient>
            <linearGradient gradientUnits="userSpaceOnUse" y2="2" x2="0" y1="62" x1="0" id="g-a">
              <stop stopColor="var(--skin-info, #0ea5e9)"></stop>
              <stop stopColor="var(--skin-primary, #0067ff)" offset="1"></stop>
            </linearGradient>
            <linearGradient gradientUnits="userSpaceOnUse" y2="2" x2="0" y1="62" x1="0" id="g-r">
              <stop stopColor="var(--skin-primary, #0067ff)"></stop>
              <stop stopColor="var(--skin-info, #0ea5e9)" offset="1"></stop>
            </linearGradient>
            <linearGradient gradientUnits="userSpaceOnUse" y2="2" x2="0" y1="62" x1="0" id="g-i">
              <stop stopColor="var(--skin-info, #0ea5e9)"></stop>
              <stop stopColor="var(--skin-primary, #0067ff)" offset="1"></stop>
            </linearGradient>
            <linearGradient gradientUnits="userSpaceOnUse" y2="2" x2="0" y1="62" x1="0" id="g-e">
              <stop stopColor="var(--skin-primary, #0067ff)"></stop>
              <stop stopColor="var(--skin-info, #0ea5e9)" offset="1"></stop>
            </linearGradient>
            <linearGradient gradientUnits="userSpaceOnUse" y2="2" x2="0" y1="62" x1="0" id="g-i2">
              <stop stopColor="var(--skin-info, #0ea5e9)"></stop>
              <stop stopColor="var(--skin-primary, #0067ff)" offset="1"></stop>
            </linearGradient>
            <linearGradient gradientUnits="userSpaceOnUse" y2="2" x2="0" y1="62" x1="0" id="g-a2">
              <stop stopColor="var(--skin-primary, #0067ff)"></stop>
              <stop stopColor="var(--skin-info, #0ea5e9)" offset="1"></stop>
            </linearGradient>
          </defs>
        </svg>

        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 64 64" height="28" width="28" className="inline-block">
          <path strokeLinejoin="round" strokeLinecap="round" strokeWidth="8" stroke="url(#g-m)" d="M 12,56 L 12,12 L 32,36 L 52,12 L 52,56" className="marie-dash" pathLength="360"></path>
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 64 64" height="28" width="28" className="inline-block">
          <path strokeLinejoin="round" strokeLinecap="round" strokeWidth="8" stroke="url(#g-a)" d="M 12,56 L 32,12 L 52,56 M 22,40 L 42,40" className="marie-dash" pathLength="360"></path>
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 64 64" height="28" width="28" className="inline-block">
          <path strokeLinejoin="round" strokeLinecap="round" strokeWidth="8" stroke="url(#g-r)" d="M 16,56 L 16,12 C 45,12 45,36 16,36 L 48,56" className="marie-dash" pathLength="360"></path>
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 64 64" height="28" width="28" className="inline-block">
          <path strokeLinejoin="round" strokeLinecap="round" strokeWidth="8" stroke="url(#g-i)" d="M 32,12 L 32,56" className="marie-dash" pathLength="360"></path>
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 64 64" height="28" width="28" className="inline-block">
          <path strokeLinejoin="round" strokeLinecap="round" strokeWidth="8" stroke="url(#g-e)" d="M 50,12 L 16,12 L 16,56 L 50,56 M 16,34 L 42,34" className="marie-dash" pathLength="360"></path>
        </svg>
        <div className="w-3"></div>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 64 64" height="28" width="28" className="inline-block">
          <path strokeLinejoin="round" strokeLinecap="round" strokeWidth="8" stroke="url(#g-i2)" d="M 32,12 L 32,56" className="marie-dash" pathLength="360"></path>
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 64 64" height="28" width="28" className="inline-block">
          <path strokeLinejoin="round" strokeLinecap="round" strokeWidth="8" stroke="url(#g-a2)" d="M 12,56 L 32,12 L 52,56 M 22,40 L 42,40" className="marie-dash" pathLength="360"></path>
        </svg>
      </div>
    </div>
  );
}
