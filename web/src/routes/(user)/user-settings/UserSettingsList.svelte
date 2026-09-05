<script lang="ts">
  import ChangePinCodeSettings from './PinCodeSettings.svelte';
  import DownloadSettings from './DownloadSettings.svelte';
  import FeatureSettings from './FeatureSettings.svelte';
  import NotificationsSettings from './NotificationsSettings.svelte';
  import UserUsageStatistic from './UserUsageStatistic.svelte';
  import { OpenQueryParam } from '$lib/constants';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { type ApiKeyResponseDto, type SessionResponseDto } from '@immich/sdk';
  import {
    mdiAccountGroupOutline,
    mdiAccountOutline,
    mdiApi,
    mdiBellOutline,
    mdiCogOutline,
    mdiDevices,
    mdiDownload,
    mdiEmailOutline,
    mdiFeatureSearchOutline,
    mdiFormTextboxPassword,
    mdiLockSmart,
    mdiServerOutline,
    mdiShieldAccountOutline,
  } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import AppSettings from './AppSettings.svelte';
  import ChangePasswordSettings from './ChangePasswordSettings.svelte';
  import DeviceList from './DeviceList.svelte';
  import SharingSettings from './SharingSettings.svelte';
  import PuEmailChangeSettings from '$lib/components/user-settings-page/pu-email-change-settings.svelte';
  import PuUserProfileSettings from '$lib/components/user-settings-page/pu-user-profile-settings.svelte';
  import UserApiKeyList from './UserApiKeyList.svelte';
  import UserProfileSettings from './UserProfileSettings.svelte';

  interface Props {
    keys?: ApiKeyResponseDto[];
    sessions?: SessionResponseDto[];
  }

  let { keys = $bindable([]), sessions = $bindable([]) }: Props = $props();
</script>

<SettingAccordion icon={mdiCogOutline} key="app-settings" title={$t('app_settings')} subtitle={$t('manage_the_app_settings')}>
  <AppSettings />
</SettingAccordion>

{#if !featureFlagsManager.value.oauth}
  <SettingAccordion icon={mdiAccountOutline} key="account" title={$t('account')} subtitle={$t('manage_your_account')}>
    <UserProfileSettings />
  </SettingAccordion>
{:else}
  <SettingAccordion
    icon={mdiShieldAccountOutline}
    key="account-security"
    title={$t('pu_account_security')}
    subtitle={$t('pu_account_security_description')}
  >
    <PuUserProfileSettings />
  </SettingAccordion>

  <SettingAccordion
    icon={mdiEmailOutline}
    key="email-address"
    title={$t('pu_email_address')}
    subtitle={$t('pu_email_address_description')}
  >
    <PuEmailChangeSettings />
  </SettingAccordion>
{/if}

<SettingAccordion
  icon={mdiServerOutline}
  key="user-usage-info"
  title={$t('user_usage_stats')}
  subtitle={$t('user_usage_stats_description')}
>
  <UserUsageStatistic />
</SettingAccordion>

<SettingAccordion icon={mdiApi} key="api-keys" title={$t('api_keys')} subtitle={$t('manage_your_api_keys')}>
  <UserApiKeyList bind:keys />
</SettingAccordion>

<SettingAccordion
  icon={mdiDevices}
  key="authorized-devices"
  title={$t('authorized_devices')}
  subtitle={$t('manage_your_devices')}
>
  <DeviceList bind:devices={sessions} />
</SettingAccordion>

<SettingAccordion
  icon={mdiDownload}
  key="download-settings"
  title={$t('download_settings')}
  subtitle={$t('download_settings_description')}
>
  <DownloadSettings />
</SettingAccordion>

<SettingAccordion
  icon={mdiFeatureSearchOutline}
  key="feature"
  title={$t('features')}
  subtitle={$t('features_setting_description')}
>
  <FeatureSettings />
</SettingAccordion>

<SettingAccordion
  icon={mdiBellOutline}
  key={OpenQueryParam.NOTIFICATIONS}
  title={$t('notifications')}
  subtitle={$t('notifications_setting_description')}
>
  <NotificationsSettings />
</SettingAccordion>

{#if featureFlagsManager.value.passwordLogin}
  <SettingAccordion
    icon={mdiFormTextboxPassword}
    key="password"
    title={$t('password')}
    subtitle={$t('change_your_password')}
  >
    <ChangePasswordSettings />
  </SettingAccordion>
{/if}

<SettingAccordion
  icon={mdiLockSmart}
  key="user-pin-code-settings"
  title={$t('user_pin_code_settings')}
  subtitle={$t('user_pin_code_settings_description')}
  autoScrollTo={true}
>
  <ChangePinCodeSettings />
</SettingAccordion>

<SettingAccordion
  icon={mdiAccountGroupOutline}
  key={OpenQueryParam.SHARING}
  title={$t('sharing')}
  subtitle={$t('manage_sharing_with_other_users')}
>
  <SharingSettings />
</SettingAccordion>
