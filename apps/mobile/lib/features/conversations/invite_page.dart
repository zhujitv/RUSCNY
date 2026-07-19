import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/config.dart';
import '../../core/localization/app_localization.dart';
import '../../core/models.dart';
import '../friends/friends_page.dart';
import '../room/room_page.dart';

final class InvitePage extends StatelessWidget {
  const InvitePage({
    required this.conversation,
    super.key,
    this.inviteUrl,
    this.expiresAt,
    this.roomAlreadyOpen = false,
  });

  final Conversation conversation;
  final String? inviteUrl;
  final DateTime? expiresAt;
  final bool roomAlreadyOpen;

  @override
  Widget build(BuildContext context) {
    final providedInvite = inviteUrl?.trim();
    final invite = providedInvite?.isNotEmpty == true
        ? providedInvite!
        : AppConfig.inviteUri(conversation.roomToken).toString();
    return Scaffold(
      appBar: AppBar(title: const AppText('邀请参会者')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          AppText(
            conversation.title ?? '翻译会议',
            translate: conversation.title == null,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 6),
          AppText(
            conversation.contactName ?? '已绑定客户',
            translate: conversation.contactName == null,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 20),
          Center(
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: QrImageView(
                  data: invite,
                  version: QrVersions.auto,
                  size: 220,
                  semanticsLabel: '会议邀请二维码'.tr(context),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          AppText('房间码',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.labelLarge),
          SelectableText(
            conversation.roomCode,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  letterSpacing: 5,
                ),
          ),
          const SizedBox(height: 12),
          SelectableText(invite, textAlign: TextAlign.center),
          if (expiresAt != null) ...[
            const SizedBox(height: 6),
            AppText(
              '邀请有效期至 ${DateFormat('yyyy-MM-dd HH:mm').format(expiresAt!)}',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          const SizedBox(height: 18),
          OutlinedButton.icon(
            onPressed: () => SharePlus.instance.share(
              ShareParams(
                text: _shareText(context, invite),
                sharePositionOrigin: Rect.fromLTWH(
                  MediaQuery.sizeOf(context).width / 2,
                  MediaQuery.sizeOf(context).height / 2,
                  1,
                  1,
                ),
              ),
            ),
            icon: const Icon(Icons.ios_share),
            label: const AppText('分享邀请链接'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => Navigator.push<void>(
              context,
              MaterialPageRoute<void>(
                builder: (_) => FriendInvitePage(
                  conversationId: conversation.id,
                ),
              ),
            ),
            icon: const Icon(Icons.group_add_outlined),
            label: const AppText('从好友列表邀请'),
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: roomAlreadyOpen
                ? () => Navigator.pop(context)
                : () => Navigator.pushReplacement<void, void>(
                      context,
                      MaterialPageRoute<void>(
                        builder: (_) =>
                            RoomPage(conversationId: conversation.id),
                      ),
                    ),
            icon: Icon(
              roomAlreadyOpen ? Icons.arrow_back : Icons.forum_outlined,
            ),
            label: AppText(roomAlreadyOpen ? '返回翻译房间' : '进入翻译房间'),
          ),
          const SizedBox(height: 16),
          const AppText(
            '房间码不是唯一安全凭证。服务端仍会检查身份、会议状态、邀请有效期和访问权限。',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: Colors.black54),
          ),
        ],
      ),
    );
  }

  String _shareText(BuildContext context, String invite) {
    if (Localizations.localeOf(context).languageCode == 'ru') {
      return 'Приглашаем вас в китайско-русскую переводческую сессию '
          '«${conversation.title ?? ''}»\n'
          'Код комнаты: ${conversation.roomCode}\n$invite';
    }
    return '邀请您加入中俄翻译会议「${conversation.title ?? ''}」\n'
        '房间码：${conversation.roomCode}\n$invite';
  }
}
