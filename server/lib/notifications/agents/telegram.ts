import { IssueStatus, IssueTypeName } from '@server/constants/issue';
import { MediaStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type { NotificationAgentTelegram } from '@server/lib/settings';
import { getSettings, NotificationAgentKey } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import {
  hasNotificationType,
  Notification,
  shouldSendAdminNotification,
} from '..';
import type { NotificationAgent, NotificationPayload } from './agent';
import { BaseAgent } from './agent';

interface TelegramMessagePayload {
  text: string;
  parse_mode: string;
  chat_id: string;
  disable_notification: boolean;
  message_thread_id?: number;
}

interface TelegramPhotoPayload {
  photo: string;
  caption: string;
  parse_mode: string;
  chat_id: string;
  disable_notification: boolean;
  message_thread_id?: number;
}

class TelegramAgent
  extends BaseAgent<NotificationAgentTelegram>
  implements NotificationAgent
{
  private baseUrl = 'https://api.telegram.org/';

  protected getSettings(): NotificationAgentTelegram {
    if (this.settings) {
      return this.settings;
    }

    const settings = getSettings();

    return settings.notifications.agents.telegram;
  }

  public shouldSend(): boolean {
    const settings = this.getSettings();

    return !!(settings.enabled && settings.options.botAPI);
  }

  private escapeText(text: string | undefined): string {
    return text ? text.replace(/[_*\[\]()~>#+=|{}.!-]/gi, (x) => '\\' + x) : '';
  }

  private truncateCaption(caption: string, maxLength = 1024): string {
    return caption.length > maxLength
      ? caption.substring(0, maxLength - 3) + '...'
      : caption;
  }

  private getNotificationPayload(
    type: Notification,
    payload: NotificationPayload
  ): Partial<TelegramMessagePayload | TelegramPhotoPayload> {
    const { applicationUrl, applicationTitle } = getSettings().main;

    let message = `*${this.escapeText(
      payload.event ? `${payload.event} - ${payload.subject}` : payload.subject
    )}*`;

    if (payload.message) {
      message += `\n${this.escapeText(payload.message)}`;
    }

    if (payload.request) {
      message += `\n\n*Requested By:* ${this.escapeText(
        payload.request?.requestedBy.displayName
      )}`;

      let status = '';
      switch (type) {
        case Notification.MEDIA_AUTO_REQUESTED:
          status =
            payload.media?.status === MediaStatus.PENDING
              ? 'Pending Approval'
              : 'Processing';
          break;
        case Notification.MEDIA_PENDING:
          status = 'Pending Approval';
          break;
        case Notification.MEDIA_APPROVED:
        case Notification.MEDIA_AUTO_APPROVED:
          status = 'Processing';
          break;
        case Notification.MEDIA_AVAILABLE:
          status = 'Available';
          break;
        case Notification.MEDIA_DECLINED:
          status = 'Declined';
          break;
        case Notification.MEDIA_FAILED:
          status = 'Failed';
          break;
      }

      if (status) {
        message += `\n*Request Status:* ${status}`;
      }
    } else if (payload.comment) {
      message += `\n\n*Comment from ${this.escapeText(
        payload.comment.user.displayName
      )}:* ${this.escapeText(payload.comment.message)}`;
    } else if (payload.issue) {
      message += `\n\n*Reported By:* ${this.escapeText(
        payload.issue.createdBy.displayName
      )}`;
      message += `\n*Issue Type:* ${IssueTypeName[payload.issue.issueType]}`;
      message += `\n*Issue Status:* ${
        payload.issue.status === IssueStatus.OPEN ? 'Open' : 'Resolved'
      }`;
    }

    for (const extra of payload.extra ?? []) {
      message += `\n*${extra.name}:* ${extra.value}`;
    }

    const url = applicationUrl
      ? payload.issue
        ? `${applicationUrl}/issues/${payload.issue.id}`
        : payload.media
        ? `${applicationUrl}/${payload.media.mediaType}/${payload.media.tmdbId}`
        : undefined
      : undefined;

    if (url) {
      message += `\n\n[View ${
        payload.issue ? 'Issue' : 'Media'
      } in ${this.escapeText(applicationTitle)}](${url})`;
    }

    return payload.image
      ? {
          photo: payload.image,
          caption: this.truncateCaption(message),
          parse_mode: 'MarkdownV2',
        }
      : {
          text: message,
          parse_mode: 'MarkdownV2',
        };
  }

  public async send(
    type: Notification,
    payload: NotificationPayload
  ): Promise<boolean> {
    const settings = this.getSettings();
    const endpoint = `${this.baseUrl}bot${settings.options.botAPI}/$${
      payload.image ? 'sendPhoto' : 'sendMessage'
    }`;
    const notificationPayload = this.getNotificationPayload(type, payload);

    const sendTelegram = async (chatId: string, silent: boolean, threadId?: number) => {
      try {
        await axios.post(endpoint, {
          ...notificationPayload,
          chat_id: chatId,
          disable_notification: silent,
          ...(threadId ? { message_thread_id: threadId } : {}),
        } as TelegramMessagePayload | TelegramPhotoPayload);
        return true;
      } catch (e: any) {
        logger.error('Error sending Telegram notification', {
          label: 'Notifications',
          type: Notification[type],
          subject: payload.subject,
          errorMessage: e.message,
          response: e.response?.data,
        });
        return false;
      }
    };

    if (
      payload.notifySystem &&
      hasNotificationType(type, settings.types ?? 0) &&
      settings.options.chatId
    ) {
      await sendTelegram(
        settings.options.chatId,
        !!settings.options.sendSilently,
        settings.options.messageThreadId ? Number(settings.options.messageThreadId) : undefined
      );
    }

    if (payload.notifyUser) {
      const userSettings = payload.notifyUser.settings;
      if (
        userSettings?.hasNotificationType(NotificationAgentKey.TELEGRAM, type) &&
        userSettings.telegramChatId &&
        userSettings.telegramChatId !== settings.options.chatId
      ) {
        await sendTelegram(
          userSettings.telegramChatId,
          !!userSettings.telegramSendSilently,
          userSettings.telegramMessageThreadId
            ? Number(userSettings.telegramMessageThreadId)
            : undefined
        );
      }
    }

    if (payload.notifyAdmin) {
      const userRepository = getRepository(User);
      const users = await userRepository.find();

      await Promise.all(
        users
          .filter(
            (user) =>
              user.settings?.hasNotificationType(NotificationAgentKey.TELEGRAM, type) &&
              shouldSendAdminNotification(type, user, payload)
          )
          .map((user) => {
            if (
              user.settings?.telegramChatId &&
              user.settings.telegramChatId !== settings.options.chatId
            ) {
              return sendTelegram(
                user.settings.telegramChatId,
                !!user.settings.telegramSendSilently,
                user.settings.telegramMessageThreadId
                  ? Number(user.settings.telegramMessageThreadId)
                  : undefined
              );
            }
            return Promise.resolve(true);
          })
      );
    }

    return true;
  }
}

export default TelegramAgent;
