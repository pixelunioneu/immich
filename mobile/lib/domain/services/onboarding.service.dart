import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';

/// Controls the first-launch "Welcome to PixelUnion" onboarding screen.
/// Mirrors the pattern used by [FeatureMessageService] — a persisted bool
/// flag in [SettingsRepository], flipped once the user makes a choice.
class OnboardingService {
  final SettingsRepository _settingsRepository;

  const OnboardingService(this._settingsRepository);

  /// True until the user has been through the welcome screen once.
  bool shouldShow() => !_settingsRepository.appConfig.onboarding.welcomeSeen;

  Future<void> markSeen() => _settingsRepository.write(SettingsKey.onboardingWelcomeSeen, true);
}
