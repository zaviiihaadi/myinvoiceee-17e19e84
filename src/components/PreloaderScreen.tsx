import { useState, useEffect } from 'react';

interface PreloaderScreenProps {
  onComplete: () => void;
}

export function PreloaderScreen({ onComplete }: PreloaderScreenProps) {
  const [stage, setStage] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    // Stage 1: Lines 1 & 2 appear (0ms)
    const timer1 = setTimeout(() => setStage(1), 100);
    
    // Stage 2: Line 3 appears (1000ms)
    const timer2 = setTimeout(() => setStage(2), 1200);
    
    // Stage 3: Line 4 appears (2000ms)
    const timer3 = setTimeout(() => setStage(3), 2200);
    
    // Fade out (3200ms)
    const timer4 = setTimeout(() => setFadeOut(true), 3400);
    
    // Complete (3700ms)
    const timer5 = setTimeout(() => onComplete(), 3900);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
      clearTimeout(timer5);
    };
  }, [onComplete]);

  return (
    <div 
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-white transition-opacity duration-500 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="text-center px-6 max-w-2xl">
        {/* Lines 1 & 2 */}
        <div 
          className={`transition-all duration-700 ease-out ${
            stage >= 1 
              ? 'opacity-100 scale-100' 
              : 'opacity-0 scale-75'
          }`}
        >
          <h1 className="text-2xl md:text-4xl font-bold text-black mb-2 tracking-tight">
            Hey, My Name is Abdullah Jatoi
          </h1>
          <p className="text-xl md:text-2xl text-black/90 font-medium mb-8">
            and I Am a Software Developer.
          </p>
        </div>

        {/* Line 3 */}
        <p 
          className={`text-lg md:text-xl text-black/80 mb-3 transition-all duration-700 ease-out delay-100 ${
            stage >= 2 
              ? 'opacity-100 scale-100' 
              : 'opacity-0 scale-75'
          }`}
        >
          This Website is free
        </p>

        {/* Line 4 */}
        <p 
          className={`text-base md:text-lg text-black/70 max-w-md mx-auto leading-relaxed transition-all duration-700 ease-out delay-100 ${
            stage >= 3 
              ? 'opacity-100 scale-100' 
              : 'opacity-0 scale-75'
          }`}
        >
          If you wish, you can make a donation so that we can move forward.
        </p>

        {/* Subtle loading indicator */}
        <div 
          className={`mt-10 flex justify-center gap-1.5 transition-all duration-500 ${
            stage >= 1 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span className="w-2 h-2 bg-black/30 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-black/30 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-black/30 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}
