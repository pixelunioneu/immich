import 'dart:async';
import 'dart:ui';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/theme_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/widgets/forms/login/login_form.dart';
import 'package:package_info_plus/package_info_plus.dart';

@RoutePage()
class LoginPage extends HookWidget {
  const LoginPage({super.key});

  @override
  Widget build(BuildContext context) {
    final appVersion = useState('0.0.0');
    final manual = useState(false);

    Future<void> getAppInfo() async {
      final PackageInfo packageInfo = await PackageInfo.fromPlatform();
      appVersion.value = packageInfo.version;
    }

    useEffect(() {
      unawaited(getAppInfo());
      return null;
    });

    final form = LoginForm(
      manual: manual.value,
      onShowManual: () => manual.value = true,
      onExitManual: () => manual.value = false,
    );

    if (!manual.value) {
      return Scaffold(
        body: _WelcomeLayout(appVersion: appVersion.value, child: form),
      );
    }

    return Scaffold(
      body: form,
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.only(bottom: 16.0),
          child: SizedBox(
            height: 50,
            child: _VersionAndLogs(
              appVersion: appVersion.value,
              versionColor: context.colorScheme.onSurfaceSecondary,
              linkColor: context.primaryColor,
            ),
          ),
        ),
      ),
    );
  }
}

/// The first screen of the app: a blurred photo collage with the logo and the login buttons.
class _WelcomeLayout extends StatelessWidget {
  final String appVersion;
  final Widget child;

  const _WelcomeLayout({required this.appVersion, required this.child});

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        // Full-bleed 2×2 collage. Each tile fills its quadrant and center-crops, so nothing
        // letterboxes.
        ImageFiltered(
          imageFilter: ImageFilter.blur(sigmaX: 3, sigmaY: 3),
          child: const Column(
            children: [
              Expanded(
                child: Row(
                  children: [
                    Expanded(child: _CollageTile('assets/login/tile_1.jpg')),
                    Expanded(child: _CollageTile('assets/login/tile_3.jpg')),
                  ],
                ),
              ),
              Expanded(
                child: Row(
                  children: [
                    Expanded(child: _CollageTile('assets/login/tile_2.jpg')),
                    Expanded(child: _CollageTile('assets/login/tile_4.jpg')),
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
                    padding: EdgeInsets.fromLTRB(24, compact ? 12 : 24, 24, 8),
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
                                context.t.login_welcome_title,
                                textAlign: TextAlign.center,
                                style: context.textTheme.titleLarge?.copyWith(
                                  color: Colors.white,
                                  fontSize: compact ? 22 : 26,
                                ),
                              ),
                              SizedBox(height: compact ? 6 : 10),
                              Text(
                                context.t.login_welcome_subtitle,
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
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            child,
                            const SizedBox(height: 16),
                            _VersionAndLogs(
                              appVersion: appVersion,
                              versionColor: Colors.white.withValues(alpha: 0.7),
                              linkColor: Colors.white,
                              onSettings: () => context.pushRoute(const SettingsRoute()),
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
    );
  }
}

class _VersionAndLogs extends StatelessWidget {
  final String appVersion;
  final Color versionColor;
  final Color linkColor;
  final VoidCallback? onSettings;

  const _VersionAndLogs({
    required this.appVersion,
    required this.versionColor,
    required this.linkColor,
    this.onSettings,
  });

  @override
  Widget build(BuildContext context) {
    final linkStyle = TextStyle(color: linkColor, fontWeight: FontWeight.bold, fontFamily: "GoogleSansCode");

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(
          'v$appVersion',
          style: TextStyle(color: versionColor, fontWeight: FontWeight.bold, fontFamily: "GoogleSansCode"),
        ),
        const Text(' '),
        GestureDetector(
          child: Text('Logs', style: linkStyle),
          onTap: () {
            unawaited(context.pushRoute(const AppLogRoute()));
          },
        ),
        if (onSettings != null) ...[
          const Text(' '),
          GestureDetector(
            onTap: onSettings,
            child: Text(context.t.settings, style: linkStyle),
          ),
        ],
      ],
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
