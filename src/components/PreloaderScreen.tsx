import { useState, useEffect } from 'react';

interface PreloaderScreenProps {
  onComplete: () => void;
}

const lines = [
  "Hey, My Name is Abdullah Jatoi",
  "and I Am a Software Developer.",
  "This Website is free",
  "If you wish, you can make a donation so that we can move forward."
];

export function PreloaderScreen({ onComplete }: PreloaderScreenProps) {
  const [currentLine, setCurrentLine] = useState(0);
  const [animationPhase, setAnimationPhase] = useState<'reveal' | 'hold' | 'hide'>('reveal');
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const revealDuration = 800;  // Time for text to reveal
    const holdDuration = 1200;   // Time to hold visible
    const hideDuration = 400;    // Time to fade out

    let timer: NodeJS.Timeout;

    if (animationPhase === 'reveal') {
      timer = setTimeout(() => {
        setAnimationPhase('hold');
      }, revealDuration);
    } else if (animationPhase === 'hold') {
      timer = setTimeout(() => {
        setAnimationPhase('hide');
      }, holdDuration);
    } else if (animationPhase === 'hide') {
      timer = setTimeout(() => {
        if (currentLine < lines.length - 1) {
          setCurrentLine(prev => prev + 1);
          setAnimationPhase('reveal');
        } else {
          setFadeOut(true);
          setTimeout(() => onComplete(), 600);
        }
      }, hideDuration);
    }

    return () => clearTimeout(timer);
  }, [currentLine, animationPhase, onComplete]);

  return (
    <div 
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-white transition-opacity duration-600 ease-out ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="text-center px-6 max-w-3xl">
        <div className="relative overflow-hidden">
          <p 
            className={`
              text-xl md:text-2xl lg:text-3xl font-light text-black leading-relaxed tracking-wide
              transition-all duration-500 ease-out
              ${animationPhase === 'reveal' ? 'animate-text-reveal' : ''}
              ${animationPhase === 'hold' ? 'opacity-100' : ''}
              ${animationPhase === 'hide' ? 'animate-text-hide' : ''}
            `}
            style={{ 
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontWeight: 300,
              minHeight: '2.5rem'
            }}
          >
            <span className="inline-block overflow-hidden">
              <span 
                className={`
                  inline-block
                  ${animationPhase === 'reveal' ? 'animate-slide-reveal' : ''}
                  ${animationPhase === 'hide' ? 'animate-slide-hide' : ''}
                `}
              >
                {lines[currentLine]}
              </span>
            </span>
          </p>
        </div>

        {/* Elegant progress indicator */}
        <div className="mt-16 flex justify-center items-center gap-3">
          {lines.map((_, index) => (
            <div 
              key={index}
              className="relative h-[2px] w-8 bg-black/10 overflow-hidden rounded-full"
            >
              <div 
                className={`
                  absolute inset-y-0 left-0 bg-black rounded-full transition-all duration-500 ease-out
                  ${index < currentLine ? 'w-full' : index === currentLine ? 'animate-progress-fill' : 'w-0'}
                `}
              />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes slideReveal {
          0% {
            transform: translateX(-100%) scale(0.95);
            opacity: 0;
          }
          100% {
            transform: translateX(0) scale(1);
            opacity: 1;
          }
        }

        @keyframes slideHide {
          0% {
            transform: translateX(0) scale(1);
            opacity: 1;
          }
          100% {
            transform: translateX(100%) scale(0.95);
            opacity: 0;
          }
        }

        @keyframes textReveal {
          0% {
            clip-path: inset(0 100% 0 0);
            opacity: 0;
          }
          100% {
            clip-path: inset(0 0 0 0);
            opacity: 1;
          }
        }

        @keyframes textHide {
          0% {
            clip-path: inset(0 0 0 0);
            opacity: 1;
          }
          100% {
            clip-path: inset(0 0 0 100%);
            opacity: 0;
          }
        }

        @keyframes progressFill {
          0% {
            width: 0;
          }
          100% {
            width: 100%;
          }
        }

        .animate-slide-reveal {
          animation: slideReveal 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        .animate-slide-hide {
          animation: slideHide 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        .animate-text-reveal {
          animation: textReveal 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        .animate-text-hide {
          animation: textHide 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        .animate-progress-fill {
          animation: progressFill 2.4s ease-out forwards;
        }

        .duration-600 {
          transition-duration: 600ms;
        }
      `}</style>
    </div>
  );
}
