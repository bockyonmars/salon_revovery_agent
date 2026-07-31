# Conversation prompt release

Production routing accepts only the code-managed `conversation-router-v1` prompt paired with the exact `MODEL_CONCIERGE` value that passed the golden evaluation. The release digest is SHA-256 over the prompt name, release label, model, instructions, and structured-output schema version. A matching label without a matching digest is not sufficient.

Migration `043_prompt_release_provenance.sql` adds the prompt release label, digest, and approval reference to active prompt records and adds the exact digest to evaluation evidence. Legacy rows with no digest remain readable but are not eligible for prompt activation or location onboarding.

## Protected activation sequence

1. Run `npm run db:migrate:prod` from the immutable release image.
2. Set `MODEL_CONCIERGE`, `SANDBOX_TENANT_ID`, and `SANDBOX_LOCATION_ID` to the protected release values.
3. Run the full 150-case pinned-model evaluation with `EVAL_ALLOW_MODEL_CALLS=true` and `EVAL_PERSIST_TO_DATABASE=true`:

   ```sh
   npm run eval:golden:model
   ```

4. Review the write-once evidence. It must pass with the exact prompt digest, at least 150 cases, 100% safety recall, 100% confirmation accuracy, and zero grounding violations.
5. Put an opaque ticket or approval ID in `PROMPT_RELEASE_APPROVAL_REFERENCE`, set `PROMPT_RELEASE_APPROVED=true` only inside the protected release environment, and run the compiled command from the immutable production image:

   ```sh
   npm run prompt:activate:prod
   ```

   Repository-only release tooling may use `npm run prompt:activate`; it requires the development `tsx` dependency and is not available in the pruned runtime image.

6. Run the provider verification and onboarding simulation, then activate the location through the management API.

The activation command takes a PostgreSQL advisory lock and performs its evidence check and prompt switch in one transaction. It refuses missing, failed, mismatched, or older-than-seven-days evidence. Re-running an already active exact release is idempotent. It prints bounded identifiers and digests, never the prompt body, model output, credentials, or customer content.

Production does not auto-create a prompt. Missing prompt state or drift between the database and code returns a retryable `503` before an agent run is created. A prompt or model change requires a new release label when appropriate, a fresh full evaluation, approval, and activation; editing the database row is not a release path.

To roll back, deploy the reviewed code containing the intended prior prompt, run a fresh pinned-model evaluation for its exact digest, and activate it through the same command. Do not reactivate stale evidence or manually toggle `active` rows.
