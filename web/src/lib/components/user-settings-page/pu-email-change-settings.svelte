<script lang="ts">
  import {
    confirmEmailChange,
    PuEmailChangeError,
    PuReauthRequiredError,
    requestEmailChange,
  } from '$lib/services/pu-email-change';
  import { user } from '$lib/stores/user.store';
  import { clearPuOidcAccessTokenCache } from '$lib/utils/pu-oidc';
  import { Button, Field, Input, toastManager } from '@immich/ui';
  import { fade } from 'svelte/transition';

  type FlowState = 'idle' | 'requesting' | 'awaitingCode' | 'confirming' | 'needsReauth';

  let flowState = $state<FlowState>('idle');
  let newEmail = $state('');
  let verificationCode = $state('');
  let currentEmail = $state('');

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const canRequestCode = $derived(
    flowState === 'idle' && isValidEmail(newEmail) && newEmail.trim().toLowerCase() !== $user.email.toLowerCase(),
  );

  const canConfirmCode = $derived(flowState === 'awaitingCode' && verificationCode.trim().length === 6);

  const handleReauthRequired = () => {
    flowState = 'needsReauth';
  };

  const handleReauthenticate = () => {
    document.cookie = 'immich_is_authenticated=; max-age=0; path=/';
    globalThis.location.reload();
  };

  const resetFlow = () => {
    flowState = 'idle';
    newEmail = '';
    verificationCode = '';
    currentEmail = '';
  };

  const handleRequestCode = async () => {
    flowState = 'requesting';

    try {
      const result = await requestEmailChange(newEmail);
      currentEmail = result.oldEmail;
      verificationCode = '';
      flowState = 'awaitingCode';
      toastManager.primary('Verification code sent to your current email address.');
    } catch (error) {
      if (error instanceof PuReauthRequiredError) {
        handleReauthRequired();
        return;
      }

      const message =
        error instanceof PuEmailChangeError ? error.message : 'Unable to start email change. Please try again.';
      toastManager.danger(message);
      flowState = 'idle';
    }
  };

  const handleConfirmCode = async () => {
    flowState = 'confirming';

    try {
      const result = await confirmEmailChange(verificationCode);
      const { summary } = result;

      $user = { ...$user, email: summary.newEmail };
      clearPuOidcAccessTokenCache();
      resetFlow();

      toastManager.primary('Email address changed successfully.');
      toastManager.primary('Please sign in again so your session reflects your new email address.');

      const failures = summary.tenantFailures ?? [];
      if (failures.length > 0) {
        const failureDetails = failures
          .map((failure) => {
            const tenant = failure.tenantSlug ?? 'unknown tenant';
            const cluster = failure.cluster ? ` (${failure.cluster})` : '';
            const reason = failure.error ? `: ${failure.error}` : '';
            return `${tenant}${cluster}${reason}`;
          })
          .join('\n');

        toastManager.warning(`Some environments could not be updated:\n${failureDetails}`);
      }
    } catch (error) {
      if (error instanceof PuReauthRequiredError) {
        handleReauthRequired();
        return;
      }

      const message =
        error instanceof PuEmailChangeError ? error.message : 'Unable to confirm email change. Please try again.';
      toastManager.danger(message);
      flowState = 'awaitingCode';
    }
  };
</script>

<section class="my-4">
  <div in:fade={{ duration: 500 }}>
    <div class="flex flex-col gap-4">
      {#if flowState === 'needsReauth'}
        <p class="text-sm text-immich-fg/75 dark:text-immich-dark-fg/75">
          Your session needs to be refreshed before you can change your email address.
        </p>
        <div class="flex justify-end">
          <Button shape="round" size="small" onclick={() => handleReauthenticate()}>Re-authenticate</Button>
        </div>
      {:else if flowState === 'awaitingCode' || flowState === 'confirming'}
        <p class="text-sm text-immich-fg/75 dark:text-immich-dark-fg/75">
          Enter the 6-character code sent to {currentEmail}.
        </p>

        <Field label="Verification code" required>
          <Input
            bind:value={verificationCode}
            maxlength={6}
            autocomplete="one-time-code"
            disabled={flowState === 'confirming'}
            oninput={(event) => {
              const target = event.currentTarget as HTMLInputElement;
              verificationCode = target.value.toUpperCase().replaceAll(/[^A-Z0-9]/g, '');
            }}
          />
        </Field>

        <div class="flex justify-end gap-2">
          <Button
            shape="round"
            size="small"
            color="secondary"
            disabled={flowState === 'confirming'}
            onclick={() => resetFlow()}
          >
            Cancel
          </Button>
          <Button
            shape="round"
            size="small"
            disabled={!canConfirmCode || flowState === 'confirming'}
            onclick={() => handleConfirmCode()}
          >
            Confirm
          </Button>
        </div>
      {:else}
        <p class="text-sm text-immich-fg/75 dark:text-immich-dark-fg/75">
          Update your login and billing email. A verification code will be sent to your current address.
        </p>

        <Field label="New email address" required>
          <Input
            type="email"
            bind:value={newEmail}
            autocomplete="email"
            disabled={flowState === 'requesting'}
          />
        </Field>

        <div class="flex justify-end">
          <Button
            shape="round"
            size="small"
            disabled={!canRequestCode || flowState === 'requesting'}
            onclick={() => handleRequestCode()}
          >
            Send verification code
          </Button>
        </div>
      {/if}
    </div>
  </div>
</section>
