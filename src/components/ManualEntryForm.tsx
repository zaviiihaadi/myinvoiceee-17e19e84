import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, X } from 'lucide-react';

interface ManualEntryFormProps {
  onTrack: (containerNumber: string) => void;
  isTracking: boolean;
}

const CONTAINER_REGEX = /^[A-Z]{4}\d{7}$/;

export function ManualEntryForm({ onTrack, isTracking }: ManualEntryFormProps) {
  const [containerNumber, setContainerNumber] = useState('');
  const [error, setError] = useState('');

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

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={containerNumber}
            onChange={handleChange}
            placeholder="Enter container number (e.g., MSCU1234567)"
            className="pl-10 pr-10 h-12 text-base font-mono tracking-wide"
            disabled={isTracking}
          />
          {containerNumber && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Button 
          type="submit" 
          disabled={isTracking || !containerNumber}
          className="h-12 px-6 gap-2"
        >
          <Plus className="w-4 h-4" />
          Track
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive animate-fade-in">{error}</p>
      )}
      <p className="text-xs text-muted-foreground">
        Format: 4 letters (owner code) + 7 digits (serial + check digit)
      </p>
    </form>
  );
}
