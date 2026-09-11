import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/services/onboarding.service.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';

final onboardingServiceProvider = Provider<OnboardingService>(
  (ref) => OnboardingService(ref.read(settingsProvider)),
);
