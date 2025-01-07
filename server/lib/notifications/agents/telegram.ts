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
import globalMessages from '@app/i18n/globalMessages';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  open: 'Open',
  resolved: 'Resolved',
  requestedby: 'Requested by',
  requeststatus: 'Requets Status',
  commentfrom: 'Comment from',
  issuetype: 'Issue Typ',
  issuestatus: 'Issue Status',
  reportedby: 'Reported by',
  newcommenton: 'New Comment on',
  issue: 'Issue',
  requestapproved: 'Request Approved',
  requestdeclined: 'Request Declined',
  requestfor: 'Request',
  requestautosub: 'Request Automatically Submitted',
  requestautoapp: 'Request Automatically Approved',
  requestfailed: 'Request Failed',
  requestedseasons: 'Requested Seasons',
  pendingapproval: 'Pending Approval',
  requestprocess: 'Processing...',
  affectedseason: 'Affected Season',
  affectedepisode: 'Affected Epiosode',
  new: 'New',
  isssuereported: 'Issue Reported',
  issueresolved: 'Issue Solved',
  issuereopened: 'Issue Reopened',
  movierequestavail: 'Movie Request Now Available',
  serierequestavail: 'Series Request Now Available',
  tmdblang: 'en',
  available: 'Available',
  declined: 'Declined',
  failed: 'Failed',
});

interface TelegramMessagePayload {
  text: string;
  parse_mode: string;
  chat_id: string;
  message_thread_id: string;
  disable_notification: boolean;
}

interface TelegramPhotoPayload {
  photo: string;
  caption: string;
  parse_mode: string;
  chat_id: string;
  message_thread_id: string;
  disable_notification: boolean;
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

    if (settings.enabled && settings.options.botAPI) {
      return true;
    }

