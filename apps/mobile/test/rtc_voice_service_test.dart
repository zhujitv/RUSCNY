import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/features/friends/rtc_voice_service.dart';

void main() {
  test('maps synchronous RTC rejection to a user-safe authentication message',
      () {
    final error = PlatformException(
      code: 'RTC_JOIN_REJECTED',
      details: const {'phase': 'sync_join', 'code': -1},
    );

    expect(rtcJoinFailureMessage(error), '语音服务鉴权失败，请重新拨打');
    expect(rtcJoinFailureMessage(error), isNot(contains('PlatformException')));
    expect(rtcJoinFailureMessage(error), isNot(contains('-1')));
  });

  test('maps asynchronous join failures by authentication, account and network',
      () {
    const authentication = RtcVoiceState(
      value: 'error',
      code: 33620485,
      phase: 'async_join',
      category: 'authentication',
    );
    const account = RtcVoiceState(
      value: 'error',
      code: 16974339,
      phase: 'async_join',
      category: 'account',
    );
    const network = RtcVoiceState(
      value: 'error',
      code: 16908804,
      phase: 'async_join',
      category: 'network',
    );

    expect(authentication.userMessage, '语音服务鉴权失败，请重新拨打');
    expect(account.userMessage, '语音服务账号不可用，请联系管理员');
    expect(network.userMessage, '语音网络连接失败，请检查网络后重试');
    expect(authentication.userMessage, isNot(contains('33620485')));
  });
}
