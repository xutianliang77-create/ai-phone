const accountSubjectPattern =
  /^user_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const namespacedActorPattern =
  /^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function enterprisePostgresAccountSubjectId(value: unknown) {
  if (typeof value !== "string" || !accountSubjectPattern.test(value)) {
    throw new Error("Invalid enterprise PostgreSQL account subject ID");
  }
  return value;
}

export function enterprisePostgresActorSubjectId(value: unknown) {
  if (
    typeof value !== "string" ||
    (!accountSubjectPattern.test(value) &&
      !namespacedActorPattern.test(value))
  ) {
    throw new Error("Invalid enterprise PostgreSQL actor subject ID");
  }
  return value;
}

export function optionalEnterprisePostgresActorSubjectId(value: unknown) {
  return value == null ? undefined : enterprisePostgresActorSubjectId(value);
}
