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
  const [isVisible, setIsVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    // Show first line after a brief delay
    const showTimer = setTimeout(() => setIsVisible(true), 100);

    return () => clearTimeout(showTimer);
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    // Each line stays for 1.8 seconds
    const lineTimer = setTimeout(() => {
      setIsVisible(false);
      
      // Wait for fade out animation (500ms) before showing next line
      setTimeout(() => {
        if (currentLine < lines.length - 1) {
          setCurrentLine(prev => prev + 1);
          setIsVisible(true);
        } else {
          // All lines shown, fade out preloader
          setFadeOut(true);
          setTimeout(() => onComplete(), 600);
        }
      }, 500);
    }, 1800);

    return () => clearTimeout(lineTimer);
  }, [currentLine, isVisible, onComplete]);

  return (
    <div 
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-white transition-opacity duration-500 ease-out ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="text-center px-6 max-w-2xl">
        <p 
          className={`text-xl md:text-3xl lg:text-4xl font-medium text-black leading-relaxed tracking-tight transition-all duration-500 ease-in-out ${
            isVisible 
              ? 'opacity-100 scale-100' 
              : 'opacity-0 scale-[0.8]'
          }`}
          style={{ 
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            minHeight: '3rem'
          }}
        >
          {lines[currentLine]}
        </p>

        {/* Progress dots */}
        <div className="mt-12 flex justify-center gap-2">
          {lines.map((_, index) => (
            <span 
              key={index}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                index === currentLine 
                  ? 'bg-black scale-125' 
                  : index < currentLine 
                    ? 'bg-black/40' 
                    : 'bg-black/20'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
