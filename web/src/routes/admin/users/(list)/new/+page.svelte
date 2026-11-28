<script lang="ts">
  import { createPreloadedQuery, executeMutation } from '#lib/queries/client.ts';
  import { getUserConfigQuery } from '#lib/queries/config-user.query.ts';
  import { getStorageQuery } from '#lib/queries/server-info.query.ts';
  import { createUserAdminMutation } from '#lib/queries/user-admin.query.ts';
  import { Route } from '#lib/route.ts';
  import { ByteUnit, convertToBytes } from '#lib/utils/byte-units.ts';
  import { Field, FormModal, HelperText, Input, Stack, Switch } from '@immich/ui';
  import { createQuery } from '@tanstack/svelte-query';
  import { t } from 'svelte-i18n';
  import { goto } from '$app/navigation';

  const queries = {
    config: createPreloadedQuery(getUserConfigQuery),
    storage: createQuery(getStorageQuery),
  };

  const config = $derived(queries.config.data);
  const serverInfo = $derived(queries.storage.data);

  let success = $state(false);

  let email = $state('');
  // PixelUnion: users sign in via OAuth, so the password fields are hidden. Send a random, never-shown value
  // instead of a fixed one; the server also replaces missing/placeholder values with its own random secret.
  const generatePassword = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  };
  let name = $state('');
  let shouldChangePassword = $state(true);
  let notify = $state(true);
  let isAdmin = $state(false);

  let quotaSize: string | undefined = $state();
  let isCreatingUser = $state(false);

  let quotaSizeInBytes = $derived(quotaSize === null ? null : convertToBytes(Number(quotaSize), ByteUnit.GiB));
  let quotaSizeWarning = $derived(quotaSizeInBytes && serverInfo && quotaSizeInBytes > serverInfo.diskSizeRaw);

  const valid = $derived(!isCreatingUser);

  const onClose = async () => {
    await goto(Route.users());
  };

  const onSubmit = async (event: Event) => {
    event.preventDefault();

    if (!valid) {
      return;
    }

    isCreatingUser = true;

    await executeMutation(
      createUserAdminMutation,
      [
        {
          userAdminCreateDto: {
            email,
            password: generatePassword(),
            shouldChangePassword,
            name,
            quotaSizeInBytes,
            notify,
            isAdmin,
          },
        },
      ],
      { onSuccess: (user) => void goto(Route.viewUser(user), { replaceState: true }) },
    );

    isCreatingUser = false;
  };
</script>

<FormModal title={$t('create_new_user')} size="small" disabled={!valid} submitText={$t('create')} {onClose} {onSubmit}>
  {#if success}
    <p class="text-sm text-immich-primary">{$t('new_user_created')}</p>
  {/if}

  <Stack gap={4}>
    <Field label={$t('email')} required>
      <Input bind:value={email} type="email" />
    </Field>

    {#if config.notifications.smtp.enabled}
      <Field label={$t('admin.send_welcome_email')}>
        <Switch id="send-welcome-email" bind:checked={notify} class="text-sm" />
      </Field>
    {/if}

    <Field label={$t('name')} required>
      <Input bind:value={name} />
    </Field>

    <Field label={$t('admin.quota_size_gib')}>
      <Input bind:value={quotaSize} type="number" placeholder={$t('unlimited')} min="0" step="1" />
      {#if quotaSizeWarning}
        <HelperText color="danger">{$t('errors.quota_higher_than_disk_size')}</HelperText>
      {/if}
    </Field>

    <Field label={$t('admin.admin_user')}>
      <Switch bind:checked={isAdmin} />
    </Field>
  </Stack>
</FormModal>
