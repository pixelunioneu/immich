import 'package:flutter/foundation.dart';
import 'package:freezed_annotation/freezed_annotation.dart';

part 'onboarding_config.freezed.dart';

@freezed
abstract class OnboardingConfig with _$OnboardingConfig {
  const factory OnboardingConfig({@Default(false) bool welcomeSeen}) = _OnboardingConfig;
}
