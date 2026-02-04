import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Bell, BellOff, Mail, Check, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface EmailNotificationFormProps {
  onSubscribe: (email: string) => void;
  onUnsubscribe: () => void;
  subscribedEmail: string | null;
}

export function EmailNotificationForm({ onSubscribe, onUnsubscribe, subscribedEmail }: EmailNotificationFormProps) {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

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
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center gap-3 p-3 bg-status-arrived/10 border border-status-arrived/20 rounded-xl"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <motion.div 
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
            className="w-8 h-8 rounded-lg bg-status-arrived/20 flex items-center justify-center flex-shrink-0"
          >
            <Check className="w-4 h-4 text-status-arrived" />
          </motion.div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">Notifications active</p>
            <p className="text-xs text-muted-foreground truncate">{subscribedEmail}</p>
          </div>
        </div>
        <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
          <Button
            variant="ghost"
            size="icon"
            onClick={onUnsubscribe}
            className="flex-shrink-0 text-muted-foreground hover:text-destructive rounded-lg h-8 w-8"
          >
            <BellOff className="w-4 h-4" />
          </Button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <div className="relative flex-1">
        <motion.div 
          className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-primary via-accent to-primary opacity-0 blur-sm"
          animate={{ 
            opacity: isFocused ? 0.3 : 0,
            backgroundPosition: ['0% 50%', '100% 50%', '0% 50%']
          }}
          transition={{ 
            opacity: { duration: 0.2 },
            backgroundPosition: { duration: 3, repeat: Infinity, ease: "linear" }
          }}
          style={{ backgroundSize: '200% 200%' }}
        />
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="email"
            placeholder="Enter email for alerts"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="pl-9 h-10 rounded-xl border-border/60 bg-background/80"
            disabled={isSubmitting}
          />
        </div>
      </div>
      <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
        <Button 
          type="submit" 
          disabled={isSubmitting} 
          size="sm"
          className="h-10 gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/90 shadow-md shadow-primary/20"
        >
          <Bell className="w-4 h-4" />
          <span className="hidden sm:inline">Notify</span>
        </Button>
      </motion.div>
    </form>
  );
}
