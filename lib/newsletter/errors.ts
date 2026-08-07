export const NEWSLETTER_ERROR_CODES = {
  disabled: "newsletter_disabled",
  invalidFeatureFlag: "invalid_feature_flag",
  previewCredentialsForbidden: "preview_provider_credentials_forbidden",
  environmentNotProduction: "environment_not_production",
  legacyApiKey: "unsafe_legacy_api_key",
  missingSendApiKey: "missing_send_api_key",
  missingManagementApiKey: "missing_management_api_key",
  missingWebhookSecret: "missing_webhook_secret",
  invalidSupabaseUrl: "invalid_supabase_url",
  missingSupabaseServiceRoleKey: "missing_supabase_service_role_key",
  invalidSegmentId: "invalid_segment_id",
  invalidTopicId: "invalid_topic_id",
  invalidCanonicalSiteUrl: "invalid_canonical_site_url",
  invalidConfirmationKeyring: "invalid_confirmation_keyring",
  invalidConfirmationActiveKey: "invalid_confirmation_active_key",
  invalidTestRecipientAllowlist: "invalid_test_recipient_allowlist"
} as const;

export type NewsletterErrorCode =
  (typeof NEWSLETTER_ERROR_CODES)[keyof typeof NEWSLETTER_ERROR_CODES];
