
DROP POLICY IF EXISTS "Users can view their own verification codes" ON public.verification_codes;
DROP POLICY IF EXISTS "Users can insert their own verification codes" ON public.verification_codes;
DROP POLICY IF EXISTS "Users can update their own verification codes" ON public.verification_codes;
DROP POLICY IF EXISTS "Users can delete their own verification codes" ON public.verification_codes;

REVOKE ALL ON public.verification_codes FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.verification_codes TO service_role;
