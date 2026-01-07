import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Bell, BellOff, Mail, Check } from 'lucide-react';
import { toast } from 'sonner';

interface EmailNotificationFormProps {
  onSubscribe: (email: string) => void;
  onUnsubscribe: () => void;
  subscribedEmail: string | null;
}

export function EmailNotificationForm({ onSubscribe, onUnsubscribe, subscribedEmail }: EmailNotificationFormProps) {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      toast.error('Please enter an email address');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error('Please enter a valid email address');
      return;
    }

    setIsSubmitting(true);
    
    try {
      onSubscribe(email);
      toast.success('Email notifications enabled!');
      setEmail('');
    } catch (error) {
      toast.error('Failed to enable notifications');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (subscribedEmail) {
    return (
      <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Check className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">Notifications enabled</p>
            <p className="text-xs text-muted-foreground truncate">{subscribedEmail}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onUnsubscribe}
          className="flex-shrink-0 text-muted-foreground hover:text-destructive"
        >
          <BellOff className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <div className="relative flex-1">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="email"
          placeholder="Enter email for status alerts"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="pl-9"
          disabled={isSubmitting}
        />
      </div>
      <Button type="submit" disabled={isSubmitting} className="gap-2">
        <Bell className="w-4 h-4" />
        <span className="hidden sm:inline">Notify Me</span>
      </Button>
    </form>
  );
}