    return false;
  }

  private escapeText(text: string | undefined): string {
    return text ? text.replace(/[_*[\]()~>#+=|{}.!-]/gi, (x) => '\\' + x) : '';
  }

  private getNotificationPayload(
    type: Notification,
    payload: NotificationPayload,
    intl: any
  ): Partial<TelegramMessagePayload | TelegramPhotoPayload> {
    const { applicationUrl, applicationTitle } = getSettings().main;

    /* eslint-disable no-useless-escape */
    let message = `\*${this.escapeText(
      payload.event ? `${payload.event} - ${payload.subject}` : payload.subject
    )}\*`;
    if (payload.message) {
      message += `\n${this.escapeText(payload.message)}`;
    }

    if (payload.request) {
      message += `\n\n\*${intl.formatMessage(messages.requestedby)}:\* ${this.escapeText(
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
          status = intl.formatMessage(messages.pendingapproval);
          break;
        case Notification.MEDIA_APPROVED:
        case Notification.MEDIA_AUTO_APPROVED:
          status = intl.formatMessage(messages.requestprocess);
          break;
        case Notification.MEDIA_AVAILABLE:
          status = intl.formatMessage(messages.available);
          break;
        case Notification.MEDIA_DECLINED:
          status = intl.formatMessage(messages.declined);
          break;
        case Notification.MEDIA_FAILED:
          status = intl.formatMessage(messages.failed);
          break;
      }

      if (status) {
        message += `\n\*${intl.formatMessage(messages.requeststatus)}:\* ${status}`;
      }
    } else if (payload.comment) {
      message += `\n\n\*${intl.formatMessage(messages.commentfrom)} ${this.escapeText(
        payload.comment.user.displayName
      )}:\* ${this.escapeText(payload.comment.message)}`;
    } else if (payload.issue) {
      message += `\n\n\*${intl.formatMessage(messages.reportedby)}:\* ${this.escapeText(
        payload.issue.createdBy.displayName
      )}`;
      message += `\n\*${intl.formatMessage(messages.issuetype)}:\* ${IssueTypeName[payload.issue.issueType]}`;
      message += `\n\*${intl.formatMessage(messages.issuestatus)}:\* ${
        payload.issue.status === IssueStatus.OPEN ? intl.formatMessage(messages.open) : intl.formatMessage(messages.resolved)
      }`;
    }

    for (const extra of payload.extra ?? []) {
      message += `\n\*${extra.name}:\* ${extra.value}`;
    }

    const url = applicationUrl
      ? payload.issue
        ? `${applicationUrl}/issues/${payload.issue.id}`
        : payload.media
        ? `${applicationUrl}/${payload.media.mediaType}/${payload.media.tmdbId}`
        : undefined
      : undefined;

    if (url) {
      message += `\n\n\[View ${
        payload.issue ? 'Issue' : 'Media'
      } in ${this.escapeText(applicationTitle)}\]\(${url}\)`;
    }
    /* eslint-enable */

    return payload.image
      ? {
          photo: payload.image,
          caption: message,
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
    const endpoint = `${this.baseUrl}bot${settings.options.botAPI}/${
      payload.image ? 'sendPhoto' : 'sendMessage'
    }`;
    const notificationPayload = this.getNotificationPayload(type, payload);

    // Send system notification
    if (
      payload.notifySystem &&
      hasNotificationType(type, settings.types ?? 0) &&
      settings.options.chatId
    ) {
      logger.debug('Sending Telegram notification', {
        label: 'Notifications',
        type: Notification[type],
        subject: payload.subject,
      });

      try {
        await axios.post(endpoint, {
          ...notificationPayload,
          chat_id: settings.options.chatId,
		  message_thread_id: settings.options.messageThreadId,
          disable_notification: !!settings.options.sendSilently,
        } as TelegramMessagePayload | TelegramPhotoPayload);
      } catch (e) {
        logger.error('Error sending Telegram notification', {
          label: 'Notifications',
          type: Notification[type],
          subject: payload.subject,
          errorMessage: e.message,
          response: e.response?.data,
        });

        return false;
      }
    }

    if (payload.notifyUser) {
      if (
        payload.notifyUser.settings?.hasNotificationType(
          NotificationAgentKey.TELEGRAM,
          type
        ) &&
        payload.notifyUser.settings?.telegramChatId &&
        payload.notifyUser.settings.telegramChatId !== settings.options.chatId
      ) {
        logger.debug('Sending Telegram notification', {
          label: 'Notifications',
          recipient: payload.notifyUser.displayName,
          type: Notification[type],
          subject: payload.subject,
        });

        try {
          await axios.post(endpoint, {
            ...notificationPayload,
            chat_id: payload.notifyUser.settings.telegramChatId,
            disable_notification:
              !!payload.notifyUser.settings.telegramSendSilently,
          } as TelegramMessagePayload | TelegramPhotoPayload);
        } catch (e) {
          logger.error('Error sending Telegram notification', {
            label: 'Notifications',
            recipient: payload.notifyUser.displayName,
            type: Notification[type],
            subject: payload.subject,
            errorMessage: e.message,
            response: e.response?.data,
          });

          return false;
        }
      }
    }

    if (payload.notifyAdmin) {
      const userRepository = getRepository(User);
      const users = await userRepository.find();

      await Promise.all(
        users
          .filter(
            (user) =>
              user.settings?.hasNotificationType(
                NotificationAgentKey.TELEGRAM,
                type
              ) && shouldSendAdminNotification(type, user, payload)
          )
          .map(async (user) => {
            if (
              user.settings?.telegramChatId &&
              user.settings.telegramChatId !== settings.options.chatId
            ) {
              logger.debug('Sending Telegram notification', {
                label: 'Notifications',
                recipient: user.displayName,
                type: Notification[type],
                subject: payload.subject,
              });

              try {
                await axios.post(endpoint, {
                  ...notificationPayload,
                  chat_id: user.settings.telegramChatId,
                  disable_notification: !!user.settings?.telegramSendSilently,
                } as TelegramMessagePayload | TelegramPhotoPayload);
              } catch (e) {
                logger.error('Error sending Telegram notification', {
                  label: 'Notifications',
                  recipient: user.displayName,
                  type: Notification[type],
                  subject: payload.subject,
                  errorMessage: e.message,
                  response: e.response?.data,
                });

                return false;
              }
            }
          })
      );
    }

    return true;
  }
}

export default TelegramAgent;
