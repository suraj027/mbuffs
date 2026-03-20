import { useState, useRef, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { zodResolver } from '@hookform/resolvers/zod';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { Loader2, Mail, ArrowLeft } from 'lucide-react';
import { signIn, signUp } from '@/lib/auth-client';
import { useAuth } from '@/hooks/useAuth';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const LAST_AUTH_METHOD_KEY = 'mbuffs_last_auth_method';

type AuthMethod = 'google' | 'email';

// ============================================================================
// Validation schemas
// ============================================================================
const signInSchema = z.object({
    email: z.email('Please enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
});

const signUpSchema = z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.email('Please enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
});

type SignInValues = z.infer<typeof signInSchema>;
type SignUpValues = z.infer<typeof signUpSchema>;

// ============================================================================
// Google icon SVG
// ============================================================================
const GoogleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 48 48" className="h-4 w-4">
        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
        <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z" />
        <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.412-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
        <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.012 35.846 44 30.138 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
);

// ============================================================================
// Auth page component
// ============================================================================
const Auth = () => {
    const navigate = useNavigate();
    const { isLoggedIn, isLoadingUser } = useAuth();
    const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);
    const [activeTab, setActiveTab] = useState<string>('sign-in');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [captchaToken, setCaptchaToken] = useState<string | null>(null);
    const turnstileRef = useRef<TurnstileInstance | null>(null);
    const [lastUsedMethod, setLastUsedMethod] = useState<AuthMethod | null>(null);

    // All hooks must be called before any early returns
    const signInForm = useForm<SignInValues>({
        resolver: zodResolver(signInSchema),
        defaultValues: { email: '', password: '' },
    });

    const signUpForm = useForm<SignUpValues>({
        resolver: zodResolver(signUpSchema),
        defaultValues: { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' },
    });

    useEffect(() => {
        const stored = localStorage.getItem(LAST_AUTH_METHOD_KEY) as AuthMethod | null;
        if (stored === 'google' || stored === 'email') {
            setLastUsedMethod(stored);
        }
    }, []);

    // Redirect if already logged in
    if (!isLoadingUser && isLoggedIn) {
        return <Navigate to="/" replace />;
    }

    const saveLastAuthMethod = (method: AuthMethod) => {
        localStorage.setItem(LAST_AUTH_METHOD_KEY, method);
    };

    const resetCaptcha = () => {
        setCaptchaToken(null);
        turnstileRef.current?.reset();
    };

    const goBack = () => {
        setAuthMethod(null);
        setFormError(null);
        resetCaptcha();
    };

    const onSignIn = async (values: SignInValues) => {
        if (!captchaToken) {
            setFormError('Please complete the captcha verification.');
            return;
        }

        setIsSubmitting(true);
        setFormError(null);

        try {
            const result = await signIn.email({
                email: values.email,
                password: values.password,
                callbackURL: '/',
                fetchOptions: {
                    headers: {
                        'x-captcha-response': captchaToken,
                    },
                },
            });

            if (result.error) {
                const code = result.error.code;
                let message = result.error.message || 'Something went wrong.';
                if (code === 'INVALID_EMAIL_OR_PASSWORD') {
                    message = 'Invalid email or password. If you don\'t have an account, please sign up first.';
                }
                setFormError(message);
                resetCaptcha();
            } else {
                saveLastAuthMethod('email');
                navigate('/');
            }
        } catch {
            setFormError('Something went wrong. Please try again.');
            resetCaptcha();
        } finally {
            setIsSubmitting(false);
        }
    };

    const onSignUp = async (values: SignUpValues) => {
        if (!captchaToken) {
            setFormError('Please complete the captcha verification.');
            return;
        }

        setIsSubmitting(true);
        setFormError(null);

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (signUp.email as any)({
                email: values.email,
                password: values.password,
                name: `${values.firstName} ${values.lastName}`,
                firstName: values.firstName,
                lastName: values.lastName,
                callbackURL: '/',
                fetchOptions: {
                    headers: {
                        'x-captcha-response': captchaToken,
                    },
                },
            });

            if (result.error) {
                setFormError(result.error.message || 'Could not create account. Please try again.');
                resetCaptcha();
            } else {
                saveLastAuthMethod('email');
                navigate('/');
            }
        } catch {
            setFormError('Something went wrong. Please try again.');
            resetCaptcha();
        } finally {
            setIsSubmitting(false);
        }
    };

    // ========================================================================
    // Google OAuth
    // ========================================================================
    const handleGoogleSignIn = async () => {
        saveLastAuthMethod('google');
        await signIn.social({
            provider: 'google',
            callbackURL: window.location.origin,
        });
    };

    // ========================================================================
    // Render — Method picker (initial screen)
    // ========================================================================
    if (authMethod === null) {
        return (
            <div className="min-h-screen bg-background">
                <Navbar />
                <div className="flex items-center justify-center px-4 py-12 sm:py-20">
                    <Card className="w-full max-w-md">
                        <CardHeader className="text-center">
                            <CardTitle className="text-2xl font-bold">Welcome to mbuffs</CardTitle>
                            <CardDescription>Choose how you'd like to continue</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <Button
                                variant="outline"
                                className="w-full h-12 justify-center text-base relative"
                                onClick={handleGoogleSignIn}
                            >
                                <GoogleIcon />
                                Continue with Google
                                {lastUsedMethod === 'google' && (
                                    <Badge variant="secondary" className="absolute right-3 text-[10px] px-1.5 py-0">
                                        Last used
                                    </Badge>
                                )}
                            </Button>

                            <Button
                                variant="outline"
                                className="w-full h-12 justify-center text-base relative"
                                onClick={() => setAuthMethod('email')}
                            >
                                <Mail className="h-4 w-4" />
                                Continue with Email
                                {lastUsedMethod === 'email' && (
                                    <Badge variant="secondary" className="absolute right-3 text-[10px] px-1.5 py-0">
                                        Last used
                                    </Badge>
                                )}
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        );
    }

    // ========================================================================
    // Render — Email form
    // ========================================================================
    return (
        <div className="min-h-screen bg-background">
            <Navbar />
            <div className="flex items-center justify-center px-4 py-12 sm:py-20">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center relative">
                        <div className="flex items-center justify-start">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={goBack}
                            >
                                <ArrowLeft className="h-4 w-4" />
                                Back
                            </Button>
                        </div>
                        <CardTitle className="text-2xl font-bold">Welcome to mbuffs</CardTitle>
                        <CardDescription>Sign in to your account or create a new one</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val); setFormError(null); resetCaptcha(); }}>
                            <TabsList className="w-full">
                                <TabsTrigger value="sign-in" className="flex-1">Sign In</TabsTrigger>
                                <TabsTrigger value="sign-up" className="flex-1">Sign Up</TabsTrigger>
                            </TabsList>

                            {/* ============================================ */}
                            {/* Sign In Tab */}
                            {/* ============================================ */}
                            <TabsContent value="sign-in" className="mt-4">
                                <Form {...signInForm}>
                                    <form onSubmit={signInForm.handleSubmit(onSignIn)} className="space-y-4">
                                        <FormField
                                            control={signInForm.control}
                                            name="email"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Email</FormLabel>
                                                    <FormControl>
                                                        <Input type="email" placeholder="you@example.com" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={signInForm.control}
                                            name="password"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Password</FormLabel>
                                                    <FormControl>
                                                        <Input type="password" placeholder="Enter your password" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        {TURNSTILE_SITE_KEY && (
                                            <Turnstile
                                                ref={turnstileRef}
                                                siteKey={TURNSTILE_SITE_KEY}
                                                onSuccess={(token) => setCaptchaToken(token)}
                                                onExpire={() => setCaptchaToken(null)}
                                                options={{ theme: 'dark', size: 'flexible' }}
                                            />
                                        )}

                                        {formError && (
                                            <p className="text-sm text-destructive">{formError}</p>
                                        )}

                                        <Button type="submit" className="w-full" disabled={isSubmitting}>
                                            {isSubmitting ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <>
                                                    <Mail className="h-4 w-4" />
                                                    Sign In
                                                </>
                                            )}
                                        </Button>
                                    </form>
                                </Form>

                                <div className="relative my-6">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t border-border" />
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                                    </div>
                                </div>

                                <Button variant="outline" className="w-full" onClick={handleGoogleSignIn}>
                                    <GoogleIcon />
                                    Google
                                </Button>
                            </TabsContent>

                            {/* ============================================ */}
                            {/* Sign Up Tab */}
                            {/* ============================================ */}
                            <TabsContent value="sign-up" className="mt-4">
                                <Form {...signUpForm}>
                                    <form onSubmit={signUpForm.handleSubmit(onSignUp)} className="space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <FormField
                                                control={signUpForm.control}
                                                name="firstName"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>First Name</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="John" {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={signUpForm.control}
                                                name="lastName"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Last Name</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="Doe" {...field} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                        <FormField
                                            control={signUpForm.control}
                                            name="email"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Email</FormLabel>
                                                    <FormControl>
                                                        <Input type="email" placeholder="you@example.com" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={signUpForm.control}
                                            name="password"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Password</FormLabel>
                                                    <FormControl>
                                                        <Input type="password" placeholder="At least 8 characters" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={signUpForm.control}
                                            name="confirmPassword"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Confirm Password</FormLabel>
                                                    <FormControl>
                                                        <Input type="password" placeholder="Re-enter your password" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        {TURNSTILE_SITE_KEY && (
                                            <Turnstile
                                                ref={turnstileRef}
                                                siteKey={TURNSTILE_SITE_KEY}
                                                onSuccess={(token) => setCaptchaToken(token)}
                                                onExpire={() => setCaptchaToken(null)}
                                                options={{ theme: 'dark', size: 'flexible' }}
                                            />
                                        )}

                                        {formError && (
                                            <p className="text-sm text-destructive">{formError}</p>
                                        )}

                                        <Button type="submit" className="w-full" disabled={isSubmitting}>
                                            {isSubmitting ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <>
                                                    <Mail className="h-4 w-4" />
                                                    Create Account
                                                </>
                                            )}
                                        </Button>
                                    </form>
                                </Form>

                                <div className="relative my-6">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t border-border" />
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                                    </div>
                                </div>

                                <Button variant="outline" className="w-full" onClick={handleGoogleSignIn}>
                                    <GoogleIcon />
                                    Google
                                </Button>
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default Auth;
