import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/services/pu_login.service.dart';
import 'package:logging/logging.dart';
import 'package:openapi/api.dart';

// Redirect URL = app.immich:///oauth-callback

class OAuthService {
  final ApiService _apiService;
  final callbackUrlScheme = 'app.immich';
  final log = Logger('OAuthService');
  OAuthService(this._apiService);

  Future<String?> getOAuthServerUrl(String serverUrl, String state, String codeChallenge) async {
    // Resolve API server endpoint from user provided serverUrl
    await _apiService.resolveAndSetEndpoint(serverUrl);
    final redirectUri = '$callbackUrlScheme:///oauth-callback';
    log.info("Starting OAuth flow with redirect URI: $redirectUri");

    final dto = await _apiService.oAuthApi.startOAuth(
      OAuthConfigDto(
        redirectUri: redirectUri,
        state: Optional.present(state),
        codeChallenge: Optional.present(codeChallenge),
      ),
    );

    final authUrl = dto?.url;
    log.info('Received Authorization URL: $authUrl');

    return authUrl;
  }

  /// Opens the portal login in a browser session and returns the callback URL.
  ///
  /// Not ephemeral: the identity provider's session cookie must be shared with the system browser,
  /// so later sign-ins from the app (for example the server's own OAuth flow) don't ask for the
  /// password again. On iOS this means the system "wants to use ... to sign in" alert is shown.
  Future<String> authenticateViaPortal(String portalUrl) {
    return FlutterWebAuth2.authenticate(
      url: portalUrl,
      callbackUrlScheme: callbackUrlScheme,
    );
  }

  /// Finishes a portal login on the server that [callback] names. The endpoint must already be set.
  Future<LoginResponseDto?> finishPortalLogin(PuLoginCallback callback, String codeVerifier) {
    return _apiService.oAuthApi.finishOAuth(PuLoginService.toCallbackDto(callback, codeVerifier));
  }

  Future<LoginResponseDto?> oAuthLogin(String oauthUrl, String state, String codeVerifier) async {
    String result = await FlutterWebAuth2.authenticate(url: oauthUrl, callbackUrlScheme: callbackUrlScheme);

    log.info('Received OAuth callback: $result');

    if (result.startsWith('app.immich:/oauth-callback')) {
      result = result.replaceAll('app.immich:/oauth-callback', 'app.immich:///oauth-callback');
    }

    return await _apiService.oAuthApi.finishOAuth(
      OAuthCallbackDto(url: result, state: Optional.present(state), codeVerifier: Optional.present(codeVerifier)),
    );
  }
}
