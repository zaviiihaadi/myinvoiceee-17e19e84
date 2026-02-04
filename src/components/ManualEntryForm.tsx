import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, ArrowRight, X, Sparkles } from 'lucide-react';

interface ManualEntryFormProps {
  onTrack: (containerNumber: string) => void;
  isTracking: boolean;
}

const CONTAINER_REGEX = /^[A-Z]{4}\d{7}$/;

export function ManualEntryForm({ onTrack, isTracking }: ManualEntryFormProps) {
  const [containerNumber, setContainerNumber] = useState('');
  const [error, setError] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const formatContainerNumber = (value: string): string => {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatContainerNumber(e.target.value);
    setContainerNumber(formatted);
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!containerNumber.trim()) {
      setError('Please enter a container number');
      return;
    }

    if (!CONTAINER_REGEX.test(containerNumber)) {
      setError('Invalid format. Use 4 letters + 7 digits (e.g., MSCU1234567)');
      return;
    }

    onTrack(containerNumber);
    setContainerNumber('');
  };

  const handleClear = () => {
    setContainerNumber('');
    setError('');
  };

  const isValid = CONTAINER_REGEX.test(containerNumber);
  const progress = Math.min(containerNumber.length / 11, 1) * 100;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="relative">
        {/* Animated border effect */}
        <motion.div 
          className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-primary via-accent to-primary opacity-0"
          animate={{ 
            opacity: isFocused ? 0.5 : 0,
            backgroundPosition: ['0% 50%', '100% 50%', '0% 50%']
          }}
          transition={{ 
            opacity: { duration: 0.2 },
            backgroundPosition: { duration: 3, repeat: Infinity, ease: "linear" }
          }}
          style={{ backgroundSize: '200% 200%' }}
        />
        
        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10">
              <motion.div
                animate={{ scale: isFocused ? 1.1 : 1 }}
                transition={{ duration: 0.2 }}
              >
                <Search className="w-5 h-5 text-muted-foreground" />
              </motion.div>
            </div>
            <Input
              value={containerNumber}
              onChange={handleChange}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="MSCU1234567"
              className="h-14 pl-12 pr-12 text-lg font-mono tracking-widest rounded-xl border-2 border-border/60 bg-background/80 backdrop-blur-sm focus:border-primary/50 transition-all duration-300"
              disabled={isTracking}
            />
            <AnimatePresence>
              {containerNumber && (
                <motion.button
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  type="button"
                  onClick={handleClear}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-full hover:bg-muted"
                >
                  <X className="w-4 h-4" />
                </motion.button>
              )}
            </AnimatePresence>

            {/* Progress indicator */}
            <motion.div 
              className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-primary to-accent rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.2 }}
            />
          </div>

          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Button 
              type="submit" 
              disabled={isTracking || !containerNumber}
              className="h-14 px-6 rounded-xl bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 gap-2 font-semibold"
            >
              {isTracking ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                >
                  <Sparkles className="w-5 h-5" />
                </motion.div>
              ) : (
                <>
                  <span className="hidden sm:inline">Track</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </Button>
          </motion.div>
        </div>
      </div>

      {/* Validation feedback */}
      <div className="flex items-center justify-between">
        <AnimatePresence mode="wait">
          {error ? (
            <motion.p 
              key="error"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-sm text-destructive font-medium"
            >
              {error}
            </motion.p>
          ) : containerNumber && !isValid ? (
            <motion.p 
              key="hint"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-sm text-muted-foreground"
            >
              {11 - containerNumber.length} more characters needed
            </motion.p>
          ) : isValid ? (
            <motion.p 
              key="valid"
              initial={{ opacity: 0, y: -10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-sm text-status-arrived font-medium flex items-center gap-1"
            >
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500 }}
              >
                ✓
              </motion.span>
              Valid container number
            </motion.p>
          ) : (
            <motion.p 
              key="format"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-muted-foreground"
            >
              Format: 4 letters + 7 digits
            </motion.p>
          )}
        </AnimatePresence>

        {/* Character counter */}
        <span className="text-xs text-muted-foreground font-mono">
          {containerNumber.length}/11
        </span>
      </div>
    </form>
  );
}
