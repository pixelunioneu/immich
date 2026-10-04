import 'package:openapi/api.dart';

/// Login through the PixelUnion portal, so users don't need to know their server address.
///
/// The app opens the portal's environment page with its own state nonce and PKCE challenge. The
/// portal logs the user in, lets them pick an environment, and starts that server's OAuth flow with
/// the app's values. The identity provider then calls back into the app with
/// `state = "<nonce>~<host>"`: the app checks the nonce, takes the server host from the state and
/// finishes the login on that server with the unchanged state and its code verifier.
class PuLoginService {
  static const portalBaseUrl = String.fromEnvironment('PU_PORTAL_URL', defaultValue: 'https://portal.pixelunion.eu');
  static const allowedHostSuffix = '.pixelunion.eu';
  static const _stateSeparator = '~';

  const PuLoginService._();

  /// URL of the portal page that starts the login for [nonce] and [codeChallenge].
  static String buildPortalUrl(String nonce, String codeChallenge, {String baseUrl = portalBaseUrl}) {
    final base = Uri.parse(baseUrl);
    return base
        .replace(
          path: '${base.path.replaceAll(RegExp(r'/+$'), '')}/instances/',
          queryParameters: {'nonce': nonce, 'code_challenge': codeChallenge},
        )
        .toString();
  }

  /// Normalizes the callback URL returned by the browser session to `app.immich:///oauth-callback`.
  static String normalizeCallbackUrl(String callbackUrl) {
    if (callbackUrl.startsWith('app.immich:/oauth-callback')) {
      return callbackUrl.replaceFirst('app.immich:/oauth-callback', 'app.immich:///oauth-callback');
    }
    return callbackUrl;
  }

  /// Validates the callback for the login started with [expectedNonce].
  ///
  /// Throws a [PuLoginException] when the callback is not for this login or names a server outside
  /// PixelUnion.
  static PuLoginCallback parseCallback(String callbackUrl, String expectedNonce) {
    final url = normalizeCallbackUrl(callbackUrl);
    final uri = Uri.tryParse(url);
    if (uri == null || uri.scheme != 'app.immich') {
      throw const PuLoginException('Unexpected callback URL');
    }

    final error = uri.queryParameters['error'];
    if (error != null) {
      throw PuLoginException('Login failed: ${uri.queryParameters['error_description'] ?? error}');
    }

    final state = uri.queryParameters['state'];
    final prefix = '$expectedNonce$_stateSeparator';
    if (state == null || !state.startsWith(prefix)) {
      throw const PuLoginException('Callback does not belong to this login');
    }

    final host = state.substring(prefix.length);
    if (!isAllowedHost(host)) {
      throw PuLoginException('Unexpected server: $host');
    }

    return PuLoginCallback(url: url, state: state, serverUrl: 'https://$host');
  }

  /// True for a bare hostname (no scheme, port, path or user info) under [allowedHostSuffix].
  static bool isAllowedHost(String host) {
    if (!RegExp(r'^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$').hasMatch(host)) {
      return false;
    }
    return host.endsWith(allowedHostSuffix) && host.length > allowedHostSuffix.length;
  }

  /// The callback DTO for the server's OAuth callback endpoint.
  static OAuthCallbackDto toCallbackDto(PuLoginCallback callback, String codeVerifier) {
    return OAuthCallbackDto(
      url: callback.url,
      state: Optional.present(callback.state),
      codeVerifier: Optional.present(codeVerifier),
    );
  }
}

class PuLoginCallback {
  /// Callback URL as passed to the server, including `code` and `state`.
  final String url;

  /// Full state value, `<nonce>~<host>`, to pass to the server unchanged.
  final String state;

  /// `https://<host>` of the environment the user picked.
  final String serverUrl;

  const PuLoginCallback({required this.url, required this.state, required this.serverUrl});
}

class PuLoginException implements Exception {
  final String message;

  const PuLoginException(this.message);

  @override
  String toString() => message;
}
