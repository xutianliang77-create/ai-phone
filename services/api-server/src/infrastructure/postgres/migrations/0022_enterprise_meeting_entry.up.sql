ALTER TABLE enterprise.meetings
  ADD COLUMN creation_key text,
  ADD COLUMN creation_request_hash text;

UPDATE enterprise.meetings
SET creation_key = 'legacy:' || id::text,
    creation_request_hash = md5('meeting:' || id::text) ||
      md5('meeting:' || id::text || ':2');

UPDATE enterprise.meetings
SET policy = jsonb_build_object(
  'allowGuests', false,
  'screenShareRole', 'host_only'
)
WHERE NOT (
  policy ? 'allowGuests' AND
  policy ? 'screenShareRole' AND
  jsonb_typeof(policy -> 'allowGuests') = 'boolean' AND
  policy ->> 'screenShareRole' IN ('host_only', 'members') AND
  policy - ARRAY['allowGuests', 'screenShareRole', 'defaultLanguage'] = '{}'::jsonb AND
  (NOT (policy ? 'defaultLanguage') OR
    policy ->> 'defaultLanguage' ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
);

ALTER TABLE enterprise.meetings
  ALTER COLUMN creation_key SET NOT NULL,
  ALTER COLUMN creation_request_hash SET NOT NULL,
  ADD CONSTRAINT meetings_creation_key_check CHECK (
    length(creation_key) BETWEEN 1 AND 160 AND
    creation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  ADD CONSTRAINT meetings_creation_request_hash_check
    CHECK (creation_request_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT meetings_entry_policy_check CHECK (
    policy ? 'allowGuests' AND
    policy ? 'screenShareRole' AND
    jsonb_typeof(policy -> 'allowGuests') = 'boolean' AND
    policy ->> 'screenShareRole' IN ('host_only', 'members') AND
    policy - ARRAY['allowGuests', 'screenShareRole', 'defaultLanguage'] = '{}'::jsonb AND
    (NOT (policy ? 'defaultLanguage') OR
      policy ->> 'defaultLanguage' ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
  );

CREATE UNIQUE INDEX meetings_tenant_creation_key_unique_idx
  ON enterprise.meetings (tenant_id, creation_key);

ALTER TABLE enterprise.meeting_participants
  ADD COLUMN invitation_key text,
  ADD COLUMN invitation_request_hash text,
  ADD CONSTRAINT meeting_participants_invitation_pair_check CHECK (
    (invitation_key IS NULL) = (invitation_request_hash IS NULL)
  ),
  ADD CONSTRAINT meeting_participants_invitation_role_check CHECK (
    invitation_key IS NULL OR role = 'guest'
  ),
  ADD CONSTRAINT meeting_participants_invitation_key_check CHECK (
    invitation_key IS NULL OR (
      length(invitation_key) BETWEEN 1 AND 160 AND
      invitation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  ADD CONSTRAINT meeting_participants_invitation_hash_check CHECK (
    invitation_request_hash IS NULL OR
    invitation_request_hash ~ '^[a-f0-9]{64}$'
  );

CREATE UNIQUE INDEX meeting_participants_invitation_key_unique_idx
  ON enterprise.meeting_participants (tenant_id, meeting_id, invitation_key)
  WHERE invitation_key IS NOT NULL;
