import 'package:flutter_test/flutter_test.dart';
import 'package:tooyei_translator/core/deep_links/deep_link_service.dart';

void main() {
  final service = DeepLinkService();
  const token = 'invite-token-at-least-16';

  test('accepts only the configured HTTPS invitation host', () {
    expect(
      service.inviteToken(
        Uri.parse('https://www.ruscny.net/join/$token'),
      ),
      token,
    );
    expect(
      service.inviteToken(Uri.parse('https://attacker.example/join/$token')),
      isNull,
    );
  });

  test('accepts the scoped custom-scheme fallback', () {
    expect(
      service.inviteToken(Uri.parse('tooyei-translator://join/$token')),
      token,
    );
    expect(
      service.inviteToken(Uri.parse('tooyei-translator://other/$token')),
      isNull,
    );
  });

  test('rejects malformed path and short invitation token', () {
    expect(
      service.inviteToken(
        Uri.parse('https://www.ruscny.net/foo/join/$token'),
      ),
      isNull,
    );
    expect(
      service.inviteToken(
        Uri.parse('https://www.ruscny.net/join/short'),
      ),
      isNull,
    );
  });
}
