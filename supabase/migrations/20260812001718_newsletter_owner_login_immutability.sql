revoke all on table
  public.builder_newsletter_auth_login_occurrences,
  public.builder_newsletter_auth_login_evidence,
  public.builder_newsletter_auth_login_recovery_commands
from service_role;

grant select, insert on table
  public.builder_newsletter_auth_login_occurrences,
  public.builder_newsletter_auth_login_evidence,
  public.builder_newsletter_auth_login_recovery_commands
to service_role;
