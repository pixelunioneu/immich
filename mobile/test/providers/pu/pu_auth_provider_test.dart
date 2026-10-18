import 'dart:async';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/auth.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart';
import 'package:immich_mobile/services/auth.service.dart';
import 'package:immich_mobile/services/secure_storage.service.dart';
import 'package:immich_mobile/services/widget.service.dart';
import 'package:mocktail/mocktail.dart';

import '../../fixtures/user.stub.dart';
import '../../service.mocks.dart';

/// PixelUnion: the post-login user fetch gets 30 s instead of upstream's 7 s, because a
/// tenant that is still starting up can take well over 7 s to answer the first request.
void main() {
  late MockUserService userService;
  late ProviderContainer container;

  setUpAll(() async {
    final db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await StoreService.I.put(StoreKey.serverEndpoint, 'https://family.pixelunion.eu/api');
    // Skips the FlutterUdid platform call.
    await StoreService.I.put(StoreKey.deviceId, 'device-1');
  });

  setUp(() {
    userService = MockUserService();
    final apiService = MockApiService();
    final widgetService = MockWidgetService();

    when(() => apiService.updateHeaders()).thenAnswer((_) async {});
    when(() => widgetService.writeCredentials(any(), any(), any())).thenAnswer((_) async {});
    when(() => userService.tryGetMyUser()).thenReturn(null);

    container = ProviderContainer(
      overrides: [
        authServiceProvider.overrideWithValue(MockAuthService()),
        apiServiceProvider.overrideWithValue(apiService),
        userServiceProvider.overrideWithValue(userService),
        secureStorageServiceProvider.overrideWithValue(MockSecureStorageService()),
        widgetServiceProvider.overrideWithValue(widgetService),
        appConfigProvider.overrideWithValue(const AppConfig()),
      ],
    );
  });

  tearDown(() => container.dispose());

  /// Runs saveAuthInfo while the server takes [delay] to return the user.
  bool? saveAuthInfoWithServerDelay(Duration delay) {
    bool? result;
    fakeAsync((async) {
      when(() => userService.refreshMyUser()).thenAnswer((_) => Future<UserDto?>.delayed(delay, () => UserStub.admin));

      unawaited(
        container.read(authProvider.notifier).saveAuthInfo(accessToken: 'token').then((value) => result = value),
      );

      async.elapse(delay + const Duration(seconds: 1));
      async.flushMicrotasks();
    });
    return result;
  }

  test('waits for a slow server (upstream gives up after 7 s)', () {
    expect(saveAuthInfoWithServerDelay(const Duration(seconds: 20)), isTrue);
    expect(container.read(authProvider).isAuthenticated, isTrue);
    expect(container.read(authProvider).userId, UserStub.admin.id);
  });

  test('still succeeds just inside 30 s', () {
    expect(saveAuthInfoWithServerDelay(const Duration(seconds: 29)), isTrue);
  });

  test('gives up after 30 s when there is no cached user', () {
    expect(saveAuthInfoWithServerDelay(const Duration(seconds: 31)), isFalse);
    expect(container.read(authProvider).isAuthenticated, isFalse);
  });
}
