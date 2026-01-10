import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Ship, Loader2, Mail, Lock, AlertCircle, ArrowLeft, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

const authSchema = z.object({
  email: z.string().trim().email({ message: "Please enter a valid email address" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }),
});

type AuthStep = 'auth' | 'verify';

const Auth = () => {
  const navigate = useNavigate();
  const { user, loading, signUp, signIn } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [step, setStep] = useState<AuthStep>('auth');
  const [verificationCode, setVerificationCode] = useState('');
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  // Check if user is verified when logged in
  useEffect(() => {
    const checkVerification = async () => {
      if (user && !loading) {
        // Check if email is verified
        const { data: profile } = await supabase
          .from('profiles')
          .select('email_verified')
          .eq('user_id', user.id)
          .maybeSingle();

        if (profile?.email_verified) {
          navigate('/');
        } else {
          // User is logged in but not verified
          setPendingUserId(user.id);
          setEmail(user.email || '');
          setStep('verify');
          // Send verification code automatically
          sendVerificationCode(user.id, user.email || '');
        }
      }
    };

    checkVerification();
  }, [user, loading, navigate]);

  const sendVerificationCode = async (userId: string, userEmail: string) => {
    try {
      const response = await supabase.functions.invoke('verify-email', {
        body: { email: userEmail, userId },
      });

      if (response.error) {
        console.error('Error sending verification code:', response.error);
        toast.error('Failed to send verification code');
      } else {
        toast.success('Verification code sent to your email!');
      }
    } catch (error) {
      console.error('Error sending verification code:', error);
      toast.error('Failed to send verification code');
    }
  };

  const validateForm = () => {
    try {
      authSchema.parse({ email, password });
      setErrors({});
      return true;
    } catch (err) {
      if (err instanceof z.ZodError) {
        const fieldErrors: { email?: string; password?: string } = {};
        err.errors.forEach((error) => {
          if (error.path[0] === 'email') fieldErrors.email = error.message;
          if (error.path[0] === 'password') fieldErrors.password = error.message;
        });
        setErrors(fieldErrors);
      }
      return false;
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    const { error } = await signUp(email, password);
    
    if (error) {
      setIsSubmitting(false);
      if (error.message.includes('already registered')) {
        toast.error('This email is already registered. Please sign in instead.');
      } else {
        toast.error(error.message);
      }
    } else {
      // Get the user ID and send verification code
      const { data: { user: newUser } } = await supabase.auth.getUser();
      if (newUser) {
        setPendingUserId(newUser.id);
        await sendVerificationCode(newUser.id, email);
        setStep('verify');
        toast.success('Account created! Please verify your email.');
      }
      setIsSubmitting(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    const { error } = await signIn(email, password);
    
    if (error) {
      setIsSubmitting(false);
      if (error.message.includes('Invalid login credentials')) {
        toast.error('Invalid email or password. Please try again.');
      } else {
        toast.error(error.message);
      }
    }
    // User state change will trigger the useEffect to check verification
  };

  const handleVerifyCode = async () => {
    if (verificationCode.length !== 6 || !pendingUserId) {
      toast.error('Please enter the 6-digit code');
      return;
    }

    setIsVerifying(true);
    try {
      const response = await supabase.functions.invoke('verify-email', {
        body: { email, userId: pendingUserId, code: verificationCode },
      });

      if (response.error || response.data?.error) {
        toast.error(response.data?.error || 'Invalid verification code');
        setIsVerifying(false);
        return;
      }

      toast.success('Email verified successfully!');
      navigate('/');
    } catch (error) {
      console.error('Verification error:', error);
      toast.error('Failed to verify code');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResendCode = async () => {
    if (!pendingUserId) return;
    
    setIsResending(true);
    await sendVerificationCode(pendingUserId, email);
    setIsResending(false);
  };

  const handleBackToAuth = async () => {
    await supabase.auth.signOut();
    setStep('auth');
    setPendingUserId(null);
    setVerificationCode('');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary/5 via-background to-accent/5 p-4">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-8">
        <div className="relative">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg">
            <Ship className="w-6 h-6 text-primary-foreground" />
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">CargoTrack Pro</h1>
          <p className="text-xs text-muted-foreground">Real-time Container Tracking</p>
        </div>
      </div>

      {step === 'auth' ? (
        <Card className="w-full max-w-md shadow-xl border-border/50">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl">Welcome</CardTitle>
            <CardDescription>Sign in or create an account to track your containers</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="signin-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        disabled={isSubmitting}
                      />
                    </div>
                    {errors.email && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {errors.email}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="signin-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10"
                        disabled={isSubmitting}
                      />
                    </div>
                    {errors.password && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {errors.password}
                      </p>
                    )}
                  </div>
                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      'Sign In'
                    )}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        disabled={isSubmitting}
                      />
                    </div>
                    {errors.email && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {errors.email}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="signup-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10"
                        disabled={isSubmitting}
                      />
                    </div>
                    {errors.password && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {errors.password}
                      </p>
                    )}
                  </div>
                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating account...
                      </>
                    ) : (
                      'Create Account'
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      ) : (
        <Card className="w-full max-w-md shadow-xl border-border/50">
          <CardHeader className="text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Mail className="w-7 h-7 text-primary" />
            </div>
            <CardTitle className="text-xl">Verify Your Email</CardTitle>
            <CardDescription>
              We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={verificationCode}
                onChange={(value) => setVerificationCode(value)}
                disabled={isVerifying}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>

            <Button 
              onClick={handleVerifyCode} 
              className="w-full gap-2" 
              disabled={verificationCode.length !== 6 || isVerifying}
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Verify Email
                </>
              )}
            </Button>

            <div className="flex items-center justify-between text-sm">
              <button
                onClick={handleBackToAuth}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" />
                Back to sign in
              </button>
              <button
                onClick={handleResendCode}
                disabled={isResending}
                className="text-primary hover:underline disabled:opacity-50"
              >
                {isResending ? 'Sending...' : 'Resend code'}
              </button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Code expires in 10 minutes
            </p>
          </CardContent>
        </Card>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Track containers across MSC, Maersk, CMA CGM, and more
      </p>
    </div>
  );
};

export default Auth;
