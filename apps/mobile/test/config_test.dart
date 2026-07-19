import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/config.dart';

void main() {
  test('default Socket.IO endpoint follows the API origin', () {
    expect(AppConfig.apiBaseUrl, 'https://www.ruscny.net/v1');
    expect(AppConfig.socketUrl, 'https://www.ruscny.net');
  });
}
