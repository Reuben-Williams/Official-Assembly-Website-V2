/** Only static, intentionally public messages belong in this error. */
export class BuilderContentValidationError extends TypeError {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "BuilderContentValidationError";
  }
}
