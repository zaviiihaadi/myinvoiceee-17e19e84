
-- Lock down SECURITY DEFINER trigger functions: revoke from public/anon/authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- Add owner-scoped policies to verification_codes (RLS already enabled, no policies)
CREATE POLICY "Users can view their own verification codes"
  ON public.verification_codes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own verification codes"
  ON public.verification_codes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own verification codes"
  ON public.verification_codes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own verification codes"
  ON public.verification_codes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
