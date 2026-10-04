import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/services/pu_login.service.dart';

void main() {
  const nonce = 'abcdefghijklmnopqrstuvwxyz012345';

  String callback(String state, {String prefix = 'app.immich:///oauth-callback'}) =>
      '$prefix?code=the-code&state=${Uri.encodeQueryComponent(state)}';

  group('buildPortalUrl', () {
    test('opens the environment page with the nonce and challenge', () {
      final url = Uri.parse(PuLoginService.buildPortalUrl(nonce, 'challenge-123', baseUrl: 'https://portal.example'));

      expect(url.origin, 'https://portal.example');
      expect(url.path, '/instances/');
      expect(url.queryParameters, {'nonce': nonce, 'code_challenge': 'challenge-123'});
    });

    test('handles a base URL with a trailing slash', () {
      final url = PuLoginService.buildPortalUrl(nonce, 'c', baseUrl: 'https://portal.example/');

      expect(Uri.parse(url).path, '/instances/');
    });

    test('defaults to the production portal', () {
      expect(PuLoginService.buildPortalUrl(nonce, 'c'), startsWith('https://portal.pixelunion.eu/instances/?'));
    });
  });

  group('parseCallback', () {
    test('returns the server and the unchanged state', () {
      final result = PuLoginService.parseCallback(callback('$nonce~family.pixelunion.eu'), nonce);

      expect(result.serverUrl, 'https://family.pixelunion.eu');
      expect(result.state, '$nonce~family.pixelunion.eu');
      expect(result.url, callback('$nonce~family.pixelunion.eu'));
    });

    test('accepts deeper PixelUnion hosts', () {
      final result = PuLoginService.parseCallback(callback('$nonce~family.tenants.test.pixelunion.eu'), nonce);

      expect(result.serverUrl, 'https://family.tenants.test.pixelunion.eu');
    });

    test('normalizes the single-slash callback scheme', () {
      final result = PuLoginService.parseCallback(
        callback('$nonce~family.pixelunion.eu', prefix: 'app.immich:/oauth-callback'),
        nonce,
      );

      expect(result.url, startsWith('app.immich:///oauth-callback?'));
    });

    test('rejects a callback for another login', () {
      expect(
        () => PuLoginService.parseCallback(callback('othernonce~family.pixelunion.eu'), nonce),
        throwsA(isA<PuLoginException>()),
      );
    });

    test('rejects a state without a host', () {
      expect(() => PuLoginService.parseCallback(callback(nonce), nonce), throwsA(isA<PuLoginException>()));
    });

    test('rejects a missing state', () {
      expect(
        () => PuLoginService.parseCallback('app.immich:///oauth-callback?code=x', nonce),
        throwsA(isA<PuLoginException>()),
      );
    });

    test('reports an identity provider error', () {
      expect(
        () => PuLoginService.parseCallback(
          'app.immich:///oauth-callback?error=access_denied&state=$nonce~family.pixelunion.eu',
          nonce,
        ),
        throwsA(isA<PuLoginException>().having((e) => e.message, 'message', contains('access_denied'))),
      );
    });

    test('rejects other schemes', () {
      expect(
        () => PuLoginService.parseCallback(
          callback('$nonce~family.pixelunion.eu', prefix: 'https://evil.example/oauth-callback'),
          nonce,
        ),
        throwsA(isA<PuLoginException>()),
      );
    });

    for (final host in [
      'evil.com',
      'pixelunion.eu',
      '.pixelunion.eu',
      'pixelunion.eu.evil.com',
      'evilpixelunion.eu',
      'https://family.pixelunion.eu',
      'family.pixelunion.eu/path',
      'family.pixelunion.eu:8443',
      'user@family.pixelunion.eu',
      'Family.pixelunion.eu',
      '',
    ]) {
      test('rejects host "$host"', () {
        expect(() => PuLoginService.parseCallback(callback('$nonce~$host'), nonce), throwsA(isA<PuLoginException>()));
      });
    }
  });

  test('toCallbackDto passes the state and verifier through', () {
    final result = PuLoginService.parseCallback(callback('$nonce~family.pixelunion.eu'), nonce);
    final dto = PuLoginService.toCallbackDto(result, 'verifier');

    expect(dto.url, result.url);
    expect(dto.state.value, '$nonce~family.pixelunion.eu');
    expect(dto.codeVerifier.value, 'verifier');
  });
}
