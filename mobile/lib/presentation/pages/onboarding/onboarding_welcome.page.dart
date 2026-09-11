import 'dart:async';
import 'dart:ui';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/providers/onboarding.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_ui/immich_ui.dart';
import 'package:url_launcher/url_launcher.dart';

/// Shown once, on first launch, before the login screen.
/// Asks whether the user already has a PixelUnion environment.
///  - "Yes, I have one"        -> straight to the login screen.
///  - "No, set one up for me"  -> opens the hosted-signup flow in the
///                                 browser, then falls back to login so the
///                                 user can enter their new subdomain.
@RoutePage()
class OnboardingWelcomePage extends ConsumerWidget {
  const OnboardingWelcomePage({super.key});

  static const _registerUrl =
      'https://portal.pixelunion.eu/order/login?plan_id=price_1RH5X5KuddcDSdPSym06PHoc&flow=register';

  Future<void> _continue(BuildContext context, WidgetRef ref) async {
    await ref.read(onboardingServiceProvider).markSeen();
    if (!context.mounted) {
      return;
    }
    unawaited(context.router.replaceAll([const LoginRoute()]));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          // Full-bleed 2×2 collage — each tile fills its quadrant and
          // center-crops (BoxFit.cover) so nothing letterboxes.
          ImageFiltered(
            imageFilter: ImageFilter.blur(sigmaX: 3, sigmaY: 3),
            child: const Column(
              children: [
                Expanded(
                  child: Row(
                    children: [
                      Expanded(child: _CollageTile('assets/onboarding/tile_1.jpg')),
                      Expanded(child: _CollageTile('assets/onboarding/tile_3.jpg')),
                    ],
                  ),
                ),
                Expanded(
                  child: Row(
                    children: [
                      Expanded(child: _CollageTile('assets/onboarding/tile_2.jpg')),
                      Expanded(child: _CollageTile('assets/onboarding/tile_4.jpg')),
                    ],
                  ),
                ),
              ],
            ),
          ),

          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.black.withValues(alpha: 0.45),
                  Colors.black.withValues(alpha: 0.4),
                  Colors.black.withValues(alpha: 0.85),
                ],
                stops: const [0.0, 0.4, 1.0],
              ),
            ),
          ),
          SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final compact = constraints.maxHeight < 560;
                final logoMaxWidth = compact ? 120.0 : 200.0;

                return SingleChildScrollView(
                  child: ConstrainedBox(
                    constraints: BoxConstraints(minHeight: constraints.maxHeight),
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(24, compact ? 12 : 24, 24, 24),
                      child: Column(
                        mainAxisAlignment: compact ? MainAxisAlignment.center : MainAxisAlignment.spaceBetween,
                        children: [
                          Padding(
                            padding: EdgeInsets.only(top: compact ? 0 : 48, bottom: compact ? 16 : 0),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                ConstrainedBox(
                                  constraints: BoxConstraints(maxWidth: logoMaxWidth),
                                  child: Image.asset('assets/pixelunion-logo.png', fit: BoxFit.contain),
                                ),
                                SizedBox(height: compact ? 12 : 16),
                                Text(
                                  'Welcome to PixelUnion',
                                  textAlign: TextAlign.center,
                                  style: context.textTheme.titleLarge?.copyWith(
                                    color: Colors.white,
                                    fontSize: compact ? 22 : 26,
                                  ),
                                ),
                                SizedBox(height: compact ? 6 : 10),
                                Text(
                                  'Your private, secure home for photos and videos.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 14,
                                    color: Colors.white.withValues(alpha: 0.85),
                                    height: 1.5,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(
                                'Do you already have a PixelUnion environment set up?',
                                textAlign: TextAlign.center,
                                style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.85)),
                              ),
                              const SizedBox(height: 12),
                              ImmichTextButton(labelText: 'Yes, I have one', onPressed: () => _continue(context, ref)),
                              const SizedBox(height: 10),
                              ImmichTextButton(
                                labelText: 'No, set one up for me',
                                variant: ImmichVariant.ghost,
                                onPressed: () async {
                                  final uri = Uri.parse(_registerUrl);
                                  if (await canLaunchUrl(uri)) {
                                    unawaited(launchUrl(uri, mode: LaunchMode.externalApplication));
                                  }
                                  if (!context.mounted) {
                                    return;
                                  }
                                  await _continue(context, ref);
                                },
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _CollageTile extends StatelessWidget {
  final String asset;

  const _CollageTile(this.asset);

  @override
  Widget build(BuildContext context) {
    return SizedBox.expand(
      child: Image.asset(
        asset,
        fit: BoxFit.cover,
        alignment: Alignment.center,
        errorBuilder: (_, _, _) => ColoredBox(color: Colors.grey.shade900),
      ),
    );
  }
}
