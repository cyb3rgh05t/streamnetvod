import TheMovieDb from '@server/api/themoviedb';
import { IssueStatus, IssueType, IssueTypeName } from '@server/constants/issue';
import { MediaType } from '@server/constants/media';
import Issue from '@server/entity/Issue';
import notificationManager, { Notification } from '@server/lib/notifications';
import { Permission } from '@server/lib/permissions';
import globalMessages from '@app/i18n/globalMessages';
import { defineMessages, useIntl } from 'react-intl';
import logger from '@server/logger';
import { sortBy } from 'lodash';
import type {
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
} from 'typeorm';
import { EventSubscriber } from 'typeorm';

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
});

@EventSubscriber()
export class IssueSubscriber implements EntitySubscriberInterface<Issue> {
  public listenTo(): typeof Issue {
    return Issue;
  }

  private async sendIssueNotification(entity: Issue, type: Notification, intl: any) {
    let title: string;
    let image: string;
    const tmdb = new TheMovieDb();

    try {
      if (entity.media.mediaType === MediaType.MOVIE) {
        const movie = await tmdb.getMovie({ movieId: entity.media.tmdbId, language: intl.formatMessage(messages.tmdblang) });

        title = `${movie.title}${
          movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ''
        }`;
        image = `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`;
      } else {
        const tvshow = await tmdb.getTvShow({ tvId: entity.media.tmdbId, language: intl.formatMessage(messages.tmdblang) });

        title = `${tvshow.name}${
          tvshow.first_air_date ? ` (${tvshow.first_air_date.slice(0, 4)})` : ''
        }`;
        image = `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tvshow.poster_path}`;
      }

      const [firstComment] = sortBy(entity.comments, 'id');
      const extra: { name: string; value: string }[] = [];

      if (entity.media.mediaType === MediaType.TV && entity.problemSeason > 0) {
        extra.push({
          name: intl.formatMessage(messages.affectedseason),
          value: entity.problemSeason.toString(),
        });

        if (entity.problemEpisode > 0) {
          extra.push({
            name: intl.formatMessage(messages.affectedepisode),
            value: entity.problemEpisode.toString(),
          });
        }
      }

      notificationManager.sendNotification(type, {
        event:
          type === Notification.ISSUE_CREATED
            ? `${
                entity.issueType !== IssueType.OTHER
                  ? `${IssueTypeName[entity.issueType]} `
                  : ''
              }${intl.formatMessage(messages.issue)}`
            : type === Notification.ISSUE_RESOLVED
            ? `${
                entity.issueType !== IssueType.OTHER
                  ? `${IssueTypeName[entity.issueType]} `
                  : ''
              }${intl.formatMessage(messages.issueresolved}`
            : `${
                entity.issueType !== IssueType.OTHER
                  ? `${IssueTypeName[entity.issueType]} `
                  : ''
              }${intl.formatMessage(messages.issuereopened)}`,
        subject: title,
        message: firstComment.message,
        issue: entity,
        media: entity.media,
        image,
        extra,
        notifyAdmin: true,
        notifySystem: true,
        notifyUser:
          !entity.createdBy.hasPermission(Permission.MANAGE_ISSUES) &&
          entity.modifiedBy?.id !== entity.createdBy.id &&
          (type === Notification.ISSUE_RESOLVED ||
            type === Notification.ISSUE_REOPENED)
            ? entity.createdBy
            : undefined,
      });
    } catch (e) {
      logger.error('Something went wrong sending issue notification(s)', {
        label: 'Notifications',
        errorMessage: e.message,
        issueId: entity.id,
      });
    }
  }

  public afterInsert(event: InsertEvent<Issue>): void {
    if (!event.entity) {
      return;
    }

    this.sendIssueNotification(event.entity, Notification.ISSUE_CREATED);
  }

  public beforeUpdate(event: UpdateEvent<Issue>): void {
    if (!event.entity) {
      return;
    }

    if (
      event.entity.status === IssueStatus.RESOLVED &&
      event.databaseEntity.status !== IssueStatus.RESOLVED
    ) {
      this.sendIssueNotification(
        event.entity as Issue,
        Notification.ISSUE_RESOLVED
      );
    } else if (
      event.entity.status === IssueStatus.OPEN &&
      event.databaseEntity.status !== IssueStatus.OPEN
    ) {
      this.sendIssueNotification(
        event.entity as Issue,
        Notification.ISSUE_REOPENED
      );
    }
  }
}
