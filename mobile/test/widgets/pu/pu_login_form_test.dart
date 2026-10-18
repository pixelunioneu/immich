import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/providers/auth.provider.dart';
import 'package:immich_mobile/providers/oauth.provider.dart';
import 'package:immich_mobile/services/oauth.service.dart';
import 'package:immich_mobile/widgets/forms/login/login_form.dart';
import 'package:mocktail/mocktail.dart';

import '../../service.mocks.dart';
import '../../unit/presentation/presentation_context.dart';

class _MockOAuthService extends Mock implements OAuthService {}

/// PixelUnion login: the portal login is the default screen; the subdomain form is a hidden
/// fallback behind a long-press, and it builds `https://<sub>.pixelunion.eu` instead of taking a URL.
void main() {
  late PresentationContext context;
  late _MockOAuthService oAuthService;
  late MockAuthService authService;
  late int showManualCalls;
  late int exitManualCalls;

  setUp(() async {
    context = await PresentationContext.create();
    oAuthService = _MockOAuthService();
    authService = MockAuthService();
    showManualCalls = 0;
    exitManualCalls = 0;
  });

  tearDown(() async {
    await StoreService.I.put(StoreKey.serverEndpoint, PresentationContext.serverEndpoint);
    await context.dispose();
  });

  Future<void> pumpLoginForm(WidgetTester tester, {required bool manual}) async {
    // The login form needs a tall surface; its logo animation never settles.
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    // The test font renders every glyph as a full square, so the register row overflows the
    // 300 px form; that is a test-font artefact, not a layout bug.
    final onError = FlutterError.onError;
    FlutterError.onError = (details) {
      if (details.exceptionAsString().contains('A RenderFlex overflowed')) {
        return;
      }
      onError?.call(details);
    };
    addTearDown(() => FlutterError.onError = onError);

    await tester.pumpTestWidget(
      context,
      LoginForm(manual: manual, onShowManual: () => showManualCalls++, onExitManual: () => exitManualCalls++),
      overrides: [
        oAuthServiceProvider.overrideWithValue(oAuthService),
        authProvider.overrideWith(
          (ref) => AuthNotifier(
            authService,
            MockApiService(),
            context.service.user.service,
            MockSecureStorageService(),
            MockWidgetService(),
            ref,
          ),
        ),
      ],
      expectSettle: false,
    );
    await tester.pump(const Duration(milliseconds: 100));
  }

  group('portal (default)', () {
    testWidgets('shows the portal buttons and no server field', (tester) async {
      await pumpLoginForm(tester, manual: false);

      expect(find.text('Log in with PixelUnion'), findsOneWidget);
      expect(find.text('Create an environment'), findsOneWidget);
      expect(find.text('Your username'), findsNothing);
    });

    testWidgets('starts the portal login on tap', (tester) async {
      when(() => oAuthService.authenticateViaPortal(any())).thenThrow(PlatformException(code: 'CANCELED'));

      await pumpLoginForm(tester, manual: false);
      await tester.tap(find.text('Log in with PixelUnion'));
      await tester.pump(const Duration(milliseconds: 100));

      final portalUrl = verify(() => oAuthService.authenticateViaPortal(captureAny())).captured.single as String;
      final uri = Uri.parse(portalUrl);
      expect(uri.origin, 'https://portal.pixelunion.eu');
      expect(uri.queryParameters.keys, containsAll(['nonce', 'code_challenge']));
      expect(showManualCalls, 0);
    });

    testWidgets('reveals the manual fallback on long-press', (tester) async {
      await pumpLoginForm(tester, manual: false);
      await tester.longPress(find.text('Log in with PixelUnion'));
      await tester.pump();

      expect(showManualCalls, 1);
      verifyNever(() => oAuthService.authenticateViaPortal(any()));
    });
  });

  group('manual fallback', () {
    testWidgets('asks for a username on the pixelunion.eu domain', (tester) async {
      await pumpLoginForm(tester, manual: true);

      expect(find.text('Your username'), findsOneWidget);
      expect(find.text('.pixelunion.eu'), findsOneWidget);
      expect(find.text('Log in with PixelUnion'), findsNothing);
    });

    testWidgets('goes back to the portal screen', (tester) async {
      await pumpLoginForm(tester, manual: true);
      await tester.tap(find.text('Back'));
      await tester.pump();

      expect(exitManualCalls, 1);
    });

    testWidgets('prefills the subdomain from a saved PixelUnion server', (tester) async {
      await StoreService.I.put(StoreKey.serverEndpoint, 'https://family.pixelunion.eu/api');

      await pumpLoginForm(tester, manual: true);

      expect(find.text('family'), findsOneWidget);
    });

    testWidgets('does not prefill from a non-PixelUnion server', (tester) async {
      await StoreService.I.put(StoreKey.serverEndpoint, 'https://photos.example.com/api');

      await pumpLoginForm(tester, manual: true);

      expect(find.text('photos'), findsNothing);
    });

    testWidgets('rejects an empty username', (tester) async {
      await pumpLoginForm(tester, manual: true);
      await tester.tap(find.text('Next'));
      await tester.pump();

      expect(find.text('Enter your username.'), findsOneWidget);
      verifyNever(() => authService.validateServerUrl(any()));
    });

    for (final invalid in ['my family', 'family.pixelunion.eu', 'https://family']) {
      testWidgets('rejects "$invalid" as a username', (tester) async {
        await pumpLoginForm(tester, manual: true);
        await tester.enterText(find.byType(EditableText), invalid);
        await tester.tap(find.text('Next'));
        await tester.pump();

        expect(find.text('Invalid URL'), findsOneWidget);
        verifyNever(() => authService.validateServerUrl(any()));
      });
    }

    testWidgets('builds the server URL from the username', (tester) async {
      when(() => authService.validateServerUrl(any())).thenThrow(Exception('offline'));

      await pumpLoginForm(tester, manual: true);
      await tester.enterText(find.byType(EditableText), ' family ');
      await tester.tap(find.text('Next'));
      await tester.pump(const Duration(milliseconds: 100));

      verify(() => authService.validateServerUrl('https://family.pixelunion.eu')).called(1);
      // let the error toast expire
      await tester.pump(const Duration(seconds: 4));
    });
  });
}
